import { SearchHit, SearchRequest } from '../types/retrieval';
import { PlannedQuery, QueryPlanner } from './QueryPlanner';
import { RetrievalDatabase } from './RetrievalDatabase';

export interface LexicalRetriever {
  search(request: SearchRequest): Promise<SearchHit[]>;
}

export interface LexicalRetrieverOptions {
  minUsefulCandidates?: number;
}

const DEFAULT_MIN_USEFUL_CANDIDATES = 3;
const MIN_COVERAGE_FRACTION = 0.65;

export class SqlLexicalRetriever implements LexicalRetriever {
  constructor(private database: RetrievalDatabase, private options: LexicalRetrieverOptions = {}) {}

  async search(request: SearchRequest): Promise<SearchHit[]> {
    const planned = QueryPlanner.plan(request.query);
    return this.searchPlanned(planned, request);
  }

  searchPlanned(planned: PlannedQuery, request: SearchRequest): SearchHit[] {
    const minUseful = this.options.minUsefulCandidates ?? DEFAULT_MIN_USEFUL_CANDIDATES;

    const strictRequest = { ...request, query: planned.originalQuery };
    const strictHits = this.database.search(
      { ...planned, ftsQuery: planned.strictFtsQuery },
      strictRequest
    );

    const strictBoosted = this.applyBoosts(strictHits, planned, request, 'strict-and', false);

    if (strictBoosted.length >= minUseful || !planned.relaxedFtsQuery) {
      return strictBoosted;
    }

    const relaxedHits = this.database.search(
      { ...planned, ftsQuery: planned.relaxedFtsQuery! },
      strictRequest
    );

    const relaxedScored = this.scoreRelaxedHits(relaxedHits, planned, request);
    if (relaxedScored.length === 0) {
      return strictBoosted;
    }

    return relaxedScored;
  }

  private scoreRelaxedHits(
    hits: SearchHit[],
    planned: PlannedQuery,
    request: SearchRequest
  ): SearchHit[] {
    const meaningfulTerms = planned.meaningfulTerms;
    const requiredCount = planned.requiredTermCount;
    const exactTokensLower = planned.exactTokens.map((t) => t.toLowerCase());
    const quotedPhrasesLower = planned.quotedPhrases.map((p) => p.toLowerCase());

    const scored = hits
      .map((hit) => {
        const matchedTerms = this.computeMatchedTerms(hit, meaningfulTerms, exactTokensLower, quotedPhrasesLower);
        const matchedTermFraction = meaningfulTerms.length > 0
          ? matchedTerms.length / meaningfulTerms.length
          : 1;

        return {
          hit: this.applyBoosts([hit], planned, request, 'relaxed-lexical', true, matchedTerms, matchedTermFraction)[0],
          matchedTerms,
          matchedTermFraction,
        };
      })
      .filter((entry) => {
        if (meaningfulTerms.length === 0) return true;

        const hasExactMatch = entry.matchedTerms.length === 0 &&
          (exactTokensLower.length > 0 || quotedPhrasesLower.length > 0);

        if (hasExactMatch && requiredCount === 0) return true;

        if (entry.matchedTerms.length < requiredCount) return false;
        if (meaningfulTerms.length >= 3 && entry.matchedTermFraction < MIN_COVERAGE_FRACTION) return false;

        return true;
      })
      .sort((a, b) => {
        const aExact = exactTokensLower.length > 0 || quotedPhrasesLower.length > 0;
        const bExact = exactTokensLower.length > 0 || quotedPhrasesLower.length > 0;

        const aHasExactToken = a.matchedTerms.length === 0 && aExact;
        const bHasExactToken = b.matchedTerms.length === 0 && bExact;
        if (aHasExactToken && !bHasExactToken) return -1;
        if (!aHasExactToken && bHasExactToken) return 1;

        if (b.matchedTermFraction !== a.matchedTermFraction) {
          return b.matchedTermFraction - a.matchedTermFraction;
        }
        return a.hit.finalScore - b.hit.finalScore;
      });

    return scored.map((s) => s.hit);
  }

  private computeMatchedTerms(
    hit: SearchHit,
    meaningfulTerms: string[],
    exactTokensLower: string[],
    quotedPhrasesLower: string[]
  ): string[] {
    const normalizedText = hit.normalizedText;
    const basename = hit.basename.toLowerCase();
    const finalHeading = hit.headingPath[hit.headingPath.length - 1]?.toLowerCase() ?? '';
    const headingPath = hit.headingPath.join(' ').toLowerCase();

    const matched: string[] = [];
    const seen = new Set<string>();

    for (const term of meaningfulTerms) {
      if (normalizedText.includes(term) || basename.includes(term) || headingPath.includes(term) || finalHeading.includes(term)) {
        if (!seen.has(term)) {
          matched.push(term);
          seen.add(term);
        }
      }
    }

    for (const token of exactTokensLower) {
      if (normalizedText.includes(token) || basename.includes(token) || headingPath.includes(token)) {
        if (!seen.has(token)) {
          matched.push(token);
          seen.add(token);
        }
      }
    }

    for (const phrase of quotedPhrasesLower) {
      if (normalizedText.includes(phrase) || basename.includes(phrase) || headingPath.includes(phrase)) {
        if (!seen.has(phrase)) {
          matched.push(phrase);
          seen.add(phrase);
        }
      }
    }

    return matched;
  }

  private applyBoosts(
    hits: SearchHit[],
    planned: PlannedQuery,
    request: SearchRequest,
    mode: 'strict-and' | 'relaxed-lexical',
    fallbackUsed: boolean,
    matchedTerms?: string[],
    matchedTermFraction?: number
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

        const computedMatchedTerms = matchedTerms ?? this.computeMatchedTerms(
          hit,
          planned.meaningfulTerms,
          planned.exactTokens.map((t) => t.toLowerCase()),
          planned.quotedPhrases.map((p) => p.toLowerCase())
        );
        const computedFraction = matchedTermFraction ?? (planned.meaningfulTerms.length > 0
          ? computedMatchedTerms.length / planned.meaningfulTerms.length
          : 0);

        reasons.push(`mode:${mode}`);
        if (fallbackUsed) reasons.push('fallback');
        if (computedFraction > 0) reasons.push(`coverage:${computedFraction.toFixed(2)}`);

        if (mode === 'relaxed-lexical') {
          boost -= computedFraction * 3;
        }

        return {
          ...hit,
          finalScore: hit.lexicalScore + boost,
          matchReasons: reasons,
          retrievalMode: mode,
          fallbackUsed,
          matchedTerms: computedMatchedTerms,
          matchedTermFraction: computedFraction,
        };
      })
      .sort((a, b) => a.finalScore - b.finalScore || a.path.localeCompare(b.path));
  }
}
