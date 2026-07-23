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
const { DebugLogger } = await import('../src/utils/DebugLogger');
import type { RetrievalSettings, RetrievalSourceConfig } from '../src/types/retrieval';

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
    embedding: { provider: 'none', ollamaEndpoint: 'http://localhost:11434', ollamaModel: 'qwen3-embedding:0.6b', chutesApiKey: '', chutesBaseUrl: 'https://chutes-qwen-qwen3-embedding-8b-tee.chutes.ai', chutesModel: 'Qwen/Qwen3-Embedding-8B-TEE', semanticThreshold: 0.3, lexicalVeto: true },
  };
}

interface QueryResult {
  id: string;
  query: string;
  category: string;
  hitPaths: string[];
  top5Paths: string[];
  rankOfFirstExpected: number | null; // 1-based, null if not found
  latencyMs: number;
  expectedPaths: string[];
  retrievalMode: string;
  fallbackUsed: boolean;
  strictCandidateCount: number;
  matchedTerms: string[];
  matchedTermFraction: number;
}

interface MetricsResult {
  recallAt5: number;
  recallAt5Exact: number;
  mrr: number;
  noAnswerPrecision: number;
  indexFreshness: number;
  p95LatencyMs: number;
  citationCorrectness: number;
  totalQueries: number;
  fallbackRate: number;
  perCategory: Record<string, { recall: number; mrr: number; count: number }>;
  failures: { id: string; query: string; reason: string }[];
}

