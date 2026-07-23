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
const { HybridRetriever } = await import('../../src/retrieval/HybridRetriever');
const { SqliteVectorStore } = await import('../../src/retrieval/SqliteVectorStore');

function makeMockProvider(dimensions: number): any {
  return {
    modelId: 'test-model',
    dimensions,
    embed: vi.fn(async (texts: string[]) => {
      return texts.map((text) => {
        const v = new Float32Array(dimensions);
        for (let i = 0; i < dimensions; i++) {
          v[i] = (text.charCodeAt(i % Math.max(text.length, 1)) || 1) / 255;
        }
        return v;
      });
    }),
  };
}

describe('HybridRetriever', () => {
  let db: InstanceType<typeof RetrievalDatabase>;
  let coordinator: InstanceType<typeof IndexCoordinator>;
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

    mock.addFile('cats.md', '# Cats\n\nCats are small furry pets that love to sleep.', 1);
    mock.addFile('dogs.md', '# Dogs\n\nDogs are loyal companions that love to play fetch.', 2);
    mock.addFile('birds.md', '# Birds\n\nBirds can fly and sing beautiful songs.', 3);
    await coordinator.indexAll();
  });

  it('falls back to lexical-only when no vector store or provider', async () => {
    const retriever = new HybridRetriever(db, null, null);
    const hits = await retriever.search({ query: 'cats' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].path).toBe('cats.md');
    // Without vector store, mode should be lexical (strict or relaxed)
    expect(hits[0].retrievalMode).toMatch(/strict-and|relaxed-lexical/);
  });

  it('falls back to lexical when provider returns no vector', async () => {
    const provider = makeMockProvider(8);
    provider.embed.mockResolvedValueOnce([]);
    const vectorStore = new SqliteVectorStore(db);
    await vectorStore.initialize();
    const retriever = new HybridRetriever(db, vectorStore, provider);
    const hits = await retriever.search({ query: 'cats' });
    expect(hits[0].path).toBe('cats.md');
    expect(hits[0].retrievalMode).toMatch(/strict-and|relaxed-lexical/);
  });

  it('returns hybrid results when both lexical and vector candidates exist', async () => {
    const provider = makeMockProvider(8);
    const vectorStore = new SqliteVectorStore(db);
    await vectorStore.initialize();

    // Embed all chunks
    const chunks = (db as any).select('SELECT id, content_hash, normalized_text, heading_path_json FROM retrieval_chunks');
    const { chunkMarkdown } = await import('../../src/retrieval/MarkdownChunker');
    const texts = chunks.map((c: any) => c.normalized_text);
    const vectors = await provider.embed(texts);
    await vectorStore.upsert(chunks.map((c: any, i: number) => ({
      chunkId: c.id,
      chunkHash: c.content_hash,
      modelId: 'test-model',
      preprocessingVersion: '1',
      vector: vectors[i],
    })));

    const retriever = new HybridRetriever(db, vectorStore, provider);
    const hits = await retriever.search({ query: 'cats' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.retrievalMode === 'hybrid')).toBe(true);
    // The hybrid hit should have rrf in matchReasons
    const hybridHit = hits.find((h) => h.retrievalMode === 'hybrid');
    expect(hybridHit?.matchReasons).toContain('rrf');
  });

  it('applies semantic threshold to filter low-similarity vector hits', async () => {
    const provider = makeMockProvider(8);
    const vectorStore = new SqliteVectorStore(db);
    await vectorStore.initialize();

    const chunks = (db as any).select('SELECT id, content_hash, normalized_text FROM retrieval_chunks');
    const texts = chunks.map((c: any) => c.normalized_text);
    const vectors = await provider.embed(texts);
    await vectorStore.upsert(chunks.map((c: any, i: number) => ({
      chunkId: c.id,
      chunkHash: c.content_hash,
      modelId: 'test-model',
      preprocessingVersion: '1',
      vector: vectors[i],
    })));

    // Use a very high threshold so all vector hits are filtered out
    const retriever = new HybridRetriever(db, vectorStore, provider, { semanticThreshold: 0.99 });
    const hits = await retriever.search({ query: 'cats' });
    // Should still return lexical results since vector hits are filtered
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.retrievalMode !== 'hybrid')).toBe(true);
  });

  it('includes both lexical-rank and vector-rank in matchReasons for fused hits', async () => {
    const provider = makeMockProvider(8);
    const vectorStore = new SqliteVectorStore(db);
    await vectorStore.initialize();

    const chunks = (db as any).select('SELECT id, content_hash, normalized_text FROM retrieval_chunks');
    const texts = chunks.map((c: any) => c.normalized_text);
    const vectors = await provider.embed(texts);
    await vectorStore.upsert(chunks.map((c: any, i: number) => ({
      chunkId: c.id,
      chunkHash: c.content_hash,
      modelId: 'test-model',
      preprocessingVersion: '1',
      vector: vectors[i],
    })));

    const retriever = new HybridRetriever(db, vectorStore, provider);
    const hits = await retriever.search({ query: 'cats' });
    const hybridHits = hits.filter((h) => h.retrievalMode === 'hybrid');
    // At least one hit should have both lexical and vector ranks
    const hasBothRanks = hybridHits.some((h) =>
      h.matchReasons.some((r) => r.startsWith('lexical-rank:')) &&
      h.matchReasons.some((r) => r.startsWith('vector-rank:'))
    );
    expect(hasBothRanks).toBe(true);
  });
});
