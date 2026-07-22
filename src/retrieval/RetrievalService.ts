import { EmbeddingProvider, EvidencePack, SearchHit, SearchRequest, VectorStore } from '../types/retrieval';
import { EvidencePackBuilder } from './EvidencePackBuilder';
import { HybridRetriever } from './HybridRetriever';
import { SqlLexicalRetriever } from './LexicalRetriever';
import { Ranker } from './Ranker';
import { RetrievalDatabase } from './RetrievalDatabase';

export interface RetrievalServiceOptions {
  evidenceTokenBudget: number;
  defaultResultLimit: number;
  semanticThreshold?: number;
  /** When true, hybrid mode returns 0 hits if lexical search finds nothing. */
  lexicalVeto?: boolean;
}

export interface RetrievalServiceDeps {
  database: RetrievalDatabase;
  vectorStore?: VectorStore | null;
  embeddingProvider?: EmbeddingProvider | null;
}

export class RetrievalService {
  private lexicalRetriever: SqlLexicalRetriever;
  private hybridRetriever: HybridRetriever | null = null;
  private ranker = new Ranker();
  private evidenceBuilder = new EvidencePackBuilder();

  constructor(
    deps: RetrievalServiceDeps,
    private options: RetrievalServiceOptions
  ) {
    this.lexicalRetriever = new SqlLexicalRetriever(deps.database);
    if (deps.vectorStore && deps.embeddingProvider) {
      const hybridOpts: { semanticThreshold?: number; lexicalVeto?: boolean } = {};
      if (options.semanticThreshold !== undefined) {
        hybridOpts.semanticThreshold = options.semanticThreshold;
      }
      if (options.lexicalVeto !== undefined) {
        hybridOpts.lexicalVeto = options.lexicalVeto;
      }
      this.hybridRetriever = new HybridRetriever(deps.database, deps.vectorStore, deps.embeddingProvider, hybridOpts);
    }
  }

  updateOptions(options: Partial<RetrievalServiceOptions>): void {
    this.options = { ...this.options, ...options };
  }

  setHybridRetriever(database: RetrievalDatabase, vectorStore: VectorStore, embeddingProvider: EmbeddingProvider): void {
    this.hybridRetriever = new HybridRetriever(database, vectorStore, embeddingProvider);
  }

  clearHybridRetriever(): void {
    this.hybridRetriever = null;
  }

  isHybridAvailable(): boolean {
    return this.hybridRetriever !== null;
  }

  async search(request: SearchRequest): Promise<SearchHit[]> {
    const retriever = this.hybridRetriever ?? this.lexicalRetriever;
    const hits = await retriever.search({
      ...request,
      lexicalCandidateLimit: request.lexicalCandidateLimit ?? 50,
    });
    return this.ranker.select(hits, {
      limit: request.limit ?? this.options.defaultResultLimit,
    });
  }

  async buildEvidencePack(request: SearchRequest): Promise<EvidencePack> {
    const hits = await this.search(request);
    return this.evidenceBuilder.build(request.query, hits, {
      evidenceTokenBudget: this.options.evidenceTokenBudget,
    });
  }
}
