import { describe, expect, it, beforeAll, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
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
const { RetrievalService } = await import('../../src/retrieval/RetrievalService');
const { IndexCoordinator } = await import('../../src/retrieval/IndexCoordinator');
const { DebugLogger } = await import('../../src/utils/DebugLogger');
import type { RetrievalSettings, RetrievalSourceConfig } from '../../src/types/retrieval';

const FIXTURE_ROOT = path.resolve(
  path.join(process.cwd(), '..', 'testMdFiles')
);

function listFixtureFiles(): { rel: string; content: string; mtime: number; size: number }[] {
  const out: { rel: string; content: string; mtime: number; size: number }[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const content = readFileSync(full, 'utf8');
        const st = statSync(full);
        const rel = path.relative(FIXTURE_ROOT, full).replace(/\\/g, '/');
        out.push({ rel, content, mtime: st.mtimeMs, size: Buffer.byteLength(content) });
      }
    }
  }
  walk(FIXTURE_ROOT);
  return out;
}

function makeSource(rootPath: string): RetrievalSourceConfig {
  return {
    id: 'fixtures',
    name: 'Fixtures',
    kind: 'vault',
    rootPath,
    enabled: true,
    trust: 'personal',
    includeGlobs: ['**/*.md'],
    excludeGlobs: [],
    maxFileBytes: 5_000_000,
  };
}

function makeSettings(rootPath: string): RetrievalSettings {
  return {
    enabled: true,
    databasePath: DEFAULT_DB_PATH,
    sources: [makeSource(rootPath)],
    evidenceTokenBudget: 12000,
    defaultResultLimit: 10,
    autoIndexOnStartup: false,
    autoIndexOnModify: true,
    allowGeneralKnowledgeWhenUngrounded: false,
  };
}

describe('Fixture vault end-to-end (testMdFiles)', () => {
  let mock: ReturnType<typeof createRetrievalMockVault>;
  let settings: RetrievalSettings;
  let debugLogger: InstanceType<typeof DebugLogger>;
  let db: InstanceType<typeof RetrievalDatabase>;
  let coordinator: InstanceType<typeof IndexCoordinator>;
  let service: InstanceType<typeof RetrievalService>;
  let files: { rel: string; content: string; mtime: number; size: number }[];

  beforeAll(async () => {
    files = listFixtureFiles();
    expect(files.length).toBeGreaterThanOrEqual(10);

    mock = createRetrievalMockVault();
    // Use an empty rootPath so all fixture files are indexed regardless of folder.
    settings = makeSettings('');
    debugLogger = new DebugLogger(false, 'test');

    for (const f of files) {
      mock.addFile(f.rel, f.content, Math.floor(f.mtime));
    }

    db = new RetrievalDatabase(mock.app as any, { dbPath: DEFAULT_DB_PATH, wasmPath: ADAPTER_WASM_PATH });
    coordinator = new IndexCoordinator(mock.app as any, db, () => settings, debugLogger);
    service = new RetrievalService(db, {
      evidenceTokenBudget: settings.evidenceTokenBudget,
      defaultResultLimit: settings.defaultResultLimit,
    });
    await coordinator.initialize();
    await coordinator.indexAll();
  });

  it('indexes every fixture file and produces chunks', () => {
    const status = coordinator.getStatus();
    expect(status.fileCount).toBe(files.length);
    expect(status.chunkCount).toBeGreaterThan(files.length); // most files have multiple sections
  });

  it('retrieves a chunk mentioning "DeepSeek"', async () => {
    const hits = await service.search({ query: 'DeepSeek' });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some((h) => /DeepSeek/i.test(h.text))).toBe(true);
  });

  it('retrieves a chunk mentioning "Karpathy"', async () => {
    const hits = await service.search({ query: 'Karpathy' });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some((h) => h.path.includes('Andrej_Karpathy'))).toBe(true);
  });

  it('retrieves a chunk about "Claude"', async () => {
    const hits = await service.search({ query: 'Claude' });
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('retrieves chunks about coding agents', async () => {
    const hits = await service.search({ query: 'coding agent' });
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('filters results to the AICodeKing folder', async () => {
    const hits = await service.search({ query: 'agent', folderPrefix: 'AICodeKing' });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.every((h) => h.path.startsWith('AICodeKing'))).toBe(true);
  });

  it('builds an evidence pack with stable citation IDs for a real query', async () => {
    const pack = await service.buildEvidencePack({ query: 'DeepSeek agent' });
    expect(pack.items.length).toBeGreaterThanOrEqual(1);
    const ids = pack.items.map((i) => i.citationId);
    expect(ids[0]).toBe('S1');
    expect(new Set(ids).size).toBe(ids.length);
    expect(pack.totalEstimatedTokens).toBeGreaterThan(0);
  });

  it('returns no hits for a term that does not appear in the fixtures', async () => {
    const hits = await service.search({ query: 'zzzznonexistentterm' });
    expect(hits).toEqual([]);
  });
});