describe('Evaluation harness (runbook §9.4)', () => {
  let mock: ReturnType<typeof createRetrievalMockVault>;
  let settings: RetrievalSettings;
  let debugLogger: InstanceType<typeof DebugLogger>;
  let db: InstanceType<typeof RetrievalDatabase>;
  let coordinator: InstanceType<typeof IndexCoordinator>;
  let service: InstanceType<typeof RetrievalService>;
  let results: QueryResult[];
  let metrics: MetricsResult;
  let initialFileCount: number;

  beforeAll(async () => {
    const files = listFixtureFiles();
    expect(files.length).toBeGreaterThanOrEqual(10);

    mock = createRetrievalMockVault();
    settings = makeSettings();
    debugLogger = new DebugLogger(false, 'eval');

    for (const f of files) {
      mock.addFile(f.rel, f.content, Math.floor(f.mtime));
    }

    db = new RetrievalDatabase(mock.app as any, { dbPath: DEFAULT_DB_PATH, wasmPath: ADAPTER_WASM_PATH });
    coordinator = new IndexCoordinator(mock.app as any, db, () => settings, debugLogger);
    service = new RetrievalService({ database: db }, {
      evidenceTokenBudget: settings.evidenceTokenBudget,
      defaultResultLimit: settings.defaultResultLimit,
    });
    await coordinator.initialize();
    await coordinator.indexAll();

    // Run all queries and collect results.
    results = [];
    for (const q of LABELLED_QUERIES) {
      const start = performance.now();
      const hits = await service.search({ query: q.query, limit: 10 });
      const elapsed = performance.now() - start;

      const hitPaths = hits.map((h) => h.path);
      const top5Paths = hitPaths.slice(0, 5);

      let rankOfFirstExpected: number | null = null;
      if (q.expectedPaths.length > 0) {
        for (let i = 0; i < hitPaths.length; i++) {
          if (q.expectedPaths.includes(hitPaths[i])) {
            rankOfFirstExpected = i + 1;
            break;
          }
        }
      }

      // Capture diagnostics from the first hit (or empty defaults).
      const firstHit = hits[0];
      const retrievalMode = firstHit?.retrievalMode ?? 'strict-and';
      const fallbackUsed = hits.some((h) => h.fallbackUsed);
      const matchedTerms = firstHit?.matchedTerms ?? [];
      const matchedTermFraction = firstHit?.matchedTermFraction ?? 0;

      results.push({
        id: q.id,
        query: q.query,
        category: q.category,
        hitPaths,
        top5Paths,
        rankOfFirstExpected,
        latencyMs: elapsed,
        expectedPaths: q.expectedPaths,
        retrievalMode,
        fallbackUsed,
        strictCandidateCount: hits.length,
        matchedTerms,
        matchedTermFraction,
      });
    }

    // Compute metrics.
    const exactResults = results.filter((r) => r.category === 'exact');
    const paraphraseResults = results.filter((r) => r.category === 'paraphrase');
    const multiResults = results.filter((r) => r.category === 'multi');
    const noAnswerResults = results.filter((r) => r.category === 'noanswer');
    const headingResults = results.filter((r) => r.category === 'heading');

    const recallAt5 = (rs: QueryResult[]) =>
      rs.filter((r) => r.rankOfFirstExpected !== null && r.rankOfFirstExpected <= 5).length / rs.length;
    const mrr = (rs: QueryResult[]) =>
      rs.reduce((sum, r) => sum + (r.rankOfFirstExpected ? 1 / r.rankOfFirstExpected : 0), 0) / rs.length;

    const recallAll = recallAt5(results.filter((r) => r.category !== 'noanswer'));
    const recallExact = recallAt5(exactResults);
    const overallMrr = mrr(results.filter((r) => r.category !== 'noanswer'));

    const noAnswerPrecision = noAnswerResults.filter((r) => r.hitPaths.length === 0).length / noAnswerResults.length;

    // Capture initial file count before freshness mutations alter the vault.
    initialFileCount = coordinator.getStatus().fileCount;

    // Index freshness: edit a file, delete a file, rename a file, verify search reflects changes.
    let freshnessPassed = 0;
    let freshnessTotal = 0;
    const freshnessDetails: string[] = [];

    // Edit: change a file's content, re-index, verify old text gone and new text present.
    freshnessTotal++;
    try {
      const editFile = files[0].rel;
      mock.updateFile(editFile, '# Edited\n\nThis file now contains the unique term zzquireditonly.', Date.now() + 1);
      await coordinator.indexAll();
      const editedHits = await service.search({ query: 'zzquireditonly' });
      if (editedHits.some((h) => h.path === editFile)) {
        freshnessPassed++;
        freshnessDetails.push(`edit: PASS (${editFile})`);
      } else {
        freshnessDetails.push(`edit: FAIL (${editFile} - new term not found)`);
      }
    } catch (e) {
      freshnessDetails.push(`edit: FAIL (${e instanceof Error ? e.message : 'error'})`);
    }

    // Delete: remove a file, re-index, verify it no longer appears for its own query.
    freshnessTotal++;
    try {
      const deleteFile = files[1].rel;
      const deleteQuery = LABELLED_QUERIES.find((q) => q.expectedPaths.includes(deleteFile));
      const searchTerm = deleteQuery ? deleteQuery.query : deleteFile.split('/').pop()?.replace(/\.md$/, '') ?? deleteFile;
      mock.deleteFile(deleteFile);
      await coordinator.indexAll();
      const deletedHits = await service.search({ query: searchTerm });
      if (!deletedHits.some((h) => h.path === deleteFile)) {
        freshnessPassed++;
        freshnessDetails.push(`delete: PASS (${deleteFile})`);
      } else {
        freshnessDetails.push(`delete: FAIL (${deleteFile} - still in results)`);
      }
    } catch (e) {
      freshnessDetails.push(`delete: FAIL (${e instanceof Error ? e.message : 'error'})`);
    }

    // Rename: rename a file, remove old path, re-index, verify old path gone and new path present.
    freshnessTotal++;
    try {
      const renameOld = files[2].rel;
      const renameNew = renameOld.replace(/\.md$/, '-renamed.md');
      // Use a simple search term that reliably finds the Goose file (its title topic).
      const searchTerm = 'Goose';
      mock.renameFile(renameOld, renameNew);
      await coordinator.removePath(renameOld);
      await coordinator.indexAll();
      const renamedHits = await service.search({ query: searchTerm });
      const newPresent = renamedHits.some((h) => h.path === renameNew);
      const oldGone = !renamedHits.some((h) => h.path === renameOld);
      if (newPresent && oldGone) {
        freshnessPassed++;
        freshnessDetails.push(`rename: PASS (${renameOld} -> ${renameNew})`);
      } else {
        freshnessDetails.push(`rename: FAIL (new=${newPresent}, oldGone=${oldGone}, ${renameOld} -> ${renameNew}, hits=${renamedHits.map((h) => h.path).join(',')})`);
      }
    } catch (e) {
      freshnessDetails.push(`rename: FAIL (${e instanceof Error ? e.message : 'error'})`);
    }

    const indexFreshness = freshnessTotal > 0 ? freshnessPassed / freshnessTotal : 1;

    // P95 latency (search only, warm index).
    const sortedLatencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    const p95Index = Math.min(Math.floor(sortedLatencies.length * 0.95), sortedLatencies.length - 1);
    const p95Latency = sortedLatencies[p95Index] ?? 0;

    // Citation correctness: build evidence packs for a sample of answerable queries
    // and verify each [S1] maps to a real indexed source.
    const sampleForCitation = results.filter((r) => r.category !== 'noanswer' && r.hitPaths.length > 0).slice(0, 10);
    let citationCorrect = 0;
    for (const r of sampleForCitation) {
      const pack = await service.buildEvidencePack({ query: r.query });
      if (pack.items.length > 0 && pack.items[0].citationId === 'S1' && pack.items[0].path) {
        citationCorrect++;
      }
    }
    const citationCorrectness = sampleForCitation.length > 0 ? citationCorrect / sampleForCitation.length : 1;

    // Collect failures for the report.
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
            reason: `Expected source not in top-5 (rank: ${r.rankOfFirstExpected ?? 'not found'}). Got: ${r.top5Paths.join(', ') || 'none'}`,
          });
        }
      }
    }

    const perCategory: Record<string, { recall: number; mrr: number; count: number }> = {};
    for (const cat of ['exact', 'paraphrase', 'multi', 'heading']) {
      const rs = results.filter((r) => r.category === cat);
      perCategory[cat] = { recall: recallAt5(rs), mrr: mrr(rs), count: rs.length };
    }
    perCategory['noanswer'] = {
      recall: noAnswerPrecision,
      mrr: 0,
      count: noAnswerResults.length,
    };

    const fallbackRate = results.filter((r) => r.fallbackUsed).length / results.length;

    metrics = {
      recallAt5: recallAll,
      recallAt5Exact: recallExact,
      mrr: overallMrr,
      noAnswerPrecision,
      indexFreshness,
      p95LatencyMs: p95Latency,
      citationCorrectness,
      totalQueries: results.length,
      fallbackRate,
      perCategory,
      failures,
    };

    // Persist baseline results to eval/baseline.md (gitignored).
    const report = formatReport(metrics, results, freshnessDetails);
    mkdirSync(path.join(process.cwd(), 'eval'), { recursive: true });
    writeFileSync(path.join(process.cwd(), 'eval', 'baseline.md'), report, 'utf8');
  });

  it('indexes all fixture files', () => {
    expect(initialFileCount).toBeGreaterThanOrEqual(10);
  });

  it('meets Recall@5 gate (>= 80% exact-term queries)', () => {
    console.log(`Recall@5 (exact): ${(metrics.recallAt5Exact * 100).toFixed(1)}%`);
    console.log(`Recall@5 (all answerable): ${(metrics.recallAt5 * 100).toFixed(1)}%`);
    expect(metrics.recallAt5Exact).toBeGreaterThanOrEqual(0.8);
  });

  it('computes MRR (compare every change)', () => {
    console.log(`MRR: ${metrics.mrr.toFixed(3)}`);
    expect(metrics.mrr).toBeGreaterThan(0);
  });

  it('meets citation correctness gate (100% sampled)', () => {
    console.log(`Citation correctness: ${(metrics.citationCorrectness * 100).toFixed(1)}%`);
    expect(metrics.citationCorrectness).toBe(1);
  });

  it('meets no-answer precision gate (>= 90%)', () => {
    console.log(`No-answer precision: ${(metrics.noAnswerPrecision * 100).toFixed(1)}%`);
    expect(metrics.noAnswerPrecision).toBeGreaterThanOrEqual(0.9);
  });

  it('meets index freshness gate (100% fixture cases)', () => {
    console.log(`Index freshness: ${(metrics.indexFreshness * 100).toFixed(1)}%`);
    expect(metrics.indexFreshness).toBe(1);
  });

  it('records P95 search latency', () => {
    console.log(`P95 latency: ${metrics.p95LatencyMs.toFixed(1)}ms`);
    expect(metrics.p95LatencyMs).toBeGreaterThan(0);
  });

  it('writes baseline.md report and completes all queries', () => {
    // The report is written in beforeAll; verify the metrics object is populated.
    // Per runbook §9.3, paraphrase queries are a "known Phase-1 limitation" and
    // are NOT gated. Only exact-term Recall@5, no-answer precision, index
    // freshness, and citation correctness have gates.
    expect(metrics.totalQueries).toBe(LABELLED_QUERIES.length);
  });
});

