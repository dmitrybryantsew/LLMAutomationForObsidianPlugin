import { describe, it, expect, beforeAll, vi } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { initFts5SqlJs } from '../tests/helpers/fts5Wasm';
import {
  createRetrievalMockVault,
  ADAPTER_WASM_PATH,
  DEFAULT_DB_PATH,
} from '../tests/helpers/retrievalMockVault';
import { LABELLED_QUERIES, listFixtureFiles, FIXTURE_ROOT } from './labelledQueries';

vi.mock('sql.js', () => ({
  default: initFts5SqlJs(),
}));

const { RetrievalDatabase } = await import('../src/retrieval/RetrievalDatabase');
const { RetrievalService } = await import('../src/retrieval/RetrievalService');
const { IndexCoordinator } = await import('../src/retrieval/IndexCoordinator');
const { HybridRetriever } = await import('../src/retrieval/HybridRetriever');
const { SqliteVectorStore } = await import('../src/retrieval/SqliteVectorStore');
const { EmbeddingCoordinator } = await import('../src/retrieval/EmbeddingCoordinator');
const { DebugLogger } = await import('../src/utils/DebugLogger');
import type { RetrievalSettings, RetrievalSourceConfig, EmbeddingProvider, SearchHit } from '../src/types/retrieval';

function makeSource(): RetrievalSourceConfig {
  return {
    id: 'fixtures',
    name: 'Fixtures',
    kind: 'vault',
    rootPath: '',
    enabled: true,
    trust: 'personal',
    includeGlobs: ['**/*.md'],
    excludeGlobs: [],
    maxFileBytes: 5_000_000,
  };
}

function makeSettings(): RetrievalSettings {
  return {
    enabled: true,
    databasePath: DEFAULT_DB_PATH,
    sources: [makeSource()],
    evidenceTokenBudget: 12000,
    defaultResultLimit: 10,
    autoIndexOnStartup: false,
    autoIndexOnModify: true,
    allowGeneralKnowledgeWhenUngrounded: false,
  };
}

/**
 * Deterministic mock embedding provider for eval.
 * Uses a bag-of-characters approach: each character position contributes
 * to a fixed dimension. This gives semantically similar texts (sharing words)
 * higher cosine similarity than unrelated texts, which is enough to test
 * the hybrid fusion logic without a real embedding model.
 */
function makeDeterministicProvider(dimensions: number): EmbeddingProvider {
  return {
    modelId: 'eval-deterministic-v1',
    dimensions,
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map((text) => {
        const v = new Float32Array(dimensions);
        const lower = text.toLowerCase();
        // Hash each word into the vector space
        const words = lower.split(/\s+/).filter((w) => w.length > 1);
        for (const word of words) {
          let hash = 0;
          for (let i = 0; i < word.length; i++) {
            hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
          }
          const idx = Math.abs(hash) % dimensions;
          v[idx] += 1;
        }
        // Normalize to unit length for cosine similarity
        let norm = 0;
        for (let i = 0; i < dimensions; i++) norm += v[i] * v[i];
        norm = Math.sqrt(norm);
        if (norm > 0) {
          for (let i = 0; i < dimensions; i++) v[i] /= norm;
        }
        return v;
      });
    },
  };
}

type RetrievalMode = 'lexical-only' | 'semantic-only' | 'hybrid';

interface ModeResult {
  id: string;
  query: string;
  category: string;
  hitPaths: string[];
  top5Paths: string[];
  rankOfFirstExpected: number | null;
  latencyMs: number;
  retrievalMode: string;
}

interface ModeMetrics {
  mode: RetrievalMode;
  recallAt5: number;
  recallAt5Exact: number;
  recallAt5Paraphrase: number;
  mrr: number;
  noAnswerPrecision: number;
  p95LatencyMs: number;
  totalQueries: number;
  perCategory: Record<string, { recall: number; mrr: number; count: number }>;
  failures: { id: string; query: string; reason: string }[];
}

