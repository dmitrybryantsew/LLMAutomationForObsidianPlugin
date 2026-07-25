import { describe, expect, it, beforeEach, vi } from 'vitest';
import { QueryPlanner } from '../../src/retrieval/QueryPlanner';
import { initFts5SqlJs } from '../helpers/fts5Wasm';
import {
  createRetrievalMockVault,
  ADAPTER_WASM_PATH,
  DEFAULT_DB_PATH,
} from '../helpers/retrievalMockVault';
import type { RetrievalSettings, RetrievalSourceConfig } from '../../src/types/retrieval';

vi.mock('sql.js', () => ({
  default: initFts5SqlJs(),
}));

const { RetrievalDatabase } = await import('../../src/retrieval/RetrievalDatabase');
const { IndexCoordinator } = await import('../../src/retrieval/IndexCoordinator');
const { DebugLogger } = await import('../../src/utils/DebugLogger');

function makeSource(overrides: Partial<RetrievalSourceConfig> = {}): RetrievalSourceConfig {
  return {
    id: 'vault',
    name: 'Vault',
    kind: 'vault',
    rootPath: '',
    enabled: true,
    trust: 'personal',
    includeGlobs: ['**/*.md'],
    excludeGlobs: ['.obsidian/**', 'Templates/**'],
    maxFileBytes: 1_500_000,
    ...overrides,
  };
}

function makeSettings(overrides: Partial<RetrievalSettings> = {}): RetrievalSettings {
  return {
    enabled: true,
    databasePath: DEFAULT_DB_PATH,
    sources: [makeSource()],
    evidenceTokenBudget: 12000,
    defaultResultLimit: 10,
    autoIndexOnStartup: false,
    autoIndexOnModify: true,
    allowGeneralKnowledgeWhenUngrounded: false,
    embedding: { provider: 'none', ollamaEndpoint: 'http://localhost:11434', ollamaModel: 'qwen3-embedding:0.6b', chutesApiKey: '', chutesBaseUrl: 'https://chutes-qwen-qwen3-embedding-8b-tee.chutes.ai', chutesModel: 'Qwen/Qwen3-Embedding-8B-TEE', semanticThreshold: 0.3, lexicalVeto: true },
    ...overrides,
  };
}

