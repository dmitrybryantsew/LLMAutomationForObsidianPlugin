import { EvidencePack, SearchHit, SearchRequest } from '../types/retrieval';
import { EvidencePackBuilder } from './EvidencePackBuilder';
import { SqlLexicalRetriever } from './LexicalRetriever';
import { Ranker } from './Ranker';
import { RetrievalDatabase } from './RetrievalDatabase';

export interface RetrievalServiceOptions {
  evidenceTokenBudget: number;
  defaultResultLimit: number;
}

export class RetrievalService {
  private retriever: SqlLexicalRetriever;
  private ranker = new Ranker();
  private evidenceBuilder = new EvidencePackBuilder();

  constructor(
    database: RetrievalDatabase,
    private options: RetrievalServiceOptions
  ) {
    this.retriever = new SqlLexicalRetriever(database);
  }

  updateOptions(options: Partial<RetrievalServiceOptions>): void {
    this.options = { ...this.options, ...options };
  }

  async search(request: SearchRequest): Promise<SearchHit[]> {
    const hits = await this.retriever.search({
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
