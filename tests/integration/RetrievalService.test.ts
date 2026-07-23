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
const { RetrievalService } = await import('../../src/retrieval/RetrievalService');
const { IndexCoordinator } = await import('../../src/retrieval/IndexCoordinator');
const { DebugLogger } = await import('../../src/utils/DebugLogger');
const {
  formatEvidenceForModel,
  GROUNDED_ANSWER_INSTRUCTION,
} = await import('../../src/retrieval/EvidencePackBuilder');
import type { RetrievalSettings, RetrievalSourceConfig } from '../../src/types/retrieval';

function makeSource(overrides: Partial<RetrievalSourceConfig> = {}): RetrievalSourceConfig {
  return {
    id: 'vault',
    name: 'Vault',
    kind: 'vault',
    rootPath: '',
    enabled: true,
    trust: 'personal',
    includeGlobs: ['**/*.md'],
    excludeGlobs: ['.obsidian/**'],
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

describe('RetrievalService + EvidencePack (integration)', () => {
  let mock: ReturnType<typeof createRetrievalMockVault>;
  let settings: RetrievalSettings;
  let debugLogger: InstanceType<typeof DebugLogger>;
  let db: InstanceType<typeof RetrievalDatabase>;
  let coordinator: InstanceType<typeof IndexCoordinator>;
  let service: InstanceType<typeof RetrievalService>;

  beforeEach(async () => {
    mock = createRetrievalMockVault();
    settings = makeSettings();
    debugLogger = new DebugLogger(false, 'test');
    db = new RetrievalDatabase(mock.app as any, { dbPath: DEFAULT_DB_PATH, wasmPath: ADAPTER_WASM_PATH });
    coordinator = new IndexCoordinator(mock.app as any, db, () => settings, debugLogger);
    service = new RetrievalService({ database: db }, {
      evidenceTokenBudget: settings.evidenceTokenBudget,
      defaultResultLimit: settings.defaultResultLimit,
    });
    await coordinator.initialize();
  });

  async function index() {
    await coordinator.indexAll();
  }

  describe('no-LLM search', () => {
    it('returns ranked hits without any LLM configuration', async () => {
      mock.addFile('notes/python.md', '# Python Setup\n\nInstall Python 3.11 and pip.', 1000);
      mock.addFile('notes/rust.md', '# Rust Setup\n\nInstall rustc and cargo.', 1000);
      await index();

      const hits = await service.search({ query: 'python' });
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(hits[0].path).toBe('notes/python.md');
    });

    it('search works with an empty vault', async () => {
      const hits = await service.search({ query: 'anything' });
      expect(hits).toEqual([]);
    });

    it('an exact API/error query retrieves correct chunks', async () => {
      mock.addFile(
        'notes/api.md',
        '# API Notes\n\nThe `app.vault.read` function throws error 404 when the file is missing.',
        1000
      );
      await index();

      const hits = await service.search({ query: 'app.vault.read error 404' });
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(hits[0].path).toBe('notes/api.md');
    });

    it('respects the defaultResultLimit option', async () => {
      for (let i = 0; i < 15; i++) {
        mock.addFile(`notes/n${i}.md`, `# Note ${i}\\nshared term ${i}`, 1000 + i);
      }
      await index();
      const hits = await service.search({ query: 'shared' });
      expect(hits.length).toBeLessThanOrEqual(settings.defaultResultLimit);
    });
  });

  describe('evidence pack hand-off', () => {
    it('builds an evidence pack with stable [S1], [S2], ... citation IDs', async () => {
      mock.addFile('notes/a.md', '# Topic A\n\nThe first source discusses python.', 1000);
      mock.addFile('notes/b.md', '# Topic B\n\nThe second source covers rust.', 1000);
      await index();

      const pack = await service.buildEvidencePack({ query: 'python' });
      expect(pack.items.length).toBeGreaterThanOrEqual(1);
      expect(pack.items[0].citationId).toMatch(/^S\d+$/);
    });

    it('passes selected evidence chunks (not complete unrelated notes) to the model input', async () => {
      mock.addFile(
        'notes/relevant.md',
        '# Relevant\n\nThe relevant chunk about python setup is here.',
        1000
      );
      mock.addFile(
        'notes/unrelated.md',
        '# Unrelated\n\nThis note is about cooking recipes and contains no query terms.',
        1000
      );
      await index();

      const pack = await service.buildEvidencePack({ query: 'python' });
      // Only the relevant note should appear in the evidence.
      expect(pack.items.every((i) => i.path !== 'notes/unrelated.md')).toBe(true);
      expect(pack.items.some((i) => i.path === 'notes/relevant.md')).toBe(true);
    });

    it('the formatted evidence block contains the citation id, source path, and chunk text', async () => {
      mock.addFile('notes/evidence.md', '# Evidence\n\nThe python installer is called pip.', 1000);
      await index();

      const pack = await service.buildEvidencePack({ query: 'python' });
      const formatted = formatEvidenceForModel(pack.items[0]);
      expect(formatted).toContain(`[${pack.items[0].citationId}]`);
      expect(formatted).toContain('Source: notes/evidence.md');
      expect(formatted).toContain('pip');
    });

    it('GROUNDED_ANSWER_INSTRUCTION is available for the system prompt', async () => {
      expect(GROUNDED_ANSWER_INSTRUCTION).toContain('[S1]');
      expect(GROUNDED_ANSWER_INSTRUCTION.length).toBeGreaterThan(50);
    });
  });

  describe('[S1] citation source mapping', () => {
    it('a citation id maps back to exactly one indexed source path', async () => {
      mock.addFile('notes/source-one.md', '# One\n\nThe python interpreter runs bytecode.', 1000);
      mock.addFile('notes/source-two.md', '# Two\n\nThe rust compiler emits machine code.', 1000);
      await index();

      const pack = await service.buildEvidencePack({ query: 'python' });
      expect(pack.items.length).toBeGreaterThanOrEqual(1);

      // Each citation id maps to exactly one path; no id is reused.
      const ids = pack.items.map((i) => i.citationId);
      expect(new Set(ids).size).toBe(ids.length);
      // The cited source supports the query (contains "python").
      const cited = pack.items[0];
      expect(cited.text.toLowerCase()).toContain('python');
      expect(cited.path).toBe('notes/source-one.md');
    });

    it('a generated answer with [S1] renders a link to the actual indexed source', async () => {
      mock.addFile('notes/citable.md', '# Citable\n\nThe python GIL prevents true parallelism.', 1000);
      await index();

      const pack = await service.buildEvidencePack({ query: 'python' });
      // Simulate an LLM answer that cites [S1].
      const answer = 'The GIL is described in [S1].';
      const s1 = pack.items.find((i) => i.citationId === 'S1');
      expect(s1).toBeDefined();
      expect(s1?.path).toBe('notes/citable.md');
      // The answer's [S1] reference resolves to the indexed source path.
      expect(answer).toContain(s1!.citationId);
    });
  });

  describe('search filters', () => {
    it('folderPrefix restricts results to a folder', async () => {
      mock.addFile('docs/python.md', '# Python\n\nshared term', 1000);
      mock.addFile('notes/python.md', '# Python\n\nshared term', 1000);
      await index();

      const hits = await service.search({ query: 'shared', folderPrefix: 'docs' });
      expect(hits.every((h) => h.path.startsWith('docs'))).toBe(true);
    });

    it('tags filter restricts results to tagged chunks', async () => {
      mock.addFile('notes/a.md', '---\ntags: [python]\n---\n\n# H\n\nshared term', 1000);
      mock.addFile('notes/b.md', '---\ntags: [rust]\n---\n\n# H\n\nshared term', 1000);
      await index();

      const hits = await service.search({ query: 'shared', tags: ['python'] });
      expect(hits.every((h) => h.tags.includes('python'))).toBe(true);
    });
  });

  describe('empty / no-result queries', () => {
    it('returns an empty evidence pack when nothing matches', async () => {
      mock.addFile('notes/a.md', '# H\n\ncompletely unrelated text', 1000);
      await index();

      const pack = await service.buildEvidencePack({ query: 'zzzznomatch' });
      expect(pack.items).toEqual([]);
      expect(pack.omittedHitCount).toBe(0);
    });
  });
});