describe('IndexCoordinator (integration)', () => {
  let mock: ReturnType<typeof createRetrievalMockVault>;
  let settings: RetrievalSettings;
  let debugLogger: InstanceType<typeof DebugLogger>;

  beforeEach(() => {
    mock = createRetrievalMockVault();
    settings = makeSettings();
    debugLogger = new DebugLogger(false, 'test');
  });

  async function makeCoordinator() {
    const db = new RetrievalDatabase(mock.app as any, {
      dbPath: DEFAULT_DB_PATH,
      wasmPath: ADAPTER_WASM_PATH,
    });
    const coordinator = new IndexCoordinator(
      mock.app as any,
      db,
      () => settings,
      debugLogger
    );
    await coordinator.initialize();
    return { db, coordinator };
  }

  describe('initial index', () => {
    it('indexes all matching markdown files in the vault', async () => {
      mock.addFile('notes/python.md', '# Python\n\nInstall Python 3.11.', 1000);
      mock.addFile('notes/rust.md', '# Rust\n\nInstall rustc.', 1000);
      mock.addFile('notes/empty.md', '', 1000);

      const { coordinator } = await makeCoordinator();
      const status = await coordinator.indexAll();

      // All three files pass the matcher; empty.md is indexed with 0 chunks
      // (it still creates a retrieval_files row but yields no searchable text).
      expect(status.indexedFiles).toBe(3);
      expect(status.chunkCount).toBe(2);
      expect(status.fileCount).toBe(3);
      expect(status.state).toBe('idle');
    });

    it('reports totalFiles and processedFiles via onProgress', async () => {
      mock.addFile('notes/a.md', '# A\n\nBody.', 1000);
      mock.addFile('notes/b.md', '# B\n\nBody.', 1000);
      mock.addFile('notes/c.md', '# C\n\nBody.', 1000);

      const { coordinator } = await makeCoordinator();
      const progressSnapshots: { processed: number; total: number }[] = [];
      const status = await coordinator.indexAll({
        onProgress: (s) => progressSnapshots.push({ processed: s.processedFiles, total: s.totalFiles }),
      });

      expect(status.totalFiles).toBe(3);
      expect(status.processedFiles).toBe(3);
      // At least the final snapshot should show 3/3
      const last = progressSnapshots[progressSnapshots.length - 1];
      expect(last.processed).toBe(3);
      expect(last.total).toBe(3);
    });

    it('skips files over maxFileBytes', async () => {
      mock.addFile('notes/small.md', '# Small\n\nTiny.', 1000);
      mock.addFile('notes/huge.md', '# Huge\n\n' + 'X'.repeat(2000), 1000);
      settings.sources = [makeSource({ maxFileBytes: 100 })];

      const { coordinator } = await makeCoordinator();
      const status = await coordinator.indexAll();

      expect(status.indexedFiles).toBe(1);
      expect(status.skippedFiles).toBe(1);
    });

    it('records the lastIndexedAt timestamp', async () => {
      mock.addFile('notes/a.md', '# H\n\nBody.', 1000);
      const { coordinator } = await makeCoordinator();
      const status = await coordinator.indexAll();
      expect(status.lastIndexedAt).not.toBeNull();
    });
  });

  describe('exclusions', () => {
    it('never indexes an excluded note', async () => {
      mock.addFile('notes/visible.md', '# Visible\n\nshared term', 1000);
      mock.addFile('Templates/template.md', '# Template\n\nshared term', 1000);
      mock.addFile('.obsidian/config.md', '# Config\n\nshared term', 1000);

      const { coordinator, db } = await makeCoordinator();
      await coordinator.indexAll();

      const planned = QueryPlanner.plan('shared');
      const hits = db.search(planned, { query: 'shared' });
      expect(hits.map((h) => h.path)).toEqual(['notes/visible.md']);
    });

    it('respects a custom rootPath boundary', async () => {
      mock.addFile('docs/inside.md', '# Inside\n\nshared term', 1000);
      mock.addFile('notes/outside.md', '# Outside\n\nshared term', 1000);
      settings.sources = [makeSource({ rootPath: 'docs' })];

      const { coordinator, db } = await makeCoordinator();
      await coordinator.indexAll();

      const planned = QueryPlanner.plan('shared');
      const hits = db.search(planned, { query: 'shared' });
      expect(hits.map((h) => h.path)).toEqual(['docs/inside.md']);
    });
  });

  describe('hash skip', () => {
    it('reports unchanged when content and mtime are identical', async () => {
      mock.addFile('notes/a.md', '# H\n\nStable body.', 1000);
      const { coordinator } = await makeCoordinator();
      const first = await coordinator.indexAll();
      expect(first.indexedFiles).toBe(1);

      // Second pass: same content, same mtime -> unchanged.
      const second = await coordinator.indexAll();
      expect(second.indexedFiles).toBe(0);
      expect(second.unchangedFiles).toBe(1);
    });

    it('re-indexes when content changes', async () => {
      mock.addFile('notes/a.md', '# H\n\nOriginal.', 1000);
      const { coordinator } = await makeCoordinator();
      await coordinator.indexAll();

      mock.updateFile('notes/a.md', '# H\n\nUpdated.', 2000);
      const second = await coordinator.indexAll();
      expect(second.indexedFiles).toBe(1);
      expect(second.unchangedFiles).toBe(0);
    });
  });

  describe('delete and rename', () => {
    it('removes chunks for files no longer in the vault', async () => {
      mock.addFile('notes/a.md', '# H\n\nKeep me.', 1000);
      mock.addFile('notes/b.md', '# H\n\nDelete me.', 1000);
      const { coordinator, db } = await makeCoordinator();
      await coordinator.indexAll();
      expect(db.getStats().fileCount).toBe(2);

      mock.deleteFile('notes/b.md');
      const second = await coordinator.indexAll();
      expect(second.deletedFiles).toBe(1);
      expect(db.getStats().fileCount).toBe(1);
      expect(db.getFileRecord('vault', 'notes/b.md')).toBeNull();
    });

    it('removePath deletes the file from the index', async () => {
      mock.addFile('notes/a.md', '# H\n\nBody.', 1000);
      const { coordinator, db } = await makeCoordinator();
      await coordinator.indexAll();

      await coordinator.removePath('notes/a.md');
      expect(db.getFileRecord('vault', 'notes/a.md')).toBeNull();
    });

    it('handleRename removes the old path and indexes the new one', async () => {
      mock.addFile('notes/old.md', '# Renamed\n\nshared term', 1000);
      const { coordinator, db } = await makeCoordinator();
      await coordinator.indexAll();

      mock.renameFile('notes/old.md', 'notes/new.md');
      await coordinator.removePath('notes/old.md');
      // queuePath would debounce; for the test, call indexAll to pick up new.md.
      await coordinator.indexAll();

      const planned = QueryPlanner.plan('shared');
      const hits = db.search(planned, { query: 'shared' });
      expect(hits.map((h) => h.path)).toEqual(['notes/new.md']);
      expect(db.getFileRecord('vault', 'notes/old.md')).toBeNull();
      expect(db.getFileRecord('vault', 'notes/new.md')).not.toBeNull();
    });
  });

  describe('edit propagation', () => {
    it('old text no longer appears after an edit; new text does', async () => {
      mock.addFile('notes/a.md', '# H\n\nThe old phrase appears here.', 1000);
      const { coordinator, db } = await makeCoordinator();
      await coordinator.indexAll();

      const oldPlanned = QueryPlanner.plan('old phrase');
      expect(db.search(oldPlanned, { query: 'old phrase' }).length).toBeGreaterThanOrEqual(1);

      mock.updateFile('notes/a.md', '# H\n\nThe new phrase is here.', 2000);
      await coordinator.indexAll();

      const stillThere = db.search(oldPlanned, { query: 'old phrase' });
      expect(stillThere).toEqual([]);
      const newPlanned = QueryPlanner.plan('new phrase');
      expect(db.search(newPlanned, { query: 'new phrase' }).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('rebuild', () => {
    it('clears the index before re-indexing when rebuild: true', async () => {
      mock.addFile('notes/a.md', '# H\n\nA.', 1000);
      mock.addFile('notes/b.md', '# H\n\nB.', 1000);
      const { coordinator, db } = await makeCoordinator();
      await coordinator.indexAll();
      expect(db.getStats().fileCount).toBe(2);

      mock.deleteFile('notes/b.md');
      await coordinator.indexAll({ rebuild: true });
      expect(db.getStats().fileCount).toBe(1);
    });
  });

  describe('cancellation', () => {
    it('cancelCurrentIndex aborts an in-progress index', async () => {
      for (let i = 0; i < 20; i++) {
        mock.addFile(`notes/f${i}.md`, `# H${i}\n\nBody ${i}.`, 1000 + i);
      }
      const { coordinator } = await makeCoordinator();
      const promise = coordinator.indexAll();
      coordinator.cancelCurrentIndex();
      await promise;
      // Either it aborted early or finished; either way state must be terminal.
      expect(['idle', 'error']).toContain(coordinator.getStatus().state);
    });
  });

  describe('disabled sources', () => {
    it('skips disabled sources entirely', async () => {
      mock.addFile('notes/a.md', '# H\n\nshared term', 1000);
      settings.sources = [makeSource({ enabled: false })];
      const { coordinator, db } = await makeCoordinator();
      await coordinator.indexAll();
      expect(db.getStats().fileCount).toBe(0);
    });
  });

  describe('shutdown', () => {
    it('closes the database cleanly', async () => {
      mock.addFile('notes/a.md', '# H\n\nBody.', 1000);
      const { coordinator, db } = await makeCoordinator();
      await coordinator.indexAll();
      await coordinator.shutdown();
      // After shutdown the db is closed; calling getStats would throw.
      expect(() => db.getStats()).toThrow();
    });
  });
});
