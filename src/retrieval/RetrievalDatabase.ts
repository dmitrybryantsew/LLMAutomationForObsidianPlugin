import { App, normalizePath } from 'obsidian';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { RetrievalChunkDraft, SearchHit, SearchRequest } from '../types/retrieval';
import { PlannedQuery } from './QueryPlanner';

const SCHEMA_VERSION = 1;

export interface RetrievalDatabaseConfig {
  dbPath: string;
  wasmPath?: string;
}

export interface IndexedFileRecord {
  sourceId: string;
  path: string;
  contentHash: string;
  modifiedTime: number;
  indexedAt: number;
}

export interface RetrievalDatabaseStats {
  chunkCount: number;
  fileCount: number;
  lastIndexedAt: number | null;
}

export class RetrievalDatabase {
  private app: App;
  private config: RetrievalDatabaseConfig;
  private sql: SqlJsStatic | null = null;
  private db: Database | null = null;
  private initialized = false;
  private initializePromise: Promise<void> | null = null;
  private pendingPersist = false;
  private persistPromise: Promise<void> | null = null;

  constructor(app: App, config: RetrievalDatabaseConfig) {
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

  async close(): Promise<void> {
    await this.flush();
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }

  async flush(): Promise<void> {
    if (this.persistPromise) {
      await this.persistPromise;
    }
    if (this.pendingPersist) {
      await this.persistNow();
    }
  }

  getStats(): RetrievalDatabaseStats {
    const chunkRows = this.select<{ count: number }>('SELECT COUNT(*) as count FROM retrieval_chunks');
    const fileRows = this.select<{ count: number }>('SELECT COUNT(*) as count FROM retrieval_files');
    const metaRows = this.select<{ value: string }>(
      "SELECT value FROM retrieval_meta WHERE key = 'last_indexed_at' LIMIT 1"
    );
    return {
      chunkCount: Number(chunkRows[0]?.count ?? 0),
      fileCount: Number(fileRows[0]?.count ?? 0),
      lastIndexedAt: metaRows[0]?.value ? Number(metaRows[0].value) : null,
    };
  }

  getFileRecord(sourceId: string, path: string): IndexedFileRecord | null {
    const rows = this.select<Record<string, unknown>>(
      `SELECT source_id as sourceId, path, content_hash as contentHash, modified_time as modifiedTime, indexed_at as indexedAt
       FROM retrieval_files WHERE source_id = ? AND path = ? LIMIT 1`,
      [sourceId, normalizePath(path)]
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      sourceId: String(row.sourceId),
      path: String(row.path),
      contentHash: String(row.contentHash),
      modifiedTime: Number(row.modifiedTime),
      indexedAt: Number(row.indexedAt),
    };
  }

  async replaceFileChunks(input: {
    sourceId: string;
    path: string;
    contentHash: string;
    modifiedTime: number;
    chunks: RetrievalChunkDraft[];
  }): Promise<void> {
    const db = this.requireDb();
    const normalizedPath = normalizePath(input.path);
    const now = Date.now();

    db.run('BEGIN');
    try {
      db.run('DELETE FROM retrieval_chunks WHERE source_id = ? AND path = ?', [input.sourceId, normalizedPath]);
      db.run('DELETE FROM retrieval_fts WHERE source_id = ? AND path = ?', [input.sourceId, normalizedPath]);

      for (const chunk of input.chunks) {
        db.run(
          `INSERT INTO retrieval_chunks (
            id, source_id, path, basename, heading_path_json, start_line, end_line,
            text, normalized_text, tags_json, links_json, content_hash, modified_time
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            chunk.id,
            chunk.sourceId,
            normalizePath(chunk.path),
            chunk.basename,
            JSON.stringify(chunk.headingPath),
            chunk.startLine,
            chunk.endLine,
            chunk.text,
            chunk.normalizedText,
            JSON.stringify(chunk.tags),
            JSON.stringify(chunk.outboundLinks),
            chunk.contentHash,
            chunk.modifiedTime,
          ]
        );
        db.run(
          `INSERT INTO retrieval_fts (
            id, source_id, path, basename, heading_path_json, normalized_text, tags_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            chunk.id,
            chunk.sourceId,
            normalizePath(chunk.path),
            chunk.basename,
            JSON.stringify(chunk.headingPath),
            chunk.normalizedText,
            JSON.stringify(chunk.tags),
          ]
        );
      }

      db.run(
        `INSERT INTO retrieval_files (source_id, path, content_hash, modified_time, indexed_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(source_id, path) DO UPDATE SET
           content_hash = excluded.content_hash,
           modified_time = excluded.modified_time,
           indexed_at = excluded.indexed_at`,
        [input.sourceId, normalizedPath, input.contentHash, input.modifiedTime, now]
      );
      db.run(
        `INSERT INTO retrieval_meta (key, value) VALUES ('last_indexed_at', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [String(now)]
      );
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }

    this.schedulePersist();
  }

  async removeFile(sourceId: string, path: string): Promise<void> {
    const db = this.requireDb();
    const normalizedPath = normalizePath(path);
    db.run('BEGIN');
    try {
      db.run('DELETE FROM retrieval_chunks WHERE source_id = ? AND path = ?', [sourceId, normalizedPath]);
      db.run('DELETE FROM retrieval_fts WHERE source_id = ? AND path = ?', [sourceId, normalizedPath]);
      db.run('DELETE FROM retrieval_files WHERE source_id = ? AND path = ?', [sourceId, normalizedPath]);
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
    this.schedulePersist();
  }

  async removeMissingFiles(sourceId: string, observedPaths: Set<string>): Promise<number> {
    const rows = this.select<{ path: string }>(
      'SELECT path FROM retrieval_files WHERE source_id = ?',
      [sourceId]
    );
    let deleted = 0;
    for (const row of rows) {
      if (!observedPaths.has(row.path)) {
        await this.removeFile(sourceId, row.path);
        deleted++;
      }
    }
    return deleted;
  }

  async clearAll(): Promise<void> {
    const db = this.requireDb();
    db.run('BEGIN');
    try {
      db.run('DELETE FROM retrieval_fts');
      db.run('DELETE FROM retrieval_chunks');
      db.run('DELETE FROM retrieval_files');
      db.run('DELETE FROM retrieval_meta WHERE key = ?', ['last_indexed_at']);
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
    this.schedulePersist();
  }

  search(planned: PlannedQuery, request: SearchRequest): SearchHit[] {
    const candidateLimit = request.lexicalCandidateLimit ?? 50;
    const params: unknown[] = [];
    let where = 'retrieval_fts MATCH ?';
    params.push(planned.ftsQuery);

    if (request.sourceIds?.length) {
      where += ` AND retrieval_fts.source_id IN (${request.sourceIds.map(() => '?').join(', ')})`;
      params.push(...request.sourceIds);
    }
    if (request.folderPrefix) {
      where += ' AND retrieval_fts.path LIKE ?';
      params.push(`${normalizePath(request.folderPrefix)}%`);
    }
    if (request.tags?.length) {
      for (const tag of request.tags) {
        where += ' AND retrieval_fts.tags_json LIKE ?';
        params.push(`%"${tag}"%`);
      }
    }

    const sql = `
      SELECT
        c.id,
        c.source_id as sourceId,
        c.path,
        c.basename,
        c.heading_path_json as headingPathJson,
        c.start_line as startLine,
        c.end_line as endLine,
        c.text,
        c.normalized_text as normalizedText,
        c.tags_json as tagsJson,
        c.links_json as linksJson,
        c.content_hash as contentHash,
        c.modified_time as modifiedTime,
        bm25(retrieval_fts) as lexicalScore
      FROM retrieval_fts
      JOIN retrieval_chunks c ON c.id = retrieval_fts.id
      WHERE ${where}
      ORDER BY lexicalScore ASC
      LIMIT ?
    `;
    params.push(candidateLimit);

    const rows = this.select<Record<string, unknown>>(sql, params);
    return rows.map((row) => this.rowToSearchHit(row));
  }

  private rowToSearchHit(row: Record<string, unknown>): SearchHit {
    const lexicalScore = Number(row.lexicalScore ?? 0);
    return {
      id: String(row.id),
      sourceId: String(row.sourceId),
      path: String(row.path),
      basename: String(row.basename),
      headingPath: JSON.parse(String(row.headingPathJson ?? '[]')),
      startLine: Number(row.startLine),
      endLine: Number(row.endLine),
      text: String(row.text),
      normalizedText: String(row.normalizedText),
      tags: JSON.parse(String(row.tagsJson ?? '[]')),
      outboundLinks: JSON.parse(String(row.linksJson ?? '[]')),
      contentHash: String(row.contentHash),
      modifiedTime: Number(row.modifiedTime),
      lexicalScore,
      finalScore: lexicalScore,
      matchReasons: ['lexical'],
    };
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
    await this.persistNow();
    this.initialized = true;
  }

  private applyMigrations(): void {
    const db = this.requireDb();
    db.run('PRAGMA foreign_keys = ON');
    db.run(`
      CREATE TABLE IF NOT EXISTS retrieval_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS retrieval_files (
        source_id TEXT NOT NULL,
        path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        modified_time INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL,
        PRIMARY KEY (source_id, path)
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS retrieval_chunks (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        path TEXT NOT NULL,
        basename TEXT NOT NULL,
        heading_path_json TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        text TEXT NOT NULL,
        normalized_text TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        links_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        modified_time INTEGER NOT NULL
      );
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_chunks_source_path ON retrieval_chunks(source_id, path)');
    db.run('CREATE INDEX IF NOT EXISTS idx_chunks_path ON retrieval_chunks(path)');

    const ftsExists = this.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'retrieval_fts'"
    );
    if (ftsExists.length === 0) {
      db.run(`
        CREATE VIRTUAL TABLE retrieval_fts USING fts5(
          id UNINDEXED,
          source_id UNINDEXED,
          path UNINDEXED,
          basename,
          heading_path_json,
          normalized_text,
          tags_json
        );
      `);
    }

    const versionRows = this.select<{ value: string }>(
      "SELECT value FROM retrieval_meta WHERE key = 'schema_version' LIMIT 1"
    );
    const currentVersion = Number(versionRows[0]?.value ?? 0);
    if (currentVersion < SCHEMA_VERSION) {
      db.run(
        `INSERT INTO retrieval_meta (key, value) VALUES ('schema_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [String(SCHEMA_VERSION)]
      );
    }
  }

  private schedulePersist(): void {
    this.pendingPersist = true;
    if (!this.persistPromise) {
      this.persistPromise = this.persistNow().finally(() => {
        this.persistPromise = null;
      });
    }
  }

  private async persistNow(): Promise<void> {
    const adapter = this.app.vault.adapter as any;
    const db = this.requireDb();
    const bytes = db.export();
    this.pendingPersist = false;

    if (typeof adapter.writeBinary === 'function') {
      await adapter.writeBinary(
        this.config.dbPath,
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      );
      return;
    }

    await adapter.write(this.config.dbPath, Buffer.from(bytes).toString('base64'));
  }

  private async ensureParentDirectory(): Promise<void> {
    const adapter = this.app.vault.adapter as any;
    const parts = this.config.dbPath.split('/');
    parts.pop();
    const dir = parts.join('/');
    if (!dir) {
      return;
    }
    if (typeof adapter.exists === 'function' && await adapter.exists(dir)) {
      return;
    }
    if (typeof adapter.mkdir === 'function') {
      await adapter.mkdir(dir);
    }
  }

  private async readDatabaseBytes(): Promise<Uint8Array | null> {
    const adapter = this.app.vault.adapter as any;
    try {
      if (typeof adapter.exists === 'function' && !(await adapter.exists(this.config.dbPath))) {
        return null;
      }
      if (typeof adapter.readBinary === 'function') {
        const buffer = await adapter.readBinary(this.config.dbPath);
        return new Uint8Array(buffer);
      }
      const encoded = await adapter.read(this.config.dbPath);
      return Uint8Array.from(Buffer.from(encoded, 'base64'));
    } catch {
      return null;
    }
  }

  private async readWasmBinary(): Promise<Uint8Array | null> {
    const adapter = this.app.vault.adapter as any;
    const wasmPath = this.config.wasmPath ?? '.obsidian/plugins/gpt4free-text-generator-plugin/sql-wasm.wasm';
    try {
      if (typeof adapter.readBinary === 'function' && await adapter.exists(wasmPath)) {
        const buffer = await adapter.readBinary(wasmPath);
        return new Uint8Array(buffer);
      }
    } catch {
      // fall through
    }
    return null;
  }

  private requireDb(): Database {
    if (!this.db) {
      throw new Error('RetrievalDatabase is not initialized');
    }
    return this.db;
  }

  private select<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    const statement = this.requireDb().prepare(sql);
    const rows: T[] = [];
    statement.bind(params);
    while (statement.step()) {
      rows.push(statement.getAsObject() as T);
    }
    statement.free();
    return rows;
  }
}
