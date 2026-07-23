import { describe, expect, it, beforeAll } from 'vitest';
import { OllamaEmbeddingProvider } from '../../src/retrieval/OllamaEmbeddingProvider';

const OLLAMA_URL = 'http://localhost:11434';
const MODEL = 'qwen3-embedding:0.6b';

async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

describe('OllamaEmbeddingProvider (live)', () => {
  let ollamaAvailable = false;

  beforeAll(async () => {
    ollamaAvailable = await isOllamaRunning();
  });

  it('connects to Ollama and returns embeddings', async () => {
    if (!ollamaAvailable) {
      console.log('Skipping: Ollama not running on localhost:11434');
      return;
    }
    const provider = new OllamaEmbeddingProvider({ endpoint: OLLAMA_URL, model: MODEL });
    const vectors = await provider.embed(['hello world', 'cats are small pets']);
    expect(vectors.length).toBe(2);
    expect(vectors[0].length).toBe(provider.dimensions);
    expect(vectors[1].length).toBe(provider.dimensions);
  }, 30_000);

  it('embeds multiple texts with correct dimensions', async () => {
    if (!ollamaAvailable) {
      console.log('Skipping: Ollama not running on localhost:11434');
      return;
    }
    const provider = new OllamaEmbeddingProvider({ endpoint: OLLAMA_URL, model: MODEL });
    const texts = ['DeepSeek is a language model', 'Goose is an AI coding agent', 'Ra-AID is an agentic coder'];
    const vectors = await provider.embed(texts);
    expect(vectors.length).toBe(3);
    for (const v of vectors) {
      expect(v.length).toBe(provider.dimensions);
    }
  }, 30_000);

  it('respects AbortSignal', async () => {
    if (!ollamaAvailable) {
      console.log('Skipping: Ollama not running on localhost:11434');
      return;
    }
    const provider = new OllamaEmbeddingProvider({ endpoint: OLLAMA_URL, model: MODEL });
    const controller = new AbortController();
    controller.abort();
    await expect(provider.embed(['test'], controller.signal)).rejects.toThrow();
  }, 10_000);

  it('handles concurrent requests', async () => {
    if (!ollamaAvailable) {
      console.log('Skipping: Ollama not running on localhost:11434');
      return;
    }
    const provider = new OllamaEmbeddingProvider({ endpoint: OLLAMA_URL, model: MODEL, concurrency: 4 });
    const texts = Array.from({ length: 10 }, (_, i) => `test text number ${i}`);
    const start = performance.now();
    const vectors = await provider.embed(texts);
    const elapsed = performance.now() - start;
    expect(vectors.length).toBe(10);
    console.log(`10 concurrent embeds in ${elapsed.toFixed(0)}ms (${(elapsed / 10).toFixed(0)}ms each avg)`);
  }, 60_000);
});
