import { EmbeddingProvider } from '../types/retrieval';

const DEFAULT_CONCURRENCY = 2;
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2_000;

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
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

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

        if (res.status === 429 || res.status >= 500) {
          const errText = await res.text().catch(() => '');
          lastError = new Error(`Chutes API ${res.status}: ${errText}`);
          if (attempt < MAX_RETRIES) {
            const delay = RETRY_BASE_MS * Math.pow(2, attempt);
            console.log(`Chutes rate limited (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms...`);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
        }

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`Chutes embeddings API error: ${res.status} ${res.statusText} ${errText}`);
        }

        const data = (await res.json()) as OpenAIEmbeddingResponse;
        if (!data.data || data.data.length === 0) {
          throw new Error('Chutes embeddings API returned no data');
        }
        return Float32Array.from(data.data[0].embedding);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_MS * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError ?? new Error('Chutes embeddings failed after retries');
  }
}
