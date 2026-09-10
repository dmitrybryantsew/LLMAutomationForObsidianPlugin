import { EmbeddingProvider } from '../types/retrieval';

const DEFAULT_LLAMA_SERVER_ENDPOINT = 'http://127.0.0.1:8005';
const DEFAULT_CONCURRENCY = 1;
const REQUEST_TIMEOUT_MS = 300_000;
const BATCH_SIZE = 16;

export interface LlamaServerEmbeddingProviderOptions {
  endpoint?: string;
  model?: string;
  concurrency?: number;
}

interface LlamaServerEmbeddingsResponse {
  data: { embedding: number[]; index: number }[];
}

/**
 * Embedding provider backed by llama.cpp's llama-server with --embeddings,
 * using the OpenAI-compatible /v1/embeddings endpoint.
 */
export class LlamaServerEmbeddingProvider implements EmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number;
  private endpoint: string;
  private concurrency: number;

  constructor(options: LlamaServerEmbeddingProviderOptions = {}) {
    this.endpoint = (options.endpoint ?? DEFAULT_LLAMA_SERVER_ENDPOINT).replace(/\/+$/, '');
    this.modelId = options.model ?? 'qwen3-embedding-0.6b';
    this.dimensions = 1024;
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    const results: Float32Array[] = new Array(texts.length);

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
    const timeoutMs = Math.max(60_000, texts.length * 60_000);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
    }

    try {
      // OpenAI-style request: input may be a single string or an array of strings.
      const body = JSON.stringify({ model: this.modelId, input: texts });
      const res = await fetch(`${this.endpoint}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`llama-server embeddings API error: ${res.status} ${res.statusText}${errText ? ` - ${errText.slice(0, 300)}` : ''}`);
      }

      const data = (await res.json()) as LlamaServerEmbeddingsResponse;
      // Sort by index to guarantee order matches the input order.
      const sorted = [...data.data].sort((a, b) => a.index - b.index);
      return sorted.map((item) => Float32Array.from(item.embedding));
    } catch (error) {
      if (controller.signal.aborted && !signal?.aborted) {
        throw new Error(`llama-server embed request timed out after ${timeoutMs / 1000}s for ${texts.length} texts`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
