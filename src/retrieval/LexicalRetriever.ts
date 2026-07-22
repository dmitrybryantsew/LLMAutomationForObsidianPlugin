import { SearchHit, SearchRequest } from '../types/retrieval';
import { PlannedQuery, QueryPlanner } from './QueryPlanner';
import { RetrievalDatabase } from './RetrievalDatabase';

export interface LexicalRetriever {
  search(request: SearchRequest): Promise<SearchHit[]>;
}

export class SqlLexicalRetriever implements LexicalRetriever {
  constructor(private database: RetrievalDatabase) {}

  async search(request: SearchRequest): Promise<SearchHit[]> {
    const planned = QueryPlanner.plan(request.query);
    return this.searchPlanned(planned, request);
  }

  searchPlanned(planned: PlannedQuery, request: SearchRequest): SearchHit[] {
    const hits = this.database.search(planned, request);
    return this.applyBoosts(hits, planned, request);
  }

  private applyBoosts(hits: SearchHit[], planned: PlannedQuery, request: SearchRequest): SearchHit[] {
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

        return {
          ...hit,
          finalScore: hit.lexicalScore + boost,
          matchReasons: reasons,
        };
      })
      .sort((a, b) => a.finalScore - b.finalScore || a.path.localeCompare(b.path));
  }
}
