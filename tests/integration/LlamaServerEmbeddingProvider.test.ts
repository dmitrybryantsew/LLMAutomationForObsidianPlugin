import { describe, expect, it, beforeAll } from 'vitest';
import { LlamaServerEmbeddingProvider } from '../../src/retrieval/LlamaServerEmbeddingProvider';

const LLAMA_SERVER_URL = 'http://127.0.0.1:8005';
// Matches --alias in the GeneralTools Local Embedding Server default args.
// Deliberately identical to Ollama's model id so vectors stay compatible.
const MODEL = 'qwen3-embedding:0.6b';

async function isLlamaServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${LLAMA_SERVER_URL}/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

describe('LlamaServerEmbeddingProvider (live)', () => {
  let serverAvailable = false;

  beforeAll(async () => {
    serverAvailable = await isLlamaServerRunning();
  });

  it('connects to llama-server and returns embeddings', async () => {
    if (!serverAvailable) {
      console.log('Skipping: llama-server not running on 127.0.0.1:8005');
      return;
    }
    const provider = new LlamaServerEmbeddingProvider({ endpoint: LLAMA_SERVER_URL, model: MODEL });
    const vectors = await provider.embed(['hello world', 'cats are small pets']);
    expect(vectors.length).toBe(2);
    expect(vectors[0].length).toBe(provider.dimensions);
    expect(vectors[1].length).toBe(provider.dimensions);
  }, 30_000);

  it('embeds multiple texts and preserves input order', async () => {
    if (!serverAvailable) {
      console.log('Skipping: llama-server not running on 127.0.0.1:8005');
      return;
    }
    const provider = new LlamaServerEmbeddingProvider({ endpoint: LLAMA_SERVER_URL, model: MODEL });
    const texts = ['DeepSeek is a language model', 'Goose is an AI coding agent', 'Ra-AID is an agentic coder'];
    const vectors = await provider.embed(texts);
    expect(vectors.length).toBe(3);
    for (const v of vectors) {
      expect(v.length).toBe(provider.dimensions);
    }
    // Order check: same text embedded in a later call must produce a vector
    // within float32 noise (exact equality does not hold across requests).
    const repeat = await provider.embed([texts[0]]);
    expect(repeat[0].length).toBe(provider.dimensions);
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < repeat[0].length; i++) {
      dot += repeat[0][i] * vectors[0][i];
      na += repeat[0][i] * repeat[0][i];
      nb += vectors[0][i] * vectors[0][i];
    }
    const cosine = dot / (Math.sqrt(na) * Math.sqrt(nb));
    expect(cosine).toBeGreaterThan(0.9999);
  }, 30_000);

  it('respects AbortSignal', async () => {
    if (!serverAvailable) {
      console.log('Skipping: llama-server not running on 127.0.0.1:8005');
      return;
    }
    const provider = new LlamaServerEmbeddingProvider({ endpoint: LLAMA_SERVER_URL, model: MODEL });
    const controller = new AbortController();
    controller.abort();
    await expect(provider.embed(['test'], controller.signal)).rejects.toThrow();
  }, 10_000);

  it('handles batched requests', async () => {
    if (!serverAvailable) {
      console.log('Skipping: llama-server not running on 127.0.0.1:8005');
      return;
    }
    const provider = new LlamaServerEmbeddingProvider({ endpoint: LLAMA_SERVER_URL, model: MODEL });
    const texts = Array.from({ length: 20 }, (_, i) => `test text number ${i}`);
    const start = performance.now();
    const vectors = await provider.embed(texts);
    const elapsed = performance.now() - start;
    expect(vectors.length).toBe(20);
    console.log(`20 batched embeds in ${elapsed.toFixed(0)}ms (${(elapsed / 20).toFixed(0)}ms each avg)`);
  }, 60_000);
});
