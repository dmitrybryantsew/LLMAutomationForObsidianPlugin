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
const { SqliteVectorStore } = await import('../../src/retrieval/SqliteVectorStore');
const { VectorUpsertRow } = await import('../../src/types/retrieval');

function makeVector(fill: number, dim: number): Float32Array {
  const v = new Float32Array(dim);
  v.fill(fill);
  v[0] = 1;
  return v;
}

describe('SqliteVectorStore', () => {
  let db: InstanceType<typeof RetrievalDatabase>;
  let coordinator: InstanceType<typeof IndexCoordinator>;
  let store: InstanceType<typeof SqliteVectorStore>;
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
      embedding: { provider: 'none', ollamaEndpoint: 'http://localhost:11434', ollamaModel: 'qwen3-embedding:0.6b', chutesApiKey: '', chutesBaseUrl: 'https://chutes-qwen-qwen3-embedding-8b-tee.chutes.ai', chutesModel: 'Qwen/Qwen3-Embedding-8B-TEE', semanticThreshold: 0.3, lexicalVeto: true },
    };

    db = new RetrievalDatabase(mock.app as any, { dbPath: DEFAULT_DB_PATH, wasmPath: ADAPTER_WASM_PATH });
    coordinator = new IndexCoordinator(mock.app as any, db, () => settings as any, { logError: vi.fn(), log: vi.fn(), logInfo: vi.fn(), setEnabled: vi.fn() } as any);
    await coordinator.initialize();

    mock.addFile('note1.md', '# Title\n\nSome content about cats and dogs.', 1);
    await coordinator.indexAll();

    store = new SqliteVectorStore(db);
    await store.initialize();
  });

  it('starts empty', async () => {
    const status = await store.getStatus();
    expect(status.state).toBe('empty');
    expect(status.vectorCount).toBe(0);
  });

  it('upserts and retrieves vectors', async () => {
    const chunks = (db as any).select('SELECT id FROM retrieval_chunks LIMIT 1');
    expect(chunks.length).toBeGreaterThan(0);
    const chunkId = chunks[0].id;

    const rows: any[] = [
      { chunkId, chunkHash: 'h1', modelId: 'test-model', preprocessingVersion: '1', vector: makeVector(0.5, 8) },
    ];
    await store.upsert(rows);

    const status = await store.getStatus();
    expect(status.state).toBe('ready');
    expect(status.vectorCount).toBe(1);
    expect(status.modelId).toBe('test-model');
    expect(status.dimensions).toBe(8);
  });

  it('searches by cosine similarity', async () => {
    const chunks = (db as any).select('SELECT id FROM retrieval_chunks LIMIT 1');
    const chunkId = chunks[0].id;

    await store.upsert([
      { chunkId, chunkHash: 'h1', modelId: 'm', preprocessingVersion: '1', vector: makeVector(1.0, 4) },
    ]);

    const query = makeVector(1.0, 4);
    const hits = await store.search(query, {}, 10);
    expect(hits.length).toBe(1);
    expect(hits[0].chunkId).toBe(chunkId);
    expect(hits[0].similarity).toBeCloseTo(1.0, 5);
  });

  it('removes vectors by chunk ID', async () => {
    const chunks = (db as any).select('SELECT id FROM retrieval_chunks LIMIT 1');
    const chunkId = chunks[0].id;

    await store.upsert([
      { chunkId, chunkHash: 'h1', modelId: 'm', preprocessingVersion: '1', vector: makeVector(1.0, 4) },
    ]);
    expect((await store.getStatus()).vectorCount).toBe(1);

    await store.removeChunkIds([chunkId]);
    expect((await store.getStatus()).vectorCount).toBe(0);
  });

  it('removes vectors by model ID', async () => {
    const chunks = (db as any).select('SELECT id FROM retrieval_chunks LIMIT 1');
    const chunkId = chunks[0].id;

    await store.upsert([
      { chunkId, chunkHash: 'h1', modelId: 'm1', preprocessingVersion: '1', vector: makeVector(1.0, 4) },
    ]);
    await store.upsert([
      { chunkId, chunkHash: 'h2', modelId: 'm2', preprocessingVersion: '1', vector: makeVector(1.0, 4) },
    ]);

    const removed = await store.removeByModel('m1');
    expect(removed).toBe(1);
  });

  it('returns 0 similarity for orthogonal vectors', async () => {
    const chunks = (db as any).select('SELECT id FROM retrieval_chunks LIMIT 1');
    const chunkId = chunks[0].id;

    const orthogonal = new Float32Array([1, 0, 0, 0]);
    await store.upsert([
      { chunkId, chunkHash: 'h1', modelId: 'm', preprocessingVersion: '1', vector: new Float32Array([0, 1, 0, 0]) },
    ]);

    const hits = await store.search(orthogonal, {}, 10);
    expect(hits.length).toBe(0);
  });

  it('applies source ID filter', async () => {
    const chunks = (db as any).select('SELECT id FROM retrieval_chunks LIMIT 1');
    const chunkId = chunks[0].id;

    await store.upsert([
      { chunkId, chunkHash: 'h1', modelId: 'm', preprocessingVersion: '1', vector: makeVector(1.0, 4) },
    ]);

    const query = makeVector(1.0, 4);
    const hits = await store.search(query, { sourceIds: ['nonexistent'] }, 10);
    expect(hits.length).toBe(0);
  });
});
