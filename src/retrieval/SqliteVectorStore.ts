import { normalizePath } from 'obsidian';
import { Database } from 'sql.js';
import {
  VectorHit,
  VectorIndexStatus,
  VectorSearchFilters,
  VectorStore,
  VectorUpsertRow,
} from '../types/retrieval';
import { RetrievalDatabase } from './RetrievalDatabase';

const VECTOR_SCHEMA_VERSION = 1;

export class SqliteVectorStore implements VectorStore {
  constructor(private database: RetrievalDatabase) {}

  async initialize(): Promise<void> {
    const db = this.requireDb();
    db.run('PRAGMA foreign_keys = ON');
    db.run(`
      CREATE TABLE IF NOT EXISTS retrieval_vectors (
        chunk_id TEXT NOT NULL,
        chunk_hash TEXT NOT NULL,
        model_id TEXT NOT NULL,
        preprocessing_version TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (chunk_id, model_id)
      );
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_vectors_model ON retrieval_vectors(model_id)');

    const versionRows = this.select<{ value: string }>(
      "SELECT value FROM retrieval_meta WHERE key = 'vector_schema_version' LIMIT 1"
    );
    const currentVersion = Number(versionRows[0]?.value ?? 0);
    if (currentVersion < VECTOR_SCHEMA_VERSION) {
      db.run(
        `INSERT INTO retrieval_meta (key, value) VALUES ('vector_schema_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [String(VECTOR_SCHEMA_VERSION)]
      );
    }
  }

