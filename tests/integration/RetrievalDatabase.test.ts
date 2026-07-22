import { describe, expect, it, beforeEach, vi } from 'vitest';
import { QueryPlanner } from '../../src/retrieval/QueryPlanner';
import { fnv1aHash, normalizeRetrievalText } from '../../src/retrieval/hashUtils';
import { initFts5SqlJs } from '../helpers/fts5Wasm';
import {
  createRetrievalMockVault,
  ADAPTER_WASM_PATH,
  DEFAULT_DB_PATH,
} from '../helpers/retrievalMockVault';

// The production RetrievalDatabase imports `initSqlJs` from the npm `sql.js`
// package, whose JS loader is built against a different Emscripten version
// than our FTS5-enabled wasm. Mixing them produces "file is not a database".
// Swap the npm loader for the vendored FTS5 loader so tests use the same
// matched pair that production must use.
vi.mock('sql.js', () => ({
  default: initFts5SqlJs(),
}));

// Import RetrievalDatabase AFTER vi.mock so it picks up the swapped loader.
const { RetrievalDatabase } = await import('../../src/retrieval/RetrievalDatabase');
const { chunkMarkdown } = await import('../../src/retrieval/MarkdownChunker');

const SRC = 'src-test';

function makeChunks(path: string, content: string, mtime: number) {
  return chunkMarkdown({ sourceId: SRC, path, content, modifiedTime: mtime });
}

function index(db: RetrievalDatabase, path: string, content: string, mtime: number) {
  const chunks = makeChunks(path, content, mtime);
  const hash = fnv1aHash(normalizeRetrievalText(content));
  return db.replaceFileChunks({ sourceId: SRC, path, contentHash: hash, modifiedTime: mtime, chunks });
}

