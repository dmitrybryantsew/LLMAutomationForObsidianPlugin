import { App } from 'obsidian';
import {
  EmbeddingProvider,
  RetrievalChunkDraft,
  VectorIndexStatus,
  VectorUpsertRow,
} from '../types/retrieval';
import { DebugLogger } from '../utils/DebugLogger';
import { RetrievalDatabase } from './RetrievalDatabase';
import { SqliteVectorStore } from './SqliteVectorStore';

const PREPROCESSING_VERSION = '1';

export interface EmbeddingCoordinatorOptions {
  batchSize: number;
}

const DEFAULT_BATCH_SIZE = 32;

export class EmbeddingCoordinator {
  private vectorStore: SqliteVectorStore;
  private provider: EmbeddingProvider | null = null;
  private abortController: AbortController | null = null;
  private buildProgress: number = 0;
  private buildTotal: number = 0;
  private buildError: string | null = null;

  constructor(
    private app: App,
    private database: RetrievalDatabase,
    private logger: DebugLogger,
    private options: EmbeddingCoordinatorOptions = { batchSize: DEFAULT_BATCH_SIZE }
  ) {
    this.vectorStore = new SqliteVectorStore(database);
  }

  setProvider(provider: EmbeddingProvider | null): void {
    this.provider = provider;
  }

  getVectorStore(): SqliteVectorStore {
    return this.vectorStore;
  }

  async initialize(): Promise<void> {
    await this.vectorStore.initialize();
  }

  isReady(): boolean {
    return this.provider !== null;
  }

  async buildIndex(chunks: RetrievalChunkDraft[], signal?: AbortSignal): Promise<{
    embedded: number;
    skipped: number;
    cancelled: boolean;
  }> {
    if (!this.provider) {
      throw new Error('No embedding provider configured');
    }

    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) {
        this.abortController.abort();
      } else {
        signal.addEventListener('abort', () => this.abortController?.abort());
      }
    }

    const modelId = this.provider.modelId;
    this.buildProgress = 0;
    this.buildTotal = chunks.length;
    this.buildError = null;

    let embedded = 0;
    let skipped = 0;
    let cancelled = false;

    try {
      const batchSize = this.options.batchSize;
      for (let i = 0; i < chunks.length; i += batchSize) {
        if (this.abortController.signal.aborted) {
          cancelled = true;
          break;
        }

        const batch = chunks.slice(i, i + batchSize);
        const existingVectors = new Map<string, string>();
        for (const chunk of batch) {
          const existing = this.vectorStore.getVectorsForChunk(chunk.id);
          for (const v of existing) {
            if (v.modelId === modelId && v.chunkHash === chunk.contentHash) {
              existingVectors.set(chunk.id, v.chunkHash);
            }
          }
        }

        const toEmbed = batch.filter((c) => !existingVectors.has(c.id));
        const toSkip = batch.length - toEmbed.length;
        skipped += toSkip;

        if (toEmbed.length === 0) {
          this.buildProgress += batch.length;
          continue;
        }

        const texts = toEmbed.map((c) => this.preprocess(c));
        const vectors = await this.provider.embed(texts, this.abortController.signal);

        if (vectors.length !== toEmbed.length) {
          throw new Error(
            `Embedding provider returned ${vectors.length} vectors for ${toEmbed.length} texts`
          );
        }

        const rows: VectorUpsertRow[] = toEmbed.map((chunk, idx) => ({
          chunkId: chunk.id,
          chunkHash: chunk.contentHash,
          modelId,
          preprocessingVersion: PREPROCESSING_VERSION,
          vector: vectors[idx],
        }));

        await this.vectorStore.upsert(rows);
        embedded += toEmbed.length;
        this.buildProgress += batch.length;
      }
    } catch (error) {
      this.buildError = error instanceof Error ? error.message : String(error);
      this.logger.logError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      this.abortController = null;
    }

    return { embedded, skipped, cancelled };
  }

  cancelBuild(): void {
    this.abortController?.abort();
  }

  async removeStaleVectors(chunkIds: string[]): Promise<void> {
    await this.vectorStore.removeChunkIds(chunkIds);
  }

  async invalidateModel(modelId: string): Promise<number> {
    return this.vectorStore.removeByModel(modelId);
  }

  async getStatus(): Promise<VectorIndexStatus> {
    const baseStatus = await this.vectorStore.getStatus();

    if (this.buildTotal > 0 && this.buildProgress < this.buildTotal) {
      return {
        ...baseStatus,
        state: 'building',
        buildProgress: this.buildProgress,
        buildTotal: this.buildTotal,
        lastError: this.buildError,
      };
    }

    if (this.buildError) {
      return {
        ...baseStatus,
        state: 'error',
        lastError: this.buildError,
      };
    }

    return baseStatus;
  }

  private preprocess(chunk: RetrievalChunkDraft): string {
    const heading = chunk.headingPath.join(' ');
    return `${heading}\n\n${chunk.normalizedText}`.trim();
  }
}