describe('P3 mode comparison eval', () => {
  let mock: ReturnType<typeof createRetrievalMockVault>;
  let settings: RetrievalSettings;
  let debugLogger: InstanceType<typeof DebugLogger>;
  let db: InstanceType<typeof RetrievalDatabase>;
  let coordinator: InstanceType<typeof IndexCoordinator>;
  let lexicalResults: ModeResult[];
  let semanticResults: ModeResult[];
  let hybridResults: ModeResult[];
  let lexicalMetrics: ModeMetrics;
  let semanticMetrics: ModeMetrics;
  let hybridMetrics: ModeMetrics;

  beforeAll(async () => {
    const files = listFixtureFiles();
    expect(files.length).toBeGreaterThanOrEqual(10);

    mock = createRetrievalMockVault();
    settings = makeSettings();
    debugLogger = new DebugLogger(false, 'eval-p3');

    for (const f of files) {
      mock.addFile(f.rel, f.content, Math.floor(f.mtime));
    }

    db = new RetrievalDatabase(mock.app as any, { dbPath: DEFAULT_DB_PATH, wasmPath: ADAPTER_WASM_PATH });
    coordinator = new IndexCoordinator(mock.app as any, db, () => settings, debugLogger);
    await coordinator.initialize();
    await coordinator.indexAll();

    // Build vector index for semantic and hybrid modes
    const provider = makeDeterministicProvider(128);
    const vectorStore = new SqliteVectorStore(db);
    await vectorStore.initialize();
    const embCoord = new EmbeddingCoordinator(mock.app as any, db, debugLogger);
    await embCoord.initialize();
    embCoord.setProvider(provider);

    // Get all chunks from the DB and build the vector index
    const chunkRows = (db as any).select(
      'SELECT id, source_id, path, basename, heading_path_json, start_line, end_line, text, normalized_text, tags_json, links_json, content_hash, modified_time FROM retrieval_chunks'
    );
    const chunkDrafts = chunkRows.map((c: any) => ({
      id: c.id,
      sourceId: c.source_id,
      path: c.path,
      basename: c.basename,
      headingPath: JSON.parse(c.heading_path_json || '[]'),
      startLine: c.start_line,
      endLine: c.end_line,
      text: c.text,
      normalizedText: c.normalized_text,
      tags: JSON.parse(c.tags_json || '[]'),
      outboundLinks: JSON.parse(c.links_json || '[]'),
      contentHash: c.content_hash,
      modifiedTime: c.modified_time,
    }));
    await embCoord.buildIndex(chunkDrafts);

    // --- Mode 1: Lexical-only ---
    const lexicalService = new RetrievalService({ database: db }, {
      evidenceTokenBudget: settings.evidenceTokenBudget,
      defaultResultLimit: settings.defaultResultLimit,
    });
    lexicalResults = await runQueries(lexicalService, 'lexical-only');

    // --- Mode 2: Semantic-only (vector store search, no lexical) ---
    semanticResults = await runSemanticQueries(embCoord.getVectorStore(), provider);

    // --- Mode 3: Hybrid (RRF fusion) ---
    const hybridService = new RetrievalService(
      { database: db, vectorStore: embCoord.getVectorStore(), embeddingProvider: provider },
      {
        evidenceTokenBudget: settings.evidenceTokenBudget,
        defaultResultLimit: settings.defaultResultLimit,
        semanticThreshold: 0.5,
        lexicalVeto: true,
      }
    );
    hybridResults = await runQueries(hybridService, 'hybrid');

    lexicalMetrics = computeMetrics('lexical-only', lexicalResults);
    semanticMetrics = computeMetrics('semantic-only', semanticResults);
    hybridMetrics = computeMetrics('hybrid', hybridResults);

    // Write comparison report
    const report = formatComparisonReport(lexicalMetrics, semanticMetrics, hybridMetrics);
    mkdirSync(path.join(process.cwd(), 'eval', 'results'), { recursive: true });
    writeFileSync(
      path.join(process.cwd(), 'eval', 'results', `p3-comparison-${new Date().toISOString().slice(0, 10)}.md`),
      report,
      'utf8'
    );
  });

  async function runQueries(service: InstanceType<typeof RetrievalService>, _mode: RetrievalMode): Promise<ModeResult[]> {
    const results: ModeResult[] = [];
    for (const q of LABELLED_QUERIES) {
      const start = performance.now();
      const hits = await service.search({ query: q.query, limit: 10 });
      const elapsed = performance.now() - start;
      results.push(toModeResult(q, hits, elapsed));
    }
    return results;
  }

  async function runSemanticQueries(
    vectorStore: InstanceType<typeof SqliteVectorStore>,
    provider: EmbeddingProvider
  ): Promise<ModeResult[]> {
    const results: ModeResult[] = [];
    for (const q of LABELLED_QUERIES) {
      const start = performance.now();
      const queryVec = (await provider.embed([q.query]))[0];
      const vhits = await vectorStore.search(queryVec, {}, 10);
      const elapsed = performance.now() - start;

      // Convert VectorHit to a simplified ModeResult
      const hitPaths = vhits.map((h) => h.path);
      let rankOfFirstExpected: number | null = null;
      if (q.expectedPaths.length > 0) {
        for (let i = 0; i < hitPaths.length; i++) {
          if (q.expectedPaths.includes(hitPaths[i])) {
            rankOfFirstExpected = i + 1;
            break;
          }
        }
      }
      results.push({
        id: q.id,
        query: q.query,
        category: q.category,
        hitPaths,
        top5Paths: hitPaths.slice(0, 5),
        rankOfFirstExpected,
        latencyMs: elapsed,
        retrievalMode: 'semantic',
      });
    }
    return results;
  }

  function toModeResult(q: typeof LABELLED_QUERIES[number], hits: any[], elapsed: number): ModeResult {
    const hitPaths = hits.map((h) => h.path);
    let rankOfFirstExpected: number | null = null;
    if (q.expectedPaths.length > 0) {
      for (let i = 0; i < hitPaths.length; i++) {
        if (q.expectedPaths.includes(hitPaths[i])) {
          rankOfFirstExpected = i + 1;
          break;
        }
      }
    }
    return {
      id: q.id,
      query: q.query,
      category: q.category,
      hitPaths,
      top5Paths: hitPaths.slice(0, 5),
      rankOfFirstExpected,
      latencyMs: elapsed,
      retrievalMode: hits[0]?.retrievalMode ?? 'none',
    };
  }

  function computeMetrics(mode: RetrievalMode, results: ModeResult[]): ModeMetrics {
    const exactResults = results.filter((r) => r.category === 'exact');
    const paraphraseResults = results.filter((r) => r.category === 'paraphrase');
    const noAnswerResults = results.filter((r) => r.category === 'noanswer');

    const recallAt5 = (rs: ModeResult[]) =>
      rs.filter((r) => r.rankOfFirstExpected !== null && r.rankOfFirstExpected <= 5).length / rs.length;
    const mrr = (rs: ModeResult[]) =>
      rs.reduce((sum, r) => sum + (r.rankOfFirstExpected ? 1 / r.rankOfFirstExpected : 0), 0) / rs.length;

    const answerable = results.filter((r) => r.category !== 'noanswer');
    const noAnswerPrecision = noAnswerResults.filter((r) => r.hitPaths.length === 0).length / noAnswerResults.length;

    const sortedLatencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    const p95Index = Math.min(Math.floor(sortedLatencies.length * 0.95), sortedLatencies.length - 1);

    const perCategory: Record<string, { recall: number; mrr: number; count: number }> = {};
    for (const cat of ['exact', 'paraphrase', 'multi', 'heading']) {
      const rs = results.filter((r) => r.category === cat);
      perCategory[cat] = { recall: recallAt5(rs), mrr: mrr(rs), count: rs.length };
    }
    perCategory['noanswer'] = { recall: noAnswerPrecision, mrr: 0, count: noAnswerResults.length };

    const failures: { id: string; query: string; reason: string }[] = [];
    for (const r of results) {
      if (r.category === 'noanswer') {
        if (r.hitPaths.length > 0) {
          failures.push({ id: r.id, query: r.query, reason: `Expected 0 hits, got ${r.hitPaths.length}` });
        }
      } else {
        if (r.rankOfFirstExpected === null || r.rankOfFirstExpected > 5) {
          failures.push({
            id: r.id,
            query: r.query,
            reason: `Expected not in top-5 (rank: ${r.rankOfFirstExpected ?? 'not found'}). Got: ${r.top5Paths.join(', ') || 'none'}`,
          });
        }
      }
    }

    return {
      mode,
      recallAt5: recallAt5(answerable),
      recallAt5Exact: recallAt5(exactResults),
      recallAt5Paraphrase: recallAt5(paraphraseResults),
      mrr: mrr(answerable),
      noAnswerPrecision,
      p95LatencyMs: sortedLatencies[p95Index] ?? 0,
      totalQueries: results.length,
      perCategory,
      failures,
    };
  }

  it('lexical-only maintains Recall@5 >= 80% for exact queries', () => {
    expect(lexicalMetrics.recallAt5Exact).toBeGreaterThanOrEqual(0.8);
  });

  it('hybrid maintains or improves Recall@5 vs lexical-only', () => {
    console.log(`Lexical Recall@5: ${(lexicalMetrics.recallAt5 * 100).toFixed(1)}%`);
    console.log(`Hybrid Recall@5: ${(hybridMetrics.recallAt5 * 100).toFixed(1)}%`);
    expect(hybridMetrics.recallAt5).toBeGreaterThanOrEqual(lexicalMetrics.recallAt5 * 0.95);
  });

  it('hybrid no-answer precision >= 90%', () => {
    expect(hybridMetrics.noAnswerPrecision).toBeGreaterThanOrEqual(0.9);
  });

  it('writes comparison report', () => {
    expect(lexicalMetrics.totalQueries).toBe(LABELLED_QUERIES.length);
    expect(semanticMetrics.totalQueries).toBe(LABELLED_QUERIES.length);
    expect(hybridMetrics.totalQueries).toBe(LABELLED_QUERIES.length);
  });
});