describe('RetrievalDatabase (integration)', () => {
  let mock: ReturnType<typeof createRetrievalMockVault>;

  beforeEach(() => {
    mock = createRetrievalMockVault();
  });

  async function makeDb(dbPath = DEFAULT_DB_PATH): Promise<RetrievalDatabase> {
    const db = new RetrievalDatabase(mock.app as any, { dbPath, wasmPath: ADAPTER_WASM_PATH });
    await db.initialize();
    return db;
  }

  describe('schema and initialization', () => {
    it('creates the SQLite file in the adapter on first init', async () => {
      await makeDb();
      expect(mock.binaryFiles.has(DEFAULT_DB_PATH)).toBe(true);
    });

    it('is a no-op to initialize twice', async () => {
      const db = await makeDb();
      await expect(db.initialize()).resolves.toBeUndefined();
    });

    it('starts empty', async () => {
      const db = await makeDb();
      const stats = db.getStats();
      expect(stats.chunkCount).toBe(0);
      expect(stats.fileCount).toBe(0);
      expect(stats.lastIndexedAt).toBeNull();
    });
  });

  describe('insert / update / delete', () => {
    it('inserts chunks and counts them in stats', async () => {
      const db = await makeDb();
      await index(db, 'notes/a.md', '# Heading\n\nBody text.', 1000);
      const stats = db.getStats();
      expect(stats.chunkCount).toBe(1);
      expect(stats.fileCount).toBe(1);
      expect(stats.lastIndexedAt).not.toBeNull();
    });

    it('returns a file record after indexing', async () => {
      const db = await makeDb();
      await index(db, 'notes/a.md', '# H\n\nBody.', 1000);
      const rec = db.getFileRecord(SRC, 'notes/a.md');
      expect(rec).not.toBeNull();
      expect(rec?.path).toBe('notes/a.md');
      expect(rec?.modifiedTime).toBe(1000);
      expect(rec?.contentHash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('returns null for an unknown file record', async () => {
      const db = await makeDb();
      expect(db.getFileRecord(SRC, 'notes/missing.md')).toBeNull();
    });

    it('replaces chunks when the same file is re-indexed', async () => {
      const db = await makeDb();
      await index(db, 'notes/a.md', '# H1\n\nA.\n\n# H2\n\nB.', 1000);
      expect(db.getStats().chunkCount).toBe(2);
      // Re-index with different content -> old chunks removed, new ones inserted.
      await index(db, 'notes/a.md', '# H1\n\nA.\n\n# H2\n\nB.\n\n# H3\n\nC.', 2000);
      expect(db.getStats().chunkCount).toBe(3);
      const rec = db.getFileRecord(SRC, 'notes/a.md');
      expect(rec?.modifiedTime).toBe(2000);
    });

    it('removes chunks and the file record on removeFile', async () => {
      const db = await makeDb();
      await index(db, 'notes/a.md', '# H\n\nBody.', 1000);
      await db.removeFile(SRC, 'notes/a.md');
      expect(db.getStats().chunkCount).toBe(0);
      expect(db.getStats().fileCount).toBe(0);
      expect(db.getFileRecord(SRC, 'notes/a.md')).toBeNull();
    });

    it('removes files no longer in the observed set via removeMissingFiles', async () => {
      const db = await makeDb();
      await index(db, 'notes/a.md', '# H\n\nA.', 1000);
      await index(db, 'notes/b.md', '# H\n\nB.', 1000);
      const deleted = await db.removeMissingFiles(SRC, new Set(['notes/a.md']));
      expect(deleted).toBe(1);
      expect(db.getFileRecord(SRC, 'notes/a.md')).not.toBeNull();
      expect(db.getFileRecord(SRC, 'notes/b.md')).toBeNull();
    });

    it('clearAll empties every table', async () => {
      const db = await makeDb();
      await index(db, 'notes/a.md', '# H\n\nA.', 1000);
      await index(db, 'notes/b.md', '# H\n\nB.', 1000);
      await db.clearAll();
      expect(db.getStats().chunkCount).toBe(0);
      expect(db.getStats().fileCount).toBe(0);
    });
  });

  describe('FTS5 search', () => {
    beforeEach(async () => {
      // shared setup happens per-test via makeDb; nothing to do here
    });

    it('returns ranked hits matching a query term', async () => {
      const db = await makeDb();
      await index(db, 'notes/python.md', '# Python Setup\n\nInstall Python 3.11 and pip.', 1000);
      await index(db, 'notes/rust.md', '# Rust Setup\n\nInstall rustc and cargo.', 1000);
      const planned = QueryPlanner.plan('python');
      const hits = db.search(planned, { query: 'python' });
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(hits.some((h) => h.path === 'notes/python.md')).toBe(true);
      expect(hits.some((h) => h.path === 'notes/rust.md')).toBe(false);
    });

    it('ranks better matches lower (bm25 ascending)', async () => {
      const db = await makeDb();
      await index(db, 'notes/a.md', '# Python\n\npython python python python python', 1000);
      await index(db, 'notes/b.md', '# Other\n\npython', 1000);
      const planned = QueryPlanner.plan('python');
      const hits = db.search(planned, { query: 'python' });
      expect(hits.length).toBe(2);
      // bm25 is ascending: lower lexicalScore = better match.
      expect(hits[0].lexicalScore).toBeLessThanOrEqual(hits[1].lexicalScore);
    });

    it('filters by sourceIds', async () => {
      const db = await makeDb();
      await index(db, 'notes/a.md', '# H\n\nshared term xyz', 1000);
      // index the same path under a different source id
      const chunks2 = makeChunks('notes/b.md', '# H\n\nshared term xyz', 1000);
      await db.replaceFileChunks({
        sourceId: 'src-other',
        path: 'notes/b.md',
        contentHash: fnv1aHash(normalizeRetrievalText('shared term xyz')),
        modifiedTime: 1000,
        chunks: chunks2.map((c) => ({ ...c, sourceId: 'src-other' })),
      });
      const planned = QueryPlanner.plan('shared');
      const hits = db.search(planned, { query: 'shared', sourceIds: ['src-other'] });
      expect(hits.every((h) => h.sourceId === 'src-other')).toBe(true);
    });

    it('filters by folderPrefix', async () => {
      const db = await makeDb();
      await index(db, 'docs/intro.md', '# H\n\nshared term', 1000);
      await index(db, 'notes/intro.md', '# H\n\nshared term', 1000);
      const planned = QueryPlanner.plan('shared');
      const hits = db.search(planned, { query: 'shared', folderPrefix: 'docs' });
      expect(hits.every((h) => h.path.startsWith('docs'))).toBe(true);
    });

    it('filters by tags', async () => {
      const db = await makeDb();
      await index(db, 'notes/a.md', '---\ntags: [python, setup]\n---\n\n# H\n\npython setup', 1000);
      await index(db, 'notes/b.md', '---\ntags: [rust]\n---\n\n# H\n\npython setup', 1000);
      const planned = QueryPlanner.plan('python');
      const hits = db.search(planned, { query: 'python', tags: ['python'] });
      expect(hits.every((h) => h.tags.includes('python'))).toBe(true);
    });

    it('returns an empty array when nothing matches', async () => {
      const db = await makeDb();
      await index(db, 'notes/a.md', '# H\n\ncompletely unrelated text', 1000);
      const planned = QueryPlanner.plan('zzzznomatch');
      const hits = db.search(planned, { query: 'zzzznomatch' });
      expect(hits).toEqual([]);
    });

    it('escapes FTS special characters in the query', async () => {
      const db = await makeDb();
      await index(db, 'notes/api.md', '# API\n\nThe `app.vault.read` function.', 1000);
      // Dotted identifier -> exact token -> quoted in FTS, no syntax error.
      const planned = QueryPlanner.plan('app.vault.read');
      expect(() => db.search(planned, { query: 'app.vault.read' })).not.toThrow();
      const hits = db.search(planned, { query: 'app.vault.read' });
      expect(hits.some((h) => h.path === 'notes/api.md')).toBe(true);
    });
  });

  describe('persistence', () => {
    it('survives close and re-open with the same adapter', async () => {
      const db = await makeDb();
      await index(db, 'notes/persist.md', '# Persistent\n\nThis must survive reload.', 1000);
      await db.close();

      // Re-open: a new RetrievalDatabase reading the same persisted bytes.
      const db2 = new RetrievalDatabase(mock.app as any, {
        dbPath: DEFAULT_DB_PATH,
        wasmPath: ADAPTER_WASM_PATH,
      });
      await db2.initialize();
      expect(db2.getStats().chunkCount).toBe(1);
      expect(db2.getFileRecord(SRC, 'notes/persist.md')).not.toBeNull();
      const planned = QueryPlanner.plan('persistent');
      const hits = db2.search(planned, { query: 'persistent' });
      expect(hits.some((h) => h.path === 'notes/persist.md')).toBe(true);
      await db2.close();
    });

    it('flush writes pending changes to the adapter', async () => {
      const db = await makeDb();
      await index(db, 'notes/a.md', '# H\n\nFlushed.', 1000);
      await db.flush();
      expect(mock.binaryFiles.has(DEFAULT_DB_PATH)).toBe(true);
      const persisted = mock.binaryFiles.get(DEFAULT_DB_PATH)!;
      expect(persisted.byteLength).toBeGreaterThan(0);
    });
  });

  describe('concurrency guards', () => {
    it('does not initialize twice concurrently', async () => {
      const db = new RetrievalDatabase(mock.app as any, {
        dbPath: DEFAULT_DB_PATH,
        wasmPath: ADAPTER_WASM_PATH,
      });
      const [a, b] = await Promise.all([db.initialize(), db.initialize()]);
      expect(a).toBeUndefined();
      expect(b).toBeUndefined();
      await db.close();
    });
  });
});
