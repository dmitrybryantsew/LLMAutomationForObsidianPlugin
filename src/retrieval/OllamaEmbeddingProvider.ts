import { EmbeddingProvider } from '../types/retrieval';

const DEFAULT_OLLAMA_ENDPOINT = 'http://localhost:11434';
const DEFAULT_CONCURRENCY = 1;
const REQUEST_TIMEOUT_MS = 300_000;
const BATCH_SIZE = 16;

export interface OllamaEmbeddingProviderOptions {
  endpoint?: string;
  model?: string;
  concurrency?: number;
}

interface OllamaBatchEmbedResponse {
  embeddings: number[][];
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number;
  private endpoint: string;
  private concurrency: number;

  constructor(options: OllamaEmbeddingProviderOptions = {}) {
    this.endpoint = (options.endpoint ?? DEFAULT_OLLAMA_ENDPOINT).replace(/\/$/, '');
    this.modelId = options.model ?? 'qwen3-embedding:0.6b';
    this.dimensions = 1024;
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    const results: Float32Array[] = new Array(texts.length);

    // Split into batches of BATCH_SIZE and process with limited concurrency.
    const batches: { index: number; texts: string[] }[] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      batches.push({ index: i, texts: texts.slice(i, i + BATCH_SIZE) });
    }

    const worker = async (queue: { index: number; texts: string[] }[]) => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        const vectors = await this.embedBatch(item.texts, signal);
        for (let j = 0; j < vectors.length; j++) {
          results[item.index + j] = vectors[j];
        }
      }
    };

    const queue = [...batches];
    const workers = Array.from({ length: Math.min(this.concurrency, batches.length) }, () => worker(queue));
    await Promise.all(workers);

    return results;
  }

  private async embedBatch(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    const controller = new AbortController();
    // Scale timeout with batch size: 60s per text in the batch.
    const timeoutMs = Math.max(60_000, texts.length * 60_000);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const body = JSON.stringify({ model: this.modelId, input: texts });
      const res = await fetch(`${this.endpoint}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Ollama embed API error: ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as OllamaBatchEmbedResponse;
      return data.embeddings.map((e) => Float32Array.from(e));
    } catch (error) {
      if (controller.signal.aborted && !signal?.aborted) {
        throw new Error(`Ollama embed request timed out after ${timeoutMs / 1000}s for ${texts.length} texts`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
