import { App, TFile, normalizePath } from 'obsidian';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import {
  QuestionReviewState,
  NoteChatMessageRecord,
  NoteChatRecord,
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
  metadata: Record<string, unknown>;
  nextRepeatAt: string;
  shouldReask: boolean;
  reaskAfterCount: number;
}

export interface ReviewQuestionQuery {
  now?: Date;
  limit?: number;
  includeNotDue?: boolean;
  noteId?: string | null;
  studySetId?: string | null;
}

export interface StudySetReviewStats {
  studySetId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  totalCount: number;
  dueCount: number;
  suspendedCount: number;
  archivedCount: number;
}

export interface ReviewGradeCount {
  grade: number;
  count: number;
}

export interface DueForecastDay {
  date: string;
  dueCount: number;
}

export interface HardCardStats {
  questionId: string;
  questionName: string | null;
  questionText: string;
  studySetName: string | null;
  lapseCount: number;
  reviewCount: number;
  averageGrade: number;
}

export interface ReviewStats {
  reviewedToday: number;
  reviewedLast7Days: number;
  lapsesLast30Days: number;
  gradeDistributionLast30Days: ReviewGradeCount[];
  dueForecast: DueForecastDay[];
  hardestCards: HardCardStats[];
}

export interface CardManagementQuery {
  search?: string;
  enabled?: boolean | null;
  archived?: boolean | null;
  studySetId?: string | null;
  questionType?: string | null;
  limit?: number;
}

