import { EmbeddingProvider } from '../types/retrieval';

const DEFAULT_CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 60_000;

export interface ChutesEmbeddingProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  dimensions?: number;
  concurrency?: number;
}

interface OpenAIEmbeddingResponse {
  data: { embedding: number[] }[];
  usage?: { prompt_tokens: number; total_tokens: number };
}

export class ChutesEmbeddingProvider implements EmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number;
  private apiKey: string;
  private baseUrl: string;
  private concurrency: number;

  constructor(options: ChutesEmbeddingProviderOptions) {
    if (!options.apiKey) throw new Error('ChutesEmbeddingProvider requires an API key');
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://chutes-qwen-qwen3-embedding-8b-tee.chutes.ai').replace(/\/$/, '');
    this.modelId = options.model ?? 'Qwen/Qwen3-Embedding-8B-TEE';
    this.dimensions = options.dimensions ?? 4096;
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
      const body = JSON.stringify({
        input: text,
        model: this.modelId,
        encoding_format: 'float',
      });
      const res = await fetch(`${this.baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Chutes embeddings API error: ${res.status} ${res.statusText} ${errText}`);
      }

      const data = (await res.json()) as OpenAIEmbeddingResponse;
      if (!data.data || data.data.length === 0) {
        throw new Error('Chutes embeddings API returned no data');
      }
      return Float32Array.from(data.data[0].embedding);
    } finally {
      clearTimeout(timeout);
    }
  }
}