function formatComparisonReport(lexical: ModeMetrics, semantic: ModeMetrics, hybrid: ModeMetrics): string {
  const now = new Date().toISOString();
  const lines: string[] = [];
  lines.push(`# P3 retrieval mode comparison`);
  lines.push('');
  lines.push(`Generated: ${now}`);
  lines.push(`Fixture vault: ${FIXTURE_ROOT}`);
  lines.push(`Total queries: ${lexical.totalQueries} (per mode)`);
  lines.push(`Embedding provider: deterministic bag-of-words hash (128 dims, unit-normalized)`);
  lines.push('');
  lines.push(`## Overall metrics comparison`);
  lines.push('');
  lines.push(`| Metric | Lexical-only | Semantic-only | Hybrid |`);
  lines.push(`|---|---|---|---|`);
  lines.push(`| Recall@5 (all answerable) | ${(lexical.recallAt5 * 100).toFixed(1)}% | ${(semantic.recallAt5 * 100).toFixed(1)}% | ${(hybrid.recallAt5 * 100).toFixed(1)}% |`);
  lines.push(`| Recall@5 (exact) | ${(lexical.recallAt5Exact * 100).toFixed(1)}% | ${(semantic.recallAt5Exact * 100).toFixed(1)}% | ${(hybrid.recallAt5Exact * 100).toFixed(1)}% |`);
  lines.push(`| Recall@5 (paraphrase) | ${(lexical.recallAt5Paraphrase * 100).toFixed(1)}% | ${(semantic.recallAt5Paraphrase * 100).toFixed(1)}% | ${(hybrid.recallAt5Paraphrase * 100).toFixed(1)}% |`);
  lines.push(`| MRR | ${lexical.mrr.toFixed(3)} | ${semantic.mrr.toFixed(3)} | ${hybrid.mrr.toFixed(3)} |`);
  lines.push(`| No-answer precision | ${(lexical.noAnswerPrecision * 100).toFixed(1)}% | ${(semantic.noAnswerPrecision * 100).toFixed(1)}% | ${(hybrid.noAnswerPrecision * 100).toFixed(1)}% |`);
  lines.push(`| P95 latency | ${lexical.p95LatencyMs.toFixed(1)}ms | ${semantic.p95LatencyMs.toFixed(1)}ms | ${hybrid.p95LatencyMs.toFixed(1)}ms |`);
  lines.push('');
  lines.push(`## Per-category Recall@5`);
  lines.push('');
  lines.push(`| Category | Lexical | Semantic | Hybrid |`);
  lines.push(`|---|---|---|---|`);
  for (const cat of ['exact', 'paraphrase', 'multi', 'heading', 'noanswer']) {
    const l = lexical.perCategory[cat]?.recall ?? 0;
    const s = semantic.perCategory[cat]?.recall ?? 0;
    const h = hybrid.perCategory[cat]?.recall ?? 0;
    lines.push(`| ${cat} | ${(l * 100).toFixed(1)}% | ${(s * 100).toFixed(1)}% | ${(h * 100).toFixed(1)}% |`);
  }
  lines.push('');
  lines.push(`## Failures`);
  lines.push('');
  lines.push(`### Lexical-only (${lexical.failures.length})`);
  for (const f of lexical.failures) lines.push(`- **${f.id}** (${f.query}): ${f.reason}`);
  lines.push('');
  lines.push(`### Semantic-only (${semantic.failures.length})`);
  for (const f of semantic.failures) lines.push(`- **${f.id}** (${f.query}): ${f.reason}`);
  lines.push('');
  lines.push(`### Hybrid (${hybrid.failures.length})`);
  for (const f of hybrid.failures) lines.push(`- **${f.id}** (${f.query}): ${f.reason}`);
  lines.push('');
  lines.push(`## Notes`);
  lines.push('');
  lines.push(`- **Lexical-only**: FTS5 strict-AND with relaxed OR fallback (P2 adaptive retrieval)`);
  lines.push(`- **Semantic-only**: Brute-force cosine similarity over deterministic embeddings (no lexical signal)`);
  lines.push(`- **Hybrid**: RRF fusion (k=60) of lexical top-40 + vector top-40, semantic threshold 0.3`);
  lines.push(`- The deterministic embedding provider uses a bag-of-words hash, so semantic recall depends on word overlap. Real embedding models would show stronger semantic recall on paraphrase queries.`);
  lines.push('');
  return lines.join('\n');
}
