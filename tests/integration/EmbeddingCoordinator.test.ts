import { describe, expect, it, beforeEach, vi } from 'vitest';
import { initFts5SqlJs } from '../helpers/fts5Wasm';
import {
  createRetrievalMockVault,
  ADAPTER_WASM_PATH,
  DEFAULT_DB_PATH,
} from '../helpers/retrievalMockVault';

vi.mock('sql.js', () => ({
  default: initFts5SqlJs(),
}));

const { RetrievalDatabase } = await import('../../src/retrieval/RetrievalDatabase');
const { IndexCoordinator } = await import('../../src/retrieval/IndexCoordinator');
const { EmbeddingCoordinator } = await import('../../src/retrieval/EmbeddingCoordinator');

function makeMockProvider(modelId: string, dimensions: number): any {
  return {
    modelId,
    dimensions,
    embed: vi.fn(async (texts: string[], signal?: AbortSignal) => {
      return texts.map((text) => {
        const v = new Float32Array(dimensions);
        for (let i = 0; i < dimensions; i++) {
          v[i] = text.charCodeAt(i % text.length) / 255;
        }
        return v;
      });
    }),
  };
}

describe('EmbeddingCoordinator', () => {
  let db: InstanceType<typeof RetrievalDatabase>;
  let coordinator: InstanceType<typeof IndexCoordinator>;
  let embCoord: InstanceType<typeof EmbeddingCoordinator>;
  let mock: ReturnType<typeof createRetrievalMockVault>;

  beforeEach(async () => {
    mock = createRetrievalMockVault();
    const settings = {
      enabled: true,
      databasePath: DEFAULT_DB_PATH,
      sources: [{
        id: 's1', name: 'Test', kind: 'vault' as const,
        rootPath: '', enabled: true, trust: 'personal' as const,
        includeGlobs: ['**/*.md'], excludeGlobs: [],
        maxFileBytes: 1_500_000,
      }],
      evidenceTokenBudget: 12000,
      defaultResultLimit: 10,
      autoIndexOnStartup: false,
      autoIndexOnModify: true,
      allowGeneralKnowledgeWhenUngrounded: false,
    };

    db = new RetrievalDatabase(mock.app as any, { dbPath: DEFAULT_DB_PATH, wasmPath: ADAPTER_WASM_PATH });
    coordinator = new IndexCoordinator(mock.app as any, db, () => settings as any, { logError: vi.fn(), log: vi.fn(), logInfo: vi.fn(), setEnabled: vi.fn() } as any);
    await coordinator.initialize();

    mock.addFile('note1.md', '# Title\n\nSome content about cats.', 1);
    mock.addFile('note2.md', '# Other\n\nMore content about dogs.', 2);
    await coordinator.indexAll();

    embCoord = new EmbeddingCoordinator(mock.app as any, db, { logError: vi.fn(), log: vi.fn(), logInfo: vi.fn(), setEnabled: vi.fn() } as any);
    await embCoord.initialize();
  });

  it('starts not ready without a provider', () => {
    expect(embCoord.isReady()).toBe(false);
  });

  it('is ready after setting a provider', () => {
    embCoord.setProvider(makeMockProvider('test-model', 16));
    expect(embCoord.isReady()).toBe(true);
  });

  it('builds index for all chunks', async () => {
    const provider = makeMockProvider('test-model', 16);
    embCoord.setProvider(provider);

    const chunks = (db as any).select('SELECT id, content_hash FROM retrieval_chunks');
    const result = await embCoord.buildIndex(chunks.map((c: any) => ({
      id: c.id, contentHash: c.content_hash, normalizedText: 'test', headingPath: [],
    })));

    expect(result.embedded).toBe(chunks.length);
    expect(result.skipped).toBe(0);
    expect(result.cancelled).toBe(false);
    expect(provider.embed).toHaveBeenCalled();
  });

  it('skips chunks with unchanged hash on rebuild', async () => {
    const provider = makeMockProvider('test-model', 16);
    embCoord.setProvider(provider);

    const chunks = (db as any).select('SELECT id, content_hash FROM retrieval_chunks');
    const chunkDrafts = chunks.map((c: any) => ({
      id: c.id, contentHash: c.content_hash, normalizedText: 'test', headingPath: [],
    }));

    await embCoord.buildIndex(chunkDrafts);
    provider.embed.mockClear();

    const result = await embCoord.buildIndex(chunkDrafts);
    expect(result.embedded).toBe(0);
    expect(result.skipped).toBe(chunks.length);
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it('returns building status during construction', async () => {
    const provider = makeMockProvider('test-model', 16);
    embCoord.setProvider(provider);

    const chunks = (db as any).select('SELECT id, content_hash FROM retrieval_chunks');
    const status = await embCoord.getStatus();
    expect(status.state).toBe('empty');

    const chunkDrafts = chunks.map((c: any) => ({
      id: c.id, contentHash: c.content_hash, normalizedText: 'test', headingPath: [],
    }));

    await embCoord.buildIndex(chunkDrafts);
    const finalStatus = await embCoord.getStatus();
    expect(finalStatus.state).toBe('ready');
    expect(finalStatus.vectorCount).toBe(chunks.length);
  });

  it('cancels a build via external signal', async () => {
    const provider = makeMockProvider('test-model', 16);
    embCoord.setProvider(provider);

    const chunks = (db as any).select('SELECT id, content_hash FROM retrieval_chunks');
    const chunkDrafts = chunks.map((c: any) => ({
      id: c.id, contentHash: c.content_hash, normalizedText: 'test', headingPath: [],
    }));

    const controller = new AbortController();
    controller.abort();
    const result = await embCoord.buildIndex(chunkDrafts, controller.signal);
    expect(result.cancelled).toBe(true);
  });

  it('invalidates vectors by model', async () => {
    const provider = makeMockProvider('test-model', 16);
    embCoord.setProvider(provider);

    const chunks = (db as any).select('SELECT id, content_hash FROM retrieval_chunks');
    const chunkDrafts = chunks.map((c: any) => ({
      id: c.id, contentHash: c.content_hash, normalizedText: 'test', headingPath: [],
    }));

    await embCoord.buildIndex(chunkDrafts);
    const removed = await embCoord.invalidateModel('test-model');
    expect(removed).toBe(chunks.length);

    const status = await embCoord.getStatus();
    expect(status.state).toBe('empty');
  });
});