export interface CardManagementRecord {
  id: string;
  noteId: string | null;
  notePath: string | null;
  noteTitle: string | null;
  studySetId: string | null;
  studySetName: string | null;
  questionName: string | null;
  questionText: string;
  questionType: string;
  answerText: string | null;
  metadata: Record<string, unknown>;
  enabled: boolean;
  archivedAt: string | null;
  nextRepeatAt: string;
  lastReviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
    return this.getReviewQuestions({ now, limit });
  }

  getReviewQuestions(query: ReviewQuestionQuery = {}): DueQuestionRecord[] {
    const now = query.now ?? new Date();
    const limit = query.limit ?? 50;
    const filter = this.buildQuestionFilter(query, now);

    filter.params.push(limit);

    const rows = this.select<Record<string, unknown>>(
      `
      SELECT
        id, note_id as noteId, study_set_id as studySetId, question_name as questionName,
        question_text as questionText, question_type as questionType, answer_text as answerText,
        choices_json as choicesJson, answer_check_mode as answerCheckMode, metadata_json as metadataJson,
        next_repeat_at as nextRepeatAt,
        should_reask as shouldReask, reask_after_count as reaskAfterCount
      FROM questions
      WHERE ${filter.conditions.join(' AND ')}
      ORDER BY should_reask DESC, next_repeat_at ASC, created_at ASC
      LIMIT ?
      `,
      filter.params
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
      metadata: this.parseJson(row.metadataJson, {}),
      nextRepeatAt: String(row.nextRepeatAt),
      shouldReask: Number(row.shouldReask) === 1,
      reaskAfterCount: Number(row.reaskAfterCount),
    }));
  }

  countReviewQuestions(query: Omit<ReviewQuestionQuery, 'limit'> = {}): number {
    const filter = this.buildQuestionFilter(query, query.now ?? new Date());
    const rows = this.select<{ count: number }>(
      `SELECT COUNT(*) as count FROM questions WHERE ${filter.conditions.join(' AND ')}`,
      filter.params
    );

    return Number(rows[0]?.count ?? 0);
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

  async updateQuestionDueState(input: {
    questionId: string;
    nextRepeatAt: string;
    shouldReask?: boolean;
    reaskAfterCount?: number;
  }): Promise<void> {
    const db = this.requireDb();
    const now = new Date().toISOString();

    db.run(
      `
      UPDATE questions
      SET
        next_repeat_at = ?,
        should_reask = ?,
        reask_after_count = ?,
        updated_at = ?
      WHERE id = ?
      `,
      [
        input.nextRepeatAt,
        input.shouldReask ? 1 : 0,
        input.reaskAfterCount ?? 0,
        now,
        input.questionId,
      ]
    );

    await this.persist();
  }

  async setQuestionEnabled(questionId: string, enabled: boolean): Promise<void> {
    const db = this.requireDb();
    const now = new Date().toISOString();

    db.run(
      'UPDATE questions SET enabled = ?, updated_at = ? WHERE id = ?',
      [enabled ? 1 : 0, now, questionId]
    );

    await this.persist();
  }

  async setQuestionArchived(questionId: string, archived: boolean): Promise<void> {
    const db = this.requireDb();
    const now = new Date().toISOString();

    db.run(
      'UPDATE questions SET archived_at = ?, updated_at = ? WHERE id = ?',
      [archived ? now : null, now, questionId]
    );

    await this.persist();
  }

  async setQuestionStudySet(questionId: string, studySetId: string | null): Promise<void> {
    const db = this.requireDb();
    const now = new Date().toISOString();
    const questionRows = this.select<Record<string, unknown>>(
      'SELECT note_id as noteId, metadata_json as metadataJson FROM questions WHERE id = ? LIMIT 1',
      [questionId]
    );
    const question = questionRows[0];
    if (!question) {
      throw new Error(`Question not found: ${questionId}`);
    }

    const noteId = question.noteId ? String(question.noteId) : null;
    if (!studySetId && !noteId) {
      throw new Error('Cannot move a deck-only card to No deck because it is not linked to a note');
    }

    let deckName: string | null = null;
    if (studySetId) {
      const setRows = this.select<{ name: string }>('SELECT name FROM study_sets WHERE id = ? LIMIT 1', [studySetId]);
      if (!setRows[0]) {
        throw new Error(`Study set not found: ${studySetId}`);
      }
      deckName = String(setRows[0].name);
    }

    const metadata = this.parseJson<Record<string, unknown>>(question.metadataJson, {});
    if (deckName) {
      metadata.deckName = deckName;
    } else {
      delete metadata.deckName;
    }

    db.run(
      'UPDATE questions SET study_set_id = ?, metadata_json = ?, updated_at = ? WHERE id = ?',
      [studySetId, JSON.stringify(metadata), now, questionId]
    );

    if (studySetId && noteId) {
      db.run(
        `
        INSERT INTO study_set_notes (study_set_id, note_id, added_at)
        VALUES (?, ?, ?)
        ON CONFLICT(study_set_id, note_id) DO NOTHING
        `,
        [studySetId, noteId, now]
      );
    }

    await this.persist();
  }

  async updateStudySet(input: {
    studySetId: string;
    name: string;
    description?: string | null;
  }): Promise<void> {
    const db = this.requireDb();
    const now = new Date().toISOString();
    const name = input.name.trim();
    if (!name) {
      throw new Error('Deck name cannot be empty');
    }

    db.run(
      'UPDATE study_sets SET name = ?, description = ?, updated_at = ? WHERE id = ?',
      [name, input.description?.trim() || null, now, input.studySetId]
    );

    const rows = this.select<Record<string, unknown>>(
      'SELECT id, metadata_json as metadataJson FROM questions WHERE study_set_id = ?',
      [input.studySetId]
    );
    for (const row of rows) {
      const metadata = this.parseJson<Record<string, unknown>>(row.metadataJson, {});
      metadata.deckName = name;
      db.run(
        'UPDATE questions SET metadata_json = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(metadata), now, String(row.id)]
      );
    }

    await this.persist();
  }

  async setStudySetEnabled(studySetId: string, enabled: boolean): Promise<void> {
    const db = this.requireDb();
    const now = new Date().toISOString();

    db.run(
      'UPDATE study_sets SET enabled = ?, updated_at = ? WHERE id = ?',
      [enabled ? 1 : 0, now, studySetId]
    );

    await this.persist();
  }

  async deleteEmptyStudySet(studySetId: string): Promise<void> {
    const db = this.requireDb();
    const countRows = this.select<{ count: number }>(
      'SELECT COUNT(*) as count FROM questions WHERE study_set_id = ?',
      [studySetId]
    );
    const questionCount = Number(countRows[0]?.count ?? 0);
    if (questionCount > 0) {
      throw new Error('Only empty decks can be deleted');
    }

    db.run('DELETE FROM study_sets WHERE id = ?', [studySetId]);
    await this.persist();
  }

  async updateQuestionContent(input: {
    questionId: string;
    questionName?: string | null;
    questionText: string;
    answerText?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const db = this.requireDb();
    const now = new Date().toISOString();

    if (input.metadata) {
      db.run(
        `
        UPDATE questions
        SET question_name = ?, question_text = ?, answer_text = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?
        `,
        [
          input.questionName ?? null,
          input.questionText,
          input.answerText ?? null,
          JSON.stringify(input.metadata),
          now,
          input.questionId,
        ]
      );
    } else {
      db.run(
        `
        UPDATE questions
        SET question_name = ?, question_text = ?, answer_text = ?, updated_at = ?
        WHERE id = ?
        `,
        [
          input.questionName ?? null,
          input.questionText,
          input.answerText ?? null,
          now,
          input.questionId,
        ]
      );
    }

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

  getStudySetReviewStats(now: Date = new Date()): StudySetReviewStats[] {
    const sets = this.getStudySets();
    return sets.map((set) => ({
      studySetId: set.id,
      name: set.name,
      description: set.description ?? null,
      enabled: set.enabled,
      totalCount: this.countReviewQuestions({ studySetId: set.id, includeNotDue: true, now }),
      dueCount: this.countReviewQuestions({ studySetId: set.id, now }),
      suspendedCount: this.countQuestionsByState(set.id, { enabled: false, archived: false }),
      archivedCount: this.countQuestionsByState(set.id, { archived: true }),
    }));
  }

  getReviewStats(now: Date = new Date()): ReviewStats {
    const todayStart = this.startOfLocalDay(now);
    const tomorrowStart = this.addDays(todayStart, 1);
    const sevenDaysAgo = this.addDays(todayStart, -6);
    const thirtyDaysAgo = this.addDays(todayStart, -29);

    const reviewedToday = this.countReviewsBetween(todayStart, tomorrowStart);
    const reviewedLast7Days = this.countReviewsBetween(sevenDaysAgo, tomorrowStart);
    const lapsesLast30Days = this.countReviewsBetween(thirtyDaysAgo, tomorrowStart, 0);

    return {
      reviewedToday,
      reviewedLast7Days,
      lapsesLast30Days,
      gradeDistributionLast30Days: this.getGradeDistribution(thirtyDaysAgo, tomorrowStart),
      dueForecast: this.getDueForecast(todayStart, 7),
      hardestCards: this.getHardestCards(5),
    };
  }

  getCardsForManagement(query: CardManagementQuery = {}): CardManagementRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.enabled !== null && query.enabled !== undefined) {
      conditions.push('q.enabled = ?');
      params.push(query.enabled ? 1 : 0);
    }

    if (query.archived !== null && query.archived !== undefined) {
      conditions.push(query.archived ? 'q.archived_at IS NOT NULL' : 'q.archived_at IS NULL');
    }

    if (Object.prototype.hasOwnProperty.call(query, 'studySetId')) {
      if (query.studySetId === null) {
        conditions.push('q.study_set_id IS NULL');
      } else if (query.studySetId) {
        conditions.push('q.study_set_id = ?');
        params.push(query.studySetId);
      }
    }

    if (query.questionType) {
      conditions.push('q.question_type = ?');
      params.push(query.questionType);
    }

    const search = query.search?.trim();
    if (search) {
      conditions.push('(q.question_text LIKE ? OR q.answer_text LIKE ? OR q.question_name LIKE ? OR n.note_path LIKE ? OR ss.name LIKE ?)');
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern, pattern, pattern);
    }

    params.push(query.limit ?? 200);

    const rows = this.select<Record<string, unknown>>(
      `
      SELECT
        q.id, q.note_id as noteId, n.note_path as notePath, n.note_title as noteTitle,
        q.study_set_id as studySetId, ss.name as studySetName,
        q.question_name as questionName, q.question_text as questionText,
        q.question_type as questionType, q.answer_text as answerText,
        q.metadata_json as metadataJson, q.enabled, q.archived_at as archivedAt, q.next_repeat_at as nextRepeatAt,
        q.last_reviewed_at as lastReviewedAt, q.created_at as createdAt, q.updated_at as updatedAt
      FROM questions q
      LEFT JOIN notes n ON n.id = q.note_id
      LEFT JOIN study_sets ss ON ss.id = q.study_set_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY q.archived_at IS NOT NULL ASC, q.enabled ASC, q.next_repeat_at ASC, q.updated_at DESC
      LIMIT ?
      `,
      params
    );

    return rows.map((row) => ({
      id: String(row.id),
      noteId: row.noteId ? String(row.noteId) : null,
      notePath: row.notePath ? String(row.notePath) : null,
      noteTitle: row.noteTitle ? String(row.noteTitle) : null,
      studySetId: row.studySetId ? String(row.studySetId) : null,
      studySetName: row.studySetName ? String(row.studySetName) : null,
      questionName: row.questionName ? String(row.questionName) : null,
      questionText: String(row.questionText),
      questionType: String(row.questionType),
      answerText: row.answerText ? String(row.answerText) : null,
      metadata: this.parseJson(row.metadataJson, {}),
      enabled: Number(row.enabled) === 1,
      archivedAt: row.archivedAt ? String(row.archivedAt) : null,
      nextRepeatAt: String(row.nextRepeatAt),
      lastReviewedAt: row.lastReviewedAt ? String(row.lastReviewedAt) : null,
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
    }));
  }

  getLatestNoteChat(noteId: string): NoteChatRecord | null {
    const rows = this.select<Record<string, unknown>>(
      `
      SELECT id, note_id as noteId, title, created_at as createdAt, updated_at as updatedAt,
        metadata_json as metadataJson
      FROM note_chats
      WHERE note_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
      `,
      [noteId]
    );

    return rows[0] ? this.mapNoteChat(rows[0]) : null;
  }

  getNoteChats(noteId: string): NoteChatRecord[] {
    return this.select<Record<string, unknown>>(
      `
      SELECT id, note_id as noteId, title, created_at as createdAt, updated_at as updatedAt,
        metadata_json as metadataJson
      FROM note_chats
      WHERE note_id = ?
      ORDER BY updated_at DESC
      `,
      [noteId]
    ).map((row) => this.mapNoteChat(row));
  }

  async createNoteChat(noteId: string, title?: string | null, metadata: Record<string, unknown> = {}): Promise<string> {
    const db = this.requireDb();
    const id = this.createId('chat');
    const now = new Date().toISOString();

    db.run(
      `
      INSERT INTO note_chats (id, note_id, title, created_at, updated_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [id, noteId, title ?? null, now, now, JSON.stringify(metadata)]
    );

    await this.persist();
    return id;
  }

  getNoteChatMessages(chatId: string): NoteChatMessageRecord[] {
    return this.select<Record<string, unknown>>(
      `
      SELECT id, chat_id as chatId, role, content, created_at as createdAt, metadata_json as metadataJson
      FROM note_chat_messages
      WHERE chat_id = ?
      ORDER BY created_at ASC
      `,
      [chatId]
    ).map((row) => ({
      id: String(row.id),
      chatId: String(row.chatId),
      role: this.normalizeChatRole(row.role),
      content: String(row.content),
      createdAt: String(row.createdAt),
      metadata: this.parseJson(row.metadataJson, {}),
    }));
  }

  async addNoteChatMessage(input: {
    chatId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<string> {
    const db = this.requireDb();
    const id = this.createId('message');
    const now = new Date().toISOString();

    db.run(
      `
      INSERT INTO note_chat_messages (id, chat_id, role, content, created_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [id, input.chatId, input.role, input.content, now, JSON.stringify(input.metadata ?? {})]
    );

    db.run('UPDATE note_chats SET updated_at = ? WHERE id = ?', [now, input.chatId]);

    await this.persist();
    return id;
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
        archived_at TEXT,
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

    this.ensureColumn('questions', 'archived_at', 'TEXT');
  }

  private ensureColumn(tableName: string, columnName: string, columnDefinition: string): void {
    const columns = this.select<{ name: string }>(`PRAGMA table_info(${tableName})`);
    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    this.requireDb().run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
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
    const defaultRel = '.obsidian/plugins/gpt4free-text-generator-plugin/sql-wasm.wasm';
    const configPath = this.config.wasmPath ?? defaultRel;
    const adapter = this.app.vault.adapter as any;

    // Build candidate paths — vault-relative only
    const candidates: string[] = [defaultRel];
    if (configPath !== defaultRel) {
      if (configPath.includes(':') || configPath.startsWith('/')) {
        const vaultRoot = (adapter as any).basePath || '';
        if (vaultRoot && configPath.toLowerCase().startsWith(vaultRoot.toLowerCase())) {
          const rel = configPath.slice(vaultRoot.length).replace(/\\/g, '/').replace(/^\//, '');
          candidates.unshift(rel);
        }
        const obsIdx = configPath.replace(/\\/g, '/').indexOf('.obsidian/');
        if (obsIdx >= 0) {
          const rel = configPath.replace(/\\/g, '/').slice(obsIdx);
          if (!candidates.includes(rel)) candidates.unshift(rel);
        }
      } else {
        candidates.unshift(configPath);
      }
    }

    for (const candidate of candidates) {
      const normalized = normalizePath(candidate);
      try {
        const exists = typeof adapter.exists === 'function' && await adapter.exists(normalized);
        if (exists) {
          if (typeof adapter.readBinary === 'function') {
            const buffer = await adapter.readBinary(normalized);
            return new Uint8Array(buffer);
          }
          if (typeof adapter.read === 'function') {
            const encoded = await adapter.read(normalized);
            return Uint8Array.from(Buffer.from(encoded, 'base64'));
          }
        }
      } catch (e) {
        // try next candidate
      }
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

  private buildQuestionFilter(query: Omit<ReviewQuestionQuery, 'limit'>, now: Date): { conditions: string[]; params: unknown[] } {
    const conditions = ['enabled = 1', 'archived_at IS NULL'];
    const params: unknown[] = [];

    if (!query.includeNotDue) {
      conditions.push('((should_reask = 1 AND reask_after_count <= 0) OR (should_reask = 0 AND next_repeat_at <= ?))');
      params.push(now.toISOString());
    }

    if (query.noteId) {
      conditions.push('note_id = ?');
      params.push(query.noteId);
    }

    if (Object.prototype.hasOwnProperty.call(query, 'studySetId')) {
      if (query.studySetId === null) {
        conditions.push('study_set_id IS NULL');
      } else if (query.studySetId) {
        conditions.push('study_set_id = ?');
        params.push(query.studySetId);
        conditions.push('EXISTS (SELECT 1 FROM study_sets ss WHERE ss.id = study_set_id AND ss.enabled = 1)');
      }
    } else {
      conditions.push('(study_set_id IS NULL OR EXISTS (SELECT 1 FROM study_sets ss WHERE ss.id = study_set_id AND ss.enabled = 1))');
    }

    return { conditions, params };
  }

  private countQuestionsByState(studySetId: string, filters: { enabled?: boolean; archived?: boolean }): number {
    const conditions = ['study_set_id = ?'];
    const params: unknown[] = [studySetId];

    if (filters.enabled !== undefined) {
      conditions.push('enabled = ?');
      params.push(filters.enabled ? 1 : 0);
    }

    if (filters.archived !== undefined) {
      conditions.push(filters.archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL');
    }

    const rows = this.select<{ count: number }>(
      `SELECT COUNT(*) as count FROM questions WHERE ${conditions.join(' AND ')}`,
      params
    );

    return Number(rows[0]?.count ?? 0);
  }

  private countReviewsBetween(start: Date, end: Date, grade?: number): number {
    const conditions = ['reviewed_at >= ?', 'reviewed_at < ?'];
    const params: unknown[] = [start.toISOString(), end.toISOString()];
    if (grade !== undefined) {
      conditions.push('grade = ?');
      params.push(grade);
    }

    const rows = this.select<{ count: number }>(
      `SELECT COUNT(*) as count FROM review_history WHERE ${conditions.join(' AND ')}`,
      params
    );

    return Number(rows[0]?.count ?? 0);
  }

  private getGradeDistribution(start: Date, end: Date): ReviewGradeCount[] {
    const rows = this.select<{ grade: number; count: number }>(
      `
      SELECT grade, COUNT(*) as count
      FROM review_history
      WHERE reviewed_at >= ? AND reviewed_at < ?
      GROUP BY grade
      ORDER BY grade ASC
      `,
      [start.toISOString(), end.toISOString()]
    );
    const counts = new Map(rows.map((row) => [Number(row.grade), Number(row.count)]));

    return [0, 1, 2, 3, 4].map((grade) => ({
      grade,
      count: counts.get(grade) ?? 0,
    }));
  }

  private getDueForecast(start: Date, dayCount: number): DueForecastDay[] {
    return Array.from({ length: dayCount }, (_, index) => {
      const dayStart = this.addDays(start, index);
      const dayEnd = this.addDays(dayStart, 1);
      const rows = this.select<{ count: number }>(
        `
        SELECT COUNT(*) as count
        FROM questions q
        LEFT JOIN study_sets ss ON ss.id = q.study_set_id
        WHERE q.enabled = 1
          AND q.archived_at IS NULL
          AND q.should_reask = 0
          AND q.next_repeat_at >= ?
          AND q.next_repeat_at < ?
          AND (q.study_set_id IS NULL OR ss.enabled = 1)
        `,
        [dayStart.toISOString(), dayEnd.toISOString()]
      );

      return {
        date: this.formatLocalDate(dayStart),
        dueCount: Number(rows[0]?.count ?? 0),
      };
    });
  }

  private getHardestCards(limit: number): HardCardStats[] {
    const rows = this.select<Record<string, unknown>>(
      `
      SELECT
        q.id as questionId, q.question_name as questionName, q.question_text as questionText,
        ss.name as studySetName, s.lapse_count as lapseCount,
        COUNT(rh.id) as reviewCount, AVG(rh.grade) as averageGrade
      FROM questions q
      LEFT JOIN study_sets ss ON ss.id = q.study_set_id
      LEFT JOIN schedules s ON s.question_id = q.id
      LEFT JOIN review_history rh ON rh.question_id = q.id
      WHERE q.archived_at IS NULL
        AND (q.study_set_id IS NULL OR ss.enabled = 1)
      GROUP BY q.id
      HAVING reviewCount > 0
      ORDER BY lapseCount DESC, averageGrade ASC, reviewCount DESC
      LIMIT ?
      `,
      [limit]
    );

    return rows.map((row) => ({
      questionId: String(row.questionId),
      questionName: row.questionName ? String(row.questionName) : null,
      questionText: String(row.questionText),
      studySetName: row.studySetName ? String(row.studySetName) : null,
      lapseCount: Number(row.lapseCount ?? 0),
      reviewCount: Number(row.reviewCount ?? 0),
      averageGrade: Number(row.averageGrade ?? 0),
    }));
  }

  private startOfLocalDay(value: Date): Date {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  private addDays(value: Date, days: number): Date {
    const next = new Date(value);
    next.setDate(next.getDate() + days);
    return next;
  }

  private formatLocalDate(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private mapNoteChat(row: Record<string, unknown>): NoteChatRecord {
    return {
      id: String(row.id),
      noteId: String(row.noteId),
      title: row.title ? String(row.title) : null,
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
      metadata: this.parseJson(row.metadataJson, {}),
    };
  }

  private normalizeChatRole(value: unknown): 'user' | 'assistant' | 'system' {
    if (value === 'assistant' || value === 'system') {
      return value;
    }

    return 'user';
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
