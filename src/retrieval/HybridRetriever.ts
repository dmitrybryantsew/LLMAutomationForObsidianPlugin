import { SearchHit, SearchRequest, VectorHit, VectorStore, VectorSearchFilters } from '../types/retrieval';
import { PlannedQuery, QueryPlanner } from './QueryPlanner';
import { RetrievalDatabase } from './RetrievalDatabase';
import { EmbeddingProvider } from '../types/retrieval';
import { LexicalRetriever } from './LexicalRetriever';

const RRF_K = 60;
const CANDIDATE_LIMIT = 40;

export interface HybridRetrieverOptions {
  minUsefulCandidates?: number;
  semanticThreshold?: number;
}

const DEFAULT_SEMANTIC_THRESHOLD = 0.3;

export class HybridRetriever implements LexicalRetriever {
  constructor(
    private database: RetrievalDatabase,
    private vectorStore: VectorStore | null,
    private embeddingProvider: EmbeddingProvider | null,
    private options: HybridRetrieverOptions = {}
  ) {}

  async search(request: SearchRequest): Promise<SearchHit[]> {
    const planned = QueryPlanner.plan(request.query);
    const lexicalHits = this.searchLexical(planned, request);

    if (!this.vectorStore || !this.embeddingProvider) {
      return lexicalHits;
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

  private searchLexical(planned: PlannedQuery, request: SearchRequest): SearchHit[] {
    const strictRequest = { ...request, query: planned.originalQuery };
    const strictHits = this.database.search(
      { ...planned, ftsQuery: planned.strictFtsQuery },
      strictRequest
    );

    if (strictHits.length >= (this.options.minUsefulCandidates ?? 3) || !planned.relaxedFtsQuery) {
      return this.boostHits(strictHits, planned, request, 'strict-and', false);
    }

    const relaxedHits = this.database.search(
      { ...planned, ftsQuery: planned.relaxedFtsQuery },
      strictRequest
    );

    if (relaxedHits.length === 0) return this.boostHits(strictHits, planned, request, 'strict-and', false);

    return this.boostHits(relaxedHits, planned, request, 'relaxed-lexical', true);
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

  private boostHits(
    hits: SearchHit[],
    planned: PlannedQuery,
    request: SearchRequest,
    mode: 'strict-and' | 'relaxed-lexical',
    fallbackUsed: boolean
  ): SearchHit[] {
    const perPathCounts = new Map<string, number>();
    return hits
      .map((hit) => {
        let boost = 0;
        const reasons = [...hit.matchReasons];
        const finalHeading = hit.headingPath[hit.headingPath.length - 1]?.toLowerCase() ?? '';
        const normalizedBasename = hit.basename.toLowerCase();
        const normalizedQuery = planned.normalizedQuery;

        if (normalizedQuery === normalizedBasename || normalizedQuery === finalHeading) {
          boost -= 8;
          reasons.push('title-exact');
        }

        for (const token of planned.exactTokens) {
          const tokenLower = token.toLowerCase();
          if (
            hit.normalizedText.includes(tokenLower) ||
            hit.basename.toLowerCase().includes(tokenLower) ||
            finalHeading.includes(tokenLower)
          ) {
            boost -= 5;
            reasons.push(`exact:${token}`);
          }
        }

        if (request.includeCurrentNotePath && hit.path === request.includeCurrentNotePath) {
          boost -= 2;
          reasons.push('current-note');
        }

        const pathCount = perPathCounts.get(hit.path) ?? 0;
        perPathCounts.set(hit.path, pathCount + 1);
        if (pathCount >= 1) {
          boost += 2 * pathCount;
          reasons.push('duplicate-path-penalty');
        }

        reasons.push(`mode:${mode}`);

        return {
          ...hit,
          finalScore: hit.lexicalScore + boost,
          matchReasons: reasons,
          retrievalMode: mode,
          fallbackUsed,
        };
      })
      .sort((a, b) => a.finalScore - b.finalScore || a.path.localeCompare(b.path));
  }
}
