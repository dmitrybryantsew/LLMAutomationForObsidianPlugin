import { EmbeddingProvider } from '../types/retrieval';

const DEFAULT_OLLAMA_ENDPOINT = 'http://localhost:11434';
const DEFAULT_CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 30_000;

export interface OllamaEmbeddingProviderOptions {
  endpoint?: string;
  model?: string;
  concurrency?: number;
}

interface OllamaEmbedResponse {
  embedding: number[];
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

    const batches: { index: number; text: string }[] = texts.map((text, index) => ({ index, text }));

    const worker = async (queue: { index: number; text: string }[]) => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        results[item.index] = await this.embedOne(item.text, signal);
      }
    };

    const queue = [...batches];
    const workers = Array.from({ length: Math.min(this.concurrency, batches.length) }, () => worker(queue));
    await Promise.all(workers);

    return results;
  }

  private async embedOne(text: string, signal?: AbortSignal): Promise<Float32Array> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const body = JSON.stringify({ model: this.modelId, prompt: text });
      const res = await fetch(`${this.endpoint}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Ollama embeddings API error: ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as OllamaEmbedResponse;
      return Float32Array.from(data.embedding);
    } finally {
      clearTimeout(timeout);
    }
  }
}