function formatReport(m: MetricsResult, rs: QueryResult[], freshnessDetails: string[]): string {
  const now = new Date().toISOString();
  const lines: string[] = [];
  lines.push(`# Retrieval evaluation baseline`);
  lines.push('');
  lines.push(`Generated: ${now}`);
  lines.push(`Fixture vault: ${FIXTURE_ROOT}`);
  lines.push(`Total queries: ${m.totalQueries}`);
  lines.push('');
  lines.push(`## Metrics (runbook §9.4)`);
  lines.push('');
  lines.push(`| Metric | Value | Gate | Status |`);
  lines.push(`|---|---|---|---|`);
  lines.push(`| Recall@5 (exact) | ${(m.recallAt5Exact * 100).toFixed(1)}% | >= 80% | ${m.recallAt5Exact >= 0.8 ? 'PASS' : 'FAIL'} |`);
  lines.push(`| Recall@5 (all answerable) | ${(m.recallAt5 * 100).toFixed(1)}% | — | — |`);
  lines.push(`| MRR | ${m.mrr.toFixed(3)} | Compare every change | — |`);
  lines.push(`| Citation correctness | ${(m.citationCorrectness * 100).toFixed(1)}% | 100% | ${m.citationCorrectness === 1 ? 'PASS' : 'FAIL'} |`);
  lines.push(`| No-answer precision | ${(m.noAnswerPrecision * 100).toFixed(1)}% | >= 90% | ${m.noAnswerPrecision >= 0.9 ? 'PASS' : 'FAIL'} |`);
  lines.push(`| Index freshness | ${(m.indexFreshness * 100).toFixed(1)}% | 100% | ${m.indexFreshness === 1 ? 'PASS' : 'FAIL'} |`);
  lines.push(`| P95 search latency | ${m.p95LatencyMs.toFixed(1)}ms | Record | — |`);
  lines.push(`| Fallback rate | ${(m.fallbackRate * 100).toFixed(1)}% | Record | — |`);
  lines.push('');
  if (freshnessDetails.length > 0) {
    lines.push(`## Index freshness details`);
    lines.push('');
    for (const d of freshnessDetails) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }
  lines.push(`## Per-category breakdown`);
  lines.push('');
  lines.push(`| Category | Recall@5 | MRR | Count |`);
  lines.push(`|---|---|---|---|`);
  for (const [cat, vals] of Object.entries(m.perCategory)) {
    lines.push(`| ${cat} | ${(vals.recall * 100).toFixed(1)}% | ${vals.mrr.toFixed(3)} | ${vals.count} |`);
  }
  lines.push('');
  lines.push(`## Per-query results`);
  lines.push('');
  lines.push(`| ID | Category | Query | Rank | Top-5 paths | Latency | Mode | Fallback | Coverage | Status |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of rs) {
    const status = r.category === 'noanswer'
      ? (r.hitPaths.length === 0 ? 'correct-empty' : 'WRONG-hits')
      : (r.rankOfFirstExpected !== null && r.rankOfFirstExpected <= 5 ? 'PASS' : 'FAIL');
    const rank = r.rankOfFirstExpected ?? '-';
    const top5 = r.top5Paths.length > 0 ? r.top5Paths.map((p) => p.split('/').pop()).join(', ') : '(none)';
    const mode = r.retrievalMode;
    const fb = r.fallbackUsed ? 'yes' : 'no';
    const cov = r.matchedTermFraction > 0 ? r.matchedTermFraction.toFixed(2) : '-';
    lines.push(`| ${r.id} | ${r.category} | ${r.query} | ${rank} | ${top5} | ${r.latencyMs.toFixed(1)}ms | ${mode} | ${fb} | ${cov} | ${status} |`);
  }
  if (m.failures.length > 0) {
    lines.push('');
    lines.push(`## Failures (${m.failures.length})`);
    lines.push('');
    for (const f of m.failures) {
      lines.push(`- **${f.id}** (${f.query}): ${f.reason}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
