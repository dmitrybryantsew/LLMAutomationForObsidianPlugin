import { SearchHit, SearchRequest, VectorHit, VectorStore, VectorSearchFilters } from '../types/retrieval';
import { PlannedQuery, QueryPlanner } from './QueryPlanner';
import { RetrievalDatabase } from './RetrievalDatabase';
import { EmbeddingProvider } from '../types/retrieval';
import { LexicalRetriever, SqlLexicalRetriever } from './LexicalRetriever';

const RRF_K = 60;
const CANDIDATE_LIMIT = 40;

export interface HybridRetrieverOptions {
  minUsefulCandidates?: number;
  semanticThreshold?: number;
  /** When true, if lexical search returns 0 hits, hybrid also returns 0 hits (semantic can't override lexical no-result). */
  lexicalVeto?: boolean;
}

const DEFAULT_SEMANTIC_THRESHOLD = 0.3;

export class HybridRetriever implements LexicalRetriever {
  private lexicalRetriever: SqlLexicalRetriever;

  constructor(
    private database: RetrievalDatabase,
    private vectorStore: VectorStore | null,
    private embeddingProvider: EmbeddingProvider | null,
    private options: HybridRetrieverOptions = {}
  ) {
    this.lexicalRetriever = new SqlLexicalRetriever(database, {
      minUsefulCandidates: options.minUsefulCandidates,
    });
  }

  async search(request: SearchRequest): Promise<SearchHit[]> {
    const planned = QueryPlanner.plan(request.query);
    const lexicalHits = this.lexicalRetriever.searchPlanned(planned, request);

    if (!this.vectorStore || !this.embeddingProvider) {
      return lexicalHits;
    }

    // Lexical veto: if lexical search found nothing, semantic can't override it.
    // This prevents false positives on queries about topics not in the vault.
    if (this.options.lexicalVeto && lexicalHits.length === 0) {
      return [];
    }

    const queryVector = await this.embeddingProvider.embed([planned.normalizedQuery]);
    if (!queryVector[0]) return lexicalHits;

    const vectorFilters: VectorSearchFilters = {
      sourceIds: request.sourceIds,
      folderPrefix: request.folderPrefix,
      tags: request.tags,
    };

    const semanticThreshold = this.options.semanticThreshold ?? DEFAULT_SEMANTIC_THRESHOLD;
    const vectorHits = await this.vectorStore.search(queryVector[0], vectorFilters, CANDIDATE_LIMIT);
    const filteredVectorHits = vectorHits.filter((h) => h.similarity >= semanticThreshold);

    if (filteredVectorHits.length === 0) {
      return lexicalHits;
    }

    const fused = this.fuseRrf(lexicalHits, filteredVectorHits, planned, request);
    return fused;
  }

  private fuseRrf(
    lexicalHits: SearchHit[],
    vectorHits: VectorHit[],
    planned: PlannedQuery,
    request: SearchRequest
  ): SearchHit[] {
    const scores = new Map<string, { hit: SearchHit; rrfScore: number; lexicalRank: number | null; vectorRank: number | null }>();

    for (let i = 0; i < lexicalHits.length; i++) {
      const hit = lexicalHits[i];
      const rrfScore = 1 / (RRF_K + i + 1);
      scores.set(hit.id, { hit, rrfScore, lexicalRank: i + 1, vectorRank: null });
    }

    for (let i = 0; i < vectorHits.length; i++) {
      const vhit = vectorHits[i];
      const rrfScore = 1 / (RRF_K + i + 1);
      const existing = scores.get(vhit.chunkId);
      if (existing) {
        existing.rrfScore += rrfScore;
        existing.vectorRank = i + 1;
      } else {
        const hit = this.vectorHitToSearchHit(vhit, planned, request);
        scores.set(vhit.chunkId, { hit, rrfScore, lexicalRank: null, vectorRank: i + 1 });
      }
    }

    return Array.from(scores.values())
      .map((entry) => {
        const reasons = [...entry.hit.matchReasons];
        if (entry.lexicalRank !== null) reasons.push(`lexical-rank:${entry.lexicalRank}`);
        if (entry.vectorRank !== null) reasons.push(`vector-rank:${entry.vectorRank}`);
        reasons.push('rrf');

        return {
          ...entry.hit,
          finalScore: -entry.rrfScore,
          matchReasons: reasons,
          retrievalMode: 'hybrid' as const,
        };
      })
      .sort((a, b) => a.finalScore - b.finalScore);
  }

  private vectorHitToSearchHit(vhit: VectorHit, planned: PlannedQuery, request: SearchRequest): SearchHit {
    return {
      id: vhit.chunkId,
      sourceId: vhit.sourceId,
      path: vhit.path,
      basename: vhit.basename,
      headingPath: vhit.headingPath,
      startLine: vhit.startLine,
      endLine: vhit.endLine,
      text: vhit.text,
      normalizedText: vhit.normalizedText,
      tags: vhit.tags,
      outboundLinks: [],
      contentHash: vhit.contentHash,
      modifiedTime: vhit.modifiedTime,
      lexicalScore: 0,
      finalScore: 0,
      matchReasons: [`semantic:${vhit.similarity.toFixed(3)}`],
      retrievalMode: 'hybrid',
      fallbackUsed: false,
      matchedTerms: [],
      matchedTermFraction: 0,
    };
  }
}
