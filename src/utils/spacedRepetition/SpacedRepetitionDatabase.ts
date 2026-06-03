import { App, TFile, normalizePath } from 'obsidian';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import {
  QuestionReviewState,
  ReviewRecordInput,
  ScheduledReviewResult,
  SpacedRepetitionQuestionInput,
  SpacedRepetitionStudySetRecord,
  StudySetSourceType
} from '../../types/spacedRepetition';

const SCHEMA_VERSION = 1;

export interface SpacedRepetitionDatabaseConfig {
  dbPath: string;
  wasmPath?: string;
}

export interface DueQuestionRecord {
  id: string;
  noteId: string | null;
  studySetId: string | null;
  questionName: string | null;
  questionText: string;
  questionType: string;
  answerText: string | null;
  choices: string[] | null;
  answerCheckMode: string;
  nextRepeatAt: string;
  shouldReask: boolean;
  reaskAfterCount: number;
}

export class SpacedRepetitionDatabase {
  private app: App;
  private config: SpacedRepetitionDatabaseConfig;
  private sql: SqlJsStatic | null = null;
  private db: Database | null = null;
  private initialized = false;
  private initializePromise: Promise<void> | null = null;

  constructor(app: App, config: SpacedRepetitionDatabaseConfig) {
    this.app = app;
    this.config = {
      ...config,
      dbPath: normalizePath(config.dbPath),
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initializePromise) {
      return this.initializePromise;
    }

    this.initializePromise = this.doInitialize();
    try {
      await this.initializePromise;
    } finally {
      this.initializePromise = null;
    }
  }

  async upsertNoteFromFile(file: TFile, contentHash?: string | null): Promise<string> {
    const db = this.requireDb();
    const now = new Date().toISOString();
    const id = this.createId('note');
    const title = file.basename || file.path.split('/').pop() || file.path;

    db.run(
      `
      INSERT INTO notes (id, note_path, note_title, content_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(note_path) DO UPDATE SET
        note_title = excluded.note_title,
        content_hash = excluded.content_hash,
        updated_at = excluded.updated_at
      `,
      [id, normalizePath(file.path), title, contentHash ?? null, now, now]
    );

    await this.persist();
    return this.getNoteIdByPath(file.path) as string;
  }

  getNoteIdByPath(notePath: string): string | null {
    const rows = this.select<{ id: string }>('SELECT id FROM notes WHERE note_path = ? LIMIT 1', [normalizePath(notePath)]);
    return rows[0]?.id ?? null;
  }

  async createStudySet(input: {
    name: string;
    description?: string | null;
    sourceType: StudySetSourceType;
    sourceRule: Record<string, unknown>;
    tags?: string[];
  }): Promise<string> {
    const db = this.requireDb();
    const id = this.createId('set');
    const now = new Date().toISOString();

    db.run(
      `
      INSERT INTO study_sets (
        id, name, description, source_type, source_rule_json, created_at, updated_at, tags_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        input.name,
        input.description ?? null,
        input.sourceType,
        JSON.stringify(input.sourceRule),
        now,
        now,
        JSON.stringify(input.tags ?? []),
      ]
    );

    await this.persist();
    return id;
  }

  async setStudySetNotes(studySetId: string, noteIds: string[]): Promise<void> {
    const db = this.requireDb();
    const now = new Date().toISOString();

    db.run('DELETE FROM study_set_notes WHERE study_set_id = ?', [studySetId]);
    for (const noteId of noteIds) {
      db.run(
        'INSERT INTO study_set_notes (study_set_id, note_id, added_at) VALUES (?, ?, ?)',
        [studySetId, noteId, now]
      );
    }

    await this.persist();
  }

  async createQuestions(questions: SpacedRepetitionQuestionInput[]): Promise<string[]> {
    const db = this.requireDb();
    const ids: string[] = [];
    const now = new Date().toISOString();

    for (const question of questions) {
      if (!question.noteId && !question.studySetId) {
        throw new Error('Question must have noteId or studySetId');
      }

      const id = this.createId('question');
      ids.push(id);

      db.run(
        `
        INSERT INTO questions (
          id, note_id, study_set_id, question_name, question_text, question_type, answer_text,
          choices_json, answer_check_mode, metadata_json, created_at, updated_at, next_repeat_at,
          enabled
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          id,
          question.noteId ?? null,
          question.studySetId ?? null,
          question.questionName ?? null,
          question.questionText,
          question.questionType,
          question.answerText ?? null,
          JSON.stringify(question.choices ?? null),
          question.answerCheckMode,
          JSON.stringify(question.metadata ?? {}),
          now,
          now,
          question.nextRepeatAt ?? now,
          question.enabled === false ? 0 : 1,
        ]
      );

      db.run(
        `
        INSERT INTO schedules (question_id, algorithm, interval_days, ease, repetition_count, lapse_count)
        VALUES (?, 'mnemosyne_like_v1', 0, 2.5, 0, 0)
        `,
        [id]
      );
    }

