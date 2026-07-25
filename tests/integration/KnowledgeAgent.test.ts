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
const { KnowledgeAgent } = await import('../../src/retrieval/KnowledgeAgent');
const { DebugLogger } = await import('../../src/utils/DebugLogger');
import type { RetrievalSettings } from '../../src/types/retrieval';

function makeSettings(): RetrievalSettings {
  return {
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
    embedding: { provider: 'none', ollamaEndpoint: '', ollamaModel: '', chutesApiKey: '', chutesBaseUrl: '', chutesModel: '', semanticThreshold: 0.3, lexicalVeto: true },
  };
}

describe('KnowledgeAgent', () => {
  let db: InstanceType<typeof RetrievalDatabase>;
  let coordinator: InstanceType<typeof IndexCoordinator>;
  let service: InstanceType<typeof RetrievalService>;
  let mock: ReturnType<typeof createRetrievalMockVault>;

  beforeEach(async () => {
    mock = createRetrievalMockVault();
    const settings = makeSettings();
    const debugLogger = new DebugLogger(false, 'test');

    db = new RetrievalDatabase(mock.app as any, { dbPath: DEFAULT_DB_PATH, wasmPath: ADAPTER_WASM_PATH });
    coordinator = new IndexCoordinator(mock.app as any, db, () => settings, debugLogger);
    await coordinator.initialize();

    mock.addFile('cats.md', '# Cats\n\nCats are small furry pets that love to sleep. They purr when happy.', 1);
    mock.addFile('dogs.md', '# Dogs\n\nDogs are loyal pets that love to play fetch. They bark to communicate.', 2);
    mock.addFile('birds.md', '# Birds\n\nBirds are flying pets that sing beautiful songs. They build nests in trees.', 3);
    await coordinator.indexAll();

    service = new RetrievalService({ database: db }, {
      evidenceTokenBudget: 12000,
      defaultResultLimit: 10,
    });
  });

  it('returns "not found" when search returns no hits', async () => {
    const generateText = vi.fn();
    const agent = new KnowledgeAgent({
      retrievalService: service,
      generateText,
      model: 'test-model',
    });

    const result = await agent.answer('quantum physics');
    expect(result.answer).toContain('could not find');
    expect(result.searchCalls).toBe(1);
    expect(result.readCalls).toBe(0);
    expect(generateText).not.toHaveBeenCalled();
  });

  it('searches, reads selected sources, and generates a grounded answer', async () => {
    const generateText = vi.fn()
      .mockResolvedValueOnce('1') // selection: read source 1 (cats.md)
      .mockResolvedValueOnce('Cats are small furry pets [S1]. They purr when happy.'); // answer

    const agent = new KnowledgeAgent({
      retrievalService: service,
      generateText,
      model: 'test-model',
    });

    const result = await agent.answer('cats');
    expect(result.searchCalls).toBe(1);
    expect(result.readCalls).toBe(1);
    expect(result.answer).toContain('Cats');
    expect(result.citations).toContain('[S1]');
    expect(result.steps.length).toBe(3); // search, read, answer
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it('defaults to top-3 reads when LLM says ANSWER', async () => {
    const generateText = vi.fn()
      .mockResolvedValueOnce('ANSWER')
      .mockResolvedValueOnce('Based on the snippets: cats are pets [S1].');

    const agent = new KnowledgeAgent({
      retrievalService: service,
      generateText,
      model: 'test-model',
    });

    const result = await agent.answer('pets');
    expect(result.readCalls).toBe(3); // defaults to top 3 (3 files match "pets")
    expect(result.answer).toContain('cats');
  });

  it('respects maxReadCalls limit', async () => {
    const generateText = vi.fn()
      .mockResolvedValueOnce('1,2,3')
      .mockResolvedValueOnce('Answer with all evidence [S1] [S2] [S3].');

    const agent = new KnowledgeAgent({
      retrievalService: service,
      generateText,
      model: 'test-model',
    });

    const result = await agent.answer('pets', { maxReadCalls: 2 });
    expect(result.readCalls).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it('records step-by-step latency and citations', async () => {
    const generateText = vi.fn()
      .mockResolvedValueOnce('1,2')
      .mockResolvedValueOnce('Cats [S1] and dogs [S2] are both pets.');

    const agent = new KnowledgeAgent({
      retrievalService: service,
      generateText,
      model: 'test-model',
    });

    const result = await agent.answer('pets');
    expect(result.steps[0].type).toBe('search');
    expect(result.steps[0].searchResultCount).toBeGreaterThan(0);
    expect(result.steps[1].type).toBe('read');
    expect(result.steps[2].type).toBe('answer');
    expect(result.steps[2].answer).toContain('Cats');
    expect(result.citations).toEqual(expect.arrayContaining(['[S1]', '[S2]']));
    expect(result.totalLatencyMs).toBeGreaterThan(0);
  });

  it('supports two-phase API: prepareEvidence + generateAnswer', async () => {
    const generateText = vi.fn()
      .mockResolvedValueOnce('1') // selection: read source 1 (cats.md)
      .mockResolvedValueOnce('Cats are small furry pets [S1].'); // answer

    const agent = new KnowledgeAgent({
      retrievalService: service,
      generateText,
      model: 'test-model',
    });

    // Phase 1: gather evidence
    const evidence = await agent.prepareEvidence('cats');
    expect(evidence.hits.length).toBe(1);
    expect(evidence.searchCalls).toBe(1);
    expect(evidence.readCalls).toBe(1);
    expect(evidence.steps.length).toBe(2); // search + read
    expect(evidence.refinedQuery).toBe('cats');

    // Phase 2: generate answer (may modify hits before this)
    const result = await agent.generateAnswer('cats', evidence);
    expect(result.answer).toContain('Cats');
    expect(result.citations).toContain('[S1]');
    expect(result.steps.length).toBe(3); // search + read + answer
  });

  it('allows deselecting evidence between phases', async () => {
    const generateText = vi.fn()
      .mockResolvedValueOnce('1,2') // selection: read sources 1 and 2
      .mockResolvedValueOnce('Cats and dogs are pets [S1].'); // answer

    const agent = new KnowledgeAgent({
      retrievalService: service,
      generateText,
      model: 'test-model',
    });

    const evidence = await agent.prepareEvidence('pets');
    expect(evidence.hits.length).toBe(2);

    // User deselects the second hit
    const filteredEvidence = {
      ...evidence,
      hits: evidence.hits.slice(0, 1),
    };

    const result = await agent.generateAnswer('pets', filteredEvidence);
    expect(result.answer).toContain('Cats');
    // Only S1 should be in the answer prompt since we filtered to 1 hit
    expect(result.evidencePack.items.length).toBe(2); // original evidence pack unchanged
  });

  it('emits progress events during execution', async () => {
    const generateText = vi.fn()
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce('Cats are pets [S1].');

    const agent = new KnowledgeAgent({
      retrievalService: service,
      generateText,
      model: 'test-model',
    });

    const events: { phase: string; message: string }[] = [];
    await agent.answer('cats', {}, (event) => {
      events.push({ phase: event.phase, message: event.message });
    });

    const phases = events.map((e) => e.phase);
    expect(phases).toContain('extracting-terms');
    expect(phases).toContain('searching');
    expect(phases).toContain('selecting');
    expect(phases).toContain('reading');
    expect(phases).toContain('answering');
    expect(phases).toContain('done');
  });

  it('emits events with correct phases in two-phase mode', async () => {
    const generateText = vi.fn()
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce('Answer [S1].');

    const agent = new KnowledgeAgent({
      retrievalService: service,
      generateText,
      model: 'test-model',
    });

    const phase1Events: string[] = [];
    const evidence = await agent.prepareEvidence('cats', {}, (e) => {
      phase1Events.push(e.phase);
    });
    expect(phase1Events).toContain('searching');
    expect(phase1Events).toContain('done');

    const phase2Events: string[] = [];
    await agent.generateAnswer('cats', evidence, {}, (e) => {
      phase2Events.push(e.phase);
    });
    expect(phase2Events).toContain('answering');
    expect(phase2Events).toContain('done');
  });

  it('includes allowGeneralKnowledge in answer prompt when enabled', async () => {
    const generateText = vi.fn()
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce('Cats are pets [S1]. General knowledge: cats have whiskers (uncited).');

    const agent = new KnowledgeAgent({
      retrievalService: service,
      generateText,
      model: 'test-model',
    });

    const result = await agent.answer('cats', { allowGeneralKnowledge: true });
    // The answer prompt should have been called with the general knowledge instruction
    const answerCall = generateText.mock.calls[1];
    expect(answerCall[0].message).toContain('General knowledge (uncited)');
  });
});