  async upsert(rows: VectorUpsertRow[]): Promise<void> {
    if (rows.length === 0) return;
    const db = this.requireDb();
    const now = Date.now();
    db.run('BEGIN');
    try {
      for (const row of rows) {
        const vectorBlob = this.float32ToBlob(row.vector);
        db.run(
          `INSERT INTO retrieval_vectors (
            chunk_id, chunk_hash, model_id, preprocessing_version, dimensions, vector, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(chunk_id, model_id) DO UPDATE SET
            chunk_hash = excluded.chunk_hash,
            preprocessing_version = excluded.preprocessing_version,
            dimensions = excluded.dimensions,
            vector = excluded.vector,
            created_at = excluded.created_at`,
          [
            row.chunkId,
            row.chunkHash,
            row.modelId,
            row.preprocessingVersion,
            row.vector.length,
            vectorBlob,
            now,
          ]
        );
      }
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
    this.database['schedulePersist']();
  }

  async search(
    queryVector: Float32Array,
    filters: VectorSearchFilters,
    limit: number
  ): Promise<VectorHit[]> {
    const db = this.requireDb();
    const params: unknown[] = [];
    let where = '1=1';

    if (filters.sourceIds?.length) {
      where += ` AND c.source_id IN (${filters.sourceIds.map(() => '?').join(', ')})`;
      params.push(...filters.sourceIds);
    }
    if (filters.folderPrefix) {
      where += ' AND c.path LIKE ?';
      params.push(`${normalizePath(filters.folderPrefix)}%`);
    }
    if (filters.tags?.length) {
      for (const tag of filters.tags) {
        where += ' AND c.tags_json LIKE ?';
        params.push(`%"${tag}"%`);
      }
    }

    const rows = this.select<{
      chunk_id: string;
      vector: Uint8Array;
      source_id: string;
      path: string;
      basename: string;
      heading_path_json: string;
      start_line: number;
      end_line: number;
      text: string;
      normalized_text: string;
      tags_json: string;
      content_hash: string;
      modified_time: number;
    }>(
      `SELECT v.chunk_id, v.vector, c.source_id, c.path, c.basename,
              c.heading_path_json, c.start_line, c.end_line, c.text,
              c.normalized_text, c.tags_json, c.content_hash, c.modified_time
       FROM retrieval_vectors v
       JOIN retrieval_chunks c ON c.id = v.chunk_id
       WHERE ${where}`,
      params
    );

    const queryNorm = this.norm(queryVector);
    if (queryNorm === 0) return [];

    const scored = rows
      .map((row) => {
        const vec = this.blobToFloat32(row.vector);
        const sim = this.cosineSimilarity(queryVector, queryNorm, vec);
        return {
          chunkId: String(row.chunk_id),
          similarity: sim,
          sourceId: String(row.source_id),
          path: String(row.path),
          basename: String(row.basename),
          headingPath: JSON.parse(String(row.heading_path_json ?? '[]')),
          startLine: Number(row.start_line),
          endLine: Number(row.end_line),
          text: String(row.text),
          normalizedText: String(row.normalized_text),
          tags: JSON.parse(String(row.tags_json ?? '[]')),
          contentHash: String(row.content_hash),
          modifiedTime: Number(row.modified_time),
        };
      })
      .filter((hit) => hit.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return scored;
  }

  async removeChunkIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = this.requireDb();
    db.run('BEGIN');
    try {
      for (const id of ids) {
        db.run('DELETE FROM retrieval_vectors WHERE chunk_id = ?', [id]);
      }
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
    this.database['schedulePersist']();
  }

  async removeByModel(modelId: string): Promise<number> {
    const db = this.requireDb();
    const countRows = this.select<{ count: number }>(
      'SELECT COUNT(*) as count FROM retrieval_vectors WHERE model_id = ?',
      [modelId]
    );
    const count = Number(countRows[0]?.count ?? 0);
    db.run('DELETE FROM retrieval_vectors WHERE model_id = ?', [modelId]);
    this.database['schedulePersist']();
    return count;
  }

  async getStatus(): Promise<VectorIndexStatus> {
    const rows = this.select<{ model_id: string; dimensions: number; count: number }>(
      `SELECT model_id, dimensions, COUNT(*) as count
       FROM retrieval_vectors
       GROUP BY model_id, dimensions
       ORDER BY count DESC
       LIMIT 1`
    );
    const row = rows[0];
    if (!row || row.count === 0) {
      return {
        state: 'empty',
        modelId: null,
        dimensions: 0,
        vectorCount: 0,
        lastBuiltAt: null,
        lastError: null,
        buildProgress: null,
        buildTotal: null,
      };
    }
    return {
      state: 'ready',
      modelId: String(row.model_id),
      dimensions: Number(row.dimensions),
      vectorCount: Number(row.count),
      lastBuiltAt: null,
      lastError: null,
      buildProgress: null,
      buildTotal: null,
    };
  }

  getVectorsForChunk(chunkId: string): { modelId: string; vector: Float32Array; chunkHash: string }[] {
    const rows = this.select<{
      model_id: string;
      vector: Uint8Array;
      chunk_hash: string;
    }>(
      'SELECT model_id, vector, chunk_hash FROM retrieval_vectors WHERE chunk_id = ?',
      [chunkId]
    );
    return rows.map((row) => ({
      modelId: String(row.model_id),
      vector: this.blobToFloat32(row.vector),
      chunkHash: String(row.chunk_hash),
    }));
  }

  getChunkIdsForModel(modelId: string): string[] {
    const rows = this.select<{ chunk_id: string }>(
      'SELECT chunk_id FROM retrieval_vectors WHERE model_id = ?',
      [modelId]
    );
    return rows.map((row) => String(row.chunk_id));
  }

  private float32ToBlob(vec: Float32Array): Uint8Array {
    return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
  }

  private blobToFloat32(blob: Uint8Array): Float32Array {
    const copy = new Uint8Array(blob.length);
    copy.set(blob);
    return new Float32Array(copy.buffer);
  }

  private norm(vec: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < vec.length; i++) {
      sum += vec[i] * vec[i];
    }
    return Math.sqrt(sum);
  }

  private cosineSimilarity(a: Float32Array, aNorm: number, b: Float32Array): number {
    const bNorm = this.norm(b);
    if (bNorm === 0) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return dot / (aNorm * bNorm);
  }

  private requireDb(): Database {
    return (this.database as any).requireDb();
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