    await this.persist();
    return ids;
  }

  async recordQuestionSources(questionId: string, sources: Array<{ noteId: string; sourceLabel?: string; sourceExcerpt?: string }>): Promise<void> {
    const db = this.requireDb();

    db.run('DELETE FROM question_sources WHERE question_id = ?', [questionId]);
    for (const source of sources) {
      db.run(
        'INSERT INTO question_sources (question_id, note_id, source_label, source_excerpt) VALUES (?, ?, ?, ?)',
        [questionId, source.noteId, source.sourceLabel ?? null, source.sourceExcerpt ?? null]
      );
    }

    await this.persist();
  }

  getDueQuestions(now: Date = new Date(), limit = 50): DueQuestionRecord[] {
    const rows = this.select<Record<string, unknown>>(
      `
      SELECT
        id, note_id as noteId, study_set_id as studySetId, question_name as questionName,
        question_text as questionText, question_type as questionType, answer_text as answerText,
        choices_json as choicesJson, answer_check_mode as answerCheckMode, next_repeat_at as nextRepeatAt,
        should_reask as shouldReask, reask_after_count as reaskAfterCount
      FROM questions
      WHERE enabled = 1
        AND ((should_reask = 1 AND reask_after_count <= 0) OR (should_reask = 0 AND next_repeat_at <= ?))
      ORDER BY should_reask DESC, next_repeat_at ASC
      LIMIT ?
      `,
      [now.toISOString(), limit]
    );

    return rows.map((row) => ({
      id: String(row.id),
      noteId: row.noteId ? String(row.noteId) : null,
      studySetId: row.studySetId ? String(row.studySetId) : null,
      questionName: row.questionName ? String(row.questionName) : null,
      questionText: String(row.questionText),
      questionType: String(row.questionType),
      answerText: row.answerText ? String(row.answerText) : null,
      choices: this.parseJson(row.choicesJson, null),
      answerCheckMode: String(row.answerCheckMode),
      nextRepeatAt: String(row.nextRepeatAt),
      shouldReask: Number(row.shouldReask) === 1,
      reaskAfterCount: Number(row.reaskAfterCount),
    }));
  }

  getQuestionReviewState(questionId: string): QuestionReviewState | null {
    const rows = this.select<Record<string, unknown>>(
      `
      SELECT
        q.id as questionId, q.next_repeat_at as nextRepeatAt, q.should_reask as shouldReask,
        q.reask_after_count as reaskAfterCount, q.last_reviewed_at as lastReviewedAt,
        s.algorithm, s.interval_days as intervalDays, s.ease, s.repetition_count as repetitionCount,
        s.lapse_count as lapseCount, s.last_grade as lastGrade, s.due_position as duePosition
      FROM questions q
      LEFT JOIN schedules s ON s.question_id = q.id
      WHERE q.id = ?
      LIMIT 1
      `,
      [questionId]
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      questionId: String(row.questionId),
      nextRepeatAt: String(row.nextRepeatAt),
      shouldReask: Number(row.shouldReask) === 1,
      reaskAfterCount: Number(row.reaskAfterCount),
      lastReviewedAt: row.lastReviewedAt ? String(row.lastReviewedAt) : null,
      schedule: {
        algorithm: String(row.algorithm ?? 'mnemosyne_like_v1'),
        intervalDays: Number(row.intervalDays ?? 0),
        ease: Number(row.ease ?? 2.5),
        repetitionCount: Number(row.repetitionCount ?? 0),
        lapseCount: Number(row.lapseCount ?? 0),
        lastGrade: row.lastGrade === null || row.lastGrade === undefined ? null : Number(row.lastGrade) as any,
        duePosition: row.duePosition === null || row.duePosition === undefined ? null : Number(row.duePosition),
      },
    };
  }

  async recordReview(input: ReviewRecordInput, scheduled: ScheduledReviewResult, reviewedAt: Date = new Date()): Promise<void> {
    const db = this.requireDb();
    const previous = this.getQuestionReviewState(input.questionId);
    if (!previous) {
      throw new Error(`Question not found: ${input.questionId}`);
    }

    const reviewId = this.createId('review');
    const nowIso = reviewedAt.toISOString();

    db.run(
      `
      UPDATE questions
      SET
        next_repeat_at = ?,
        last_reviewed_at = ?,
        should_reask = ?,
        reask_after_count = ?,
        updated_at = ?
      WHERE id = ?
      `,
      [
        scheduled.nextRepeatAt,
        nowIso,
        scheduled.shouldReask ? 1 : 0,
        scheduled.reaskAfterCount,
        nowIso,
        input.questionId,
      ]
    );

    db.run(
      `
      UPDATE schedules
      SET
        algorithm = ?,
        interval_days = ?,
        ease = ?,
        repetition_count = ?,
        lapse_count = ?,
        last_grade = ?,
        due_position = ?
      WHERE question_id = ?
      `,
      [
        scheduled.schedule.algorithm,
        scheduled.schedule.intervalDays,
        scheduled.schedule.ease,
        scheduled.schedule.repetitionCount,
        scheduled.schedule.lapseCount,
        scheduled.schedule.lastGrade,
        scheduled.schedule.duePosition ?? null,
        input.questionId,
      ]
    );

    db.run(
      `
      INSERT INTO review_history (
        id, question_id, reviewed_at, grade, user_answer, checker_result_json,
        previous_next_repeat_at, next_repeat_at, elapsed_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        reviewId,
        input.questionId,
        nowIso,
        input.grade,
        input.userAnswer ?? null,
        JSON.stringify(input.checkerResult ?? null),
        previous.nextRepeatAt,
        scheduled.nextRepeatAt,
        input.elapsedMs ?? null,
      ]
    );

    db.run(
      `
      UPDATE questions
      SET reask_after_count = MAX(reask_after_count - 1, 0)
      WHERE should_reask = 1 AND reask_after_count > 0 AND id != ?
      `,
      [input.questionId]
    );

    await this.persist();
  }

  getStudySets(): SpacedRepetitionStudySetRecord[] {
    return this.select<Record<string, unknown>>(
      `
      SELECT id, name, description, source_type as sourceType, source_rule_json as sourceRuleJson,
        tags_json as tagsJson, enabled
      FROM study_sets
      ORDER BY updated_at DESC
      `
    ).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      description: row.description ? String(row.description) : null,
      sourceType: String(row.sourceType) as StudySetSourceType,
      sourceRule: this.parseJson(row.sourceRuleJson, {}),
      tags: this.parseJson(row.tagsJson, []),
      enabled: Number(row.enabled) === 1,
    }));
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.persist();
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }

  private async doInitialize(): Promise<void> {
    const wasmBinary = await this.readWasmBinary();
    this.sql = await initSqlJs(
      wasmBinary
        ? { wasmBinary }
        : { locateFile: (file) => this.config.wasmPath || file }
    );

    await this.ensureParentDirectory();
    const data = await this.readDatabaseBytes();
    this.db = data ? new this.sql.Database(data) : new this.sql.Database();

    this.applyMigrations();
    await this.persist();
    this.initialized = true;
  }

  private applyMigrations(): void {
    const db = this.requireDb();

    db.run('PRAGMA foreign_keys = ON');
    db.run(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        note_path TEXT NOT NULL UNIQUE,
        note_title TEXT NOT NULL,
        content_hash TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        repeat_at TEXT,
        should_reask_global INTEGER NOT NULL DEFAULT 0,
        tags_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS study_sets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        source_type TEXT NOT NULL,
        source_rule_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        repeat_at TEXT,
        should_reask_global INTEGER NOT NULL DEFAULT 0,
        tags_json TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS study_set_notes (
        study_set_id TEXT NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE,
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        role TEXT,
        added_at TEXT NOT NULL,
        PRIMARY KEY (study_set_id, note_id)
      );

      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,
        study_set_id TEXT REFERENCES study_sets(id) ON DELETE CASCADE,
        question_name TEXT,
        question_text TEXT NOT NULL,
        question_type TEXT NOT NULL,
        answer_text TEXT,
        choices_json TEXT,
        answer_check_mode TEXT NOT NULL DEFAULT 'self',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        next_repeat_at TEXT NOT NULL,
        last_reviewed_at TEXT,
        should_reask INTEGER NOT NULL DEFAULT 0,
        reask_after_count INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        CHECK (note_id IS NOT NULL OR study_set_id IS NOT NULL)
      );

      CREATE TABLE IF NOT EXISTS question_sources (
        question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        source_label TEXT,
        source_excerpt TEXT,
        PRIMARY KEY (question_id, note_id)
      );

      CREATE TABLE IF NOT EXISTS schedules (
        question_id TEXT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
        algorithm TEXT NOT NULL DEFAULT 'mnemosyne_like_v1',
        interval_days REAL NOT NULL DEFAULT 0,
        ease REAL NOT NULL DEFAULT 2.5,
        repetition_count INTEGER NOT NULL DEFAULT 0,
        lapse_count INTEGER NOT NULL DEFAULT 0,
        last_grade INTEGER,
        due_position INTEGER
      );

      CREATE TABLE IF NOT EXISTS review_history (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        reviewed_at TEXT NOT NULL,
        grade INTEGER NOT NULL,
        user_answer TEXT,
        checker_result_json TEXT,
        previous_next_repeat_at TEXT,
        next_repeat_at TEXT,
        elapsed_ms INTEGER
      );

      CREATE TABLE IF NOT EXISTS note_chats (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS note_chat_messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL REFERENCES note_chats(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS code_links (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        language TEXT,
        created_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
    `);

    db.run(
      `
      INSERT INTO schema_meta (key, value)
      VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `,
      [String(SCHEMA_VERSION)]
    );
  }

  private async ensureParentDirectory(): Promise<void> {
    const dir = this.config.dbPath.split('/').slice(0, -1).join('/');
    if (!dir) {
      return;
    }

    if (!await this.app.vault.adapter.exists(dir)) {
      await this.app.vault.adapter.mkdir(dir);
    }
  }

  private async readDatabaseBytes(): Promise<Uint8Array | null> {
    const adapter = this.app.vault.adapter as any;
    if (!await adapter.exists(this.config.dbPath)) {
      return null;
    }

    if (typeof adapter.readBinary === 'function') {
      const buffer = await adapter.readBinary(this.config.dbPath);
      return new Uint8Array(buffer);
    }

    const encoded = await adapter.read(this.config.dbPath);
    if (!encoded) {
      return null;
    }

    return Uint8Array.from(Buffer.from(encoded, 'base64'));
  }

  private async readWasmBinary(): Promise<Uint8Array | null> {
    if (!this.config.wasmPath) {
      return null;
    }

    const adapter = this.app.vault.adapter as any;
    const normalizedWasmPath = normalizePath(this.config.wasmPath);

    try {
      if (typeof adapter.exists === 'function' && await adapter.exists(normalizedWasmPath)) {
        if (typeof adapter.readBinary === 'function') {
          const buffer = await adapter.readBinary(normalizedWasmPath);
          return new Uint8Array(buffer);
        }

        if (typeof adapter.read === 'function') {
          const encoded = await adapter.read(normalizedWasmPath);
          return Uint8Array.from(Buffer.from(encoded, 'base64'));
        }
      }
    } catch (error) {
      console.warn('Failed to read sql.js WASM through vault adapter, falling back to locateFile:', error);
    }

    return null;
  }

  private async persist(): Promise<void> {
    const adapter = this.app.vault.adapter as any;
    const db = this.requireDb();
    const bytes = db.export();

    if (typeof adapter.writeBinary === 'function') {
      await adapter.writeBinary(this.config.dbPath, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      return;
    }

    await adapter.write(this.config.dbPath, Buffer.from(bytes).toString('base64'));
  }

  private select<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    const statement = this.requireDb().prepare(sql);
    const rows: T[] = [];

    try {
      statement.bind(params);
      while (statement.step()) {
        rows.push(statement.getAsObject() as T);
      }
    } finally {
      statement.free();
    }

    return rows;
  }

  private parseJson<T>(value: unknown, fallback: T): T {
    if (typeof value !== 'string') {
      return fallback;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  private createId(prefix: string): string {
    const cryptoObj = globalThis.crypto as Crypto | undefined;
    const randomId = cryptoObj?.randomUUID ? cryptoObj.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}_${randomId}`;
  }

  private requireDb(): Database {
    if (!this.db) {
      throw new Error('Spaced repetition database is not initialized');
    }

    return this.db;
  }
}
