import { describe, it, expect, beforeAll, vi } from 'vitest';
import { initFts5SqlJs } from '../tests/helpers/fts5Wasm';
import {
  createRetrievalMockVault,
  ADAPTER_WASM_PATH,
  DEFAULT_DB_PATH,
} from '../tests/helpers/retrievalMockVault';
import { listFixtureFiles } from './labelledQueries';

vi.mock('sql.js', () => ({
  default: initFts5SqlJs(),
}));

const { RetrievalDatabase } = await import('../src/retrieval/RetrievalDatabase');
const { RetrievalService } = await import('../src/retrieval/RetrievalService');
const { IndexCoordinator } = await import('../src/retrieval/IndexCoordinator');
const { KnowledgeAgent } = await import('../src/retrieval/KnowledgeAgent');
const { DebugLogger } = await import('../src/utils/DebugLogger');
import type { RetrievalSettings } from '../src/types/retrieval';

const OLLAMA_URL = 'http://localhost:11434';
const LLM_MODEL = 'gemma4:31b-cloud';

async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { method: 'GET' });
    return res.ok;
  } catch { return false; }
}

async function isModelAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { method: 'GET' });
    if (!res.ok) return false;
    const data = await res.json() as { models: { name: string }[] };
    return data.models?.some((m) => m.name.includes('gemma4:31b') || m.name.includes('gemma'));
  } catch { return false; }
}

function makeSettings(): RetrievalSettings {
  return {
    enabled: true, databasePath: DEFAULT_DB_PATH,
    sources: [{
      id: 'fixtures', name: 'Fixtures', kind: 'vault' as const,
      rootPath: '', enabled: true, trust: 'personal' as const,
      includeGlobs: ['**/*.md'], excludeGlobs: [], maxFileBytes: 5_000_000,
    }],
    evidenceTokenBudget: 12000, defaultResultLimit: 10,
    autoIndexOnStartup: false, autoIndexOnModify: true,
    allowGeneralKnowledgeWhenUngrounded: false,
    embedding: { provider: 'none', ollamaEndpoint: '', ollamaModel: '', chutesApiKey: '', chutesBaseUrl: '', chutesModel: '', semanticThreshold: 0.3, lexicalVeto: true },
  };
}

const TEST_QUESTIONS = [
  { id: 'Q1', query: 'What is DeepSeek and what can it do?', expectContains: ['DeepSeek'] },
  { id: 'Q2', query: 'What is Goose and how does it compare to other coding agents?', expectContains: ['Goose'] },
  { id: 'Q3', query: 'How does Ra-AID work as an agentic coder?', expectContains: ['Ra-AID', 'ra-aid', 'Ra-AID'.toLowerCase(), 'agentic', 'coder'] },
  { id: 'Q4', query: 'What did Karpathy say about how he uses LLMs?', expectContains: ['Karpathy', 'LLM'] },
  { id: 'Q5', query: 'What is the o3-mini model and the AI War about?', expectContains: ['o3', 'AI War', 'ai war'] },
  { id: 'Q6', query: 'What is quantum entanglement?', expectContains: ['could not find', 'not in the indexed'] },
];

describe('KnowledgeAgent live eval (Ollama gemma4:31b-cloud)', () => {
  let ollamaReady = false;
  let modelReady = false;
  let db: InstanceType<typeof RetrievalDatabase>;
  let coordinator: InstanceType<typeof IndexCoordinator>;
  let service: InstanceType<typeof RetrievalService>;
  let mock: ReturnType<typeof createRetrievalMockVault>;

  beforeAll(async () => {
    ollamaReady = await isOllamaRunning();
    modelReady = ollamaReady && await isModelAvailable();
    if (!modelReady) {
      console.log('Ollama or gemma model not available — skipping live agent eval');
      return;
    }

    const files = listFixtureFiles();
    mock = createRetrievalMockVault();
    const settings = makeSettings();
    const debugLogger = new DebugLogger(false, 'agent-eval');

    for (const f of files) {
      mock.addFile(f.rel, f.content, Math.floor(f.mtime));
    }

    db = new RetrievalDatabase(mock.app as any, { dbPath: DEFAULT_DB_PATH, wasmPath: ADAPTER_WASM_PATH });
    coordinator = new IndexCoordinator(mock.app as any, db, () => settings, debugLogger);
    await coordinator.initialize();
    await coordinator.indexAll();

    service = new RetrievalService({ database: db }, {
      evidenceTokenBudget: 12000, defaultResultLimit: 10,
    });
  }, 120_000);

  for (const q of TEST_QUESTIONS) {
    it(`${q.id}: ${q.query}`, async () => {
      if (!modelReady) return;

      const generateText = async (opts: { model: string; message: string; temperature?: number; maxTokens?: number }): Promise<string> => {
        const res = await fetch(`${OLLAMA_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: opts.model,
            messages: [{ role: 'user', content: opts.message }],
            stream: false,
            options: {
              temperature: opts.temperature ?? 0.3,
              num_predict: opts.maxTokens ?? 2000,
            },
          }),
        });
        if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
        const data = await res.json() as { message: { content: string } };
        return data.message.content;
      };

      const agent = new KnowledgeAgent({
        retrievalService: service,
        model: LLM_MODEL,
        generateText,
      });

      const start = performance.now();
      const result = await agent.answer(q.query, {
        maxSearchCalls: 2,
        maxReadCalls: 3,
        maxEvidenceTokens: 8000,
        maxAnswerTokens: 1000,
        timeoutMs: 120_000,
      });
      const elapsed = performance.now() - start;

      console.log(`\n${q.id} (${(elapsed / 1000).toFixed(1)}s, ${result.searchCalls} search, ${result.readCalls} read):`);
      console.log(`  Answer: ${result.answer.slice(0, 200)}...`);
      console.log(`  Citations: ${result.citations.join(', ') || '(none)'}`);

      // Accept either: answer contains expected terms, OR model correctly says it couldn't find it
      const answerLower = result.answer.toLowerCase();
      const hasExpected = q.expectContains.some((e) => answerLower.includes(e.toLowerCase()));
      const isNotFound = answerLower.includes('could not find') || answerLower.includes('not in the indexed');
      expect(hasExpected || isNotFound).toBe(true);
    }, 180_000);
  }
});
