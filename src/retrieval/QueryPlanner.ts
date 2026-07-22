export interface PlannedQuery {
  originalQuery: string;
  normalizedQuery: string;
  quotedPhrases: string[];
  exactTokens: string[];
  ftsQuery: string;
}

const EXACT_TOKEN_PATTERN = /(?:`[^`]+`|"[^"]+"|'[^']+'|[A-Za-z_][\w.]*(?:\.[A-Za-z_][\w.]*)+|\/[^\s]+\/|[A-Z]{2,}\d+|CS\d{4}|error\s+\d+)/gi;
const PATH_LIKE_PATTERN = /(?:[A-Za-z]:\\[^\s]+|\/[^\s]+\/[^\s]+)/g;

export class QueryPlanner {
  static plan(query: string): PlannedQuery {
    const trimmed = query.trim();
    if (!trimmed) {
      throw new Error('Query cannot be empty');
    }

    let working = trimmed.normalize('NFKC').replace(/\s+/g, ' ');
    const quotedPhrases: string[] = [];
    const exactTokens: string[] = [];

    working = working.replace(/"([^"]+)"/g, (_match, phrase: string) => {
      quotedPhrases.push(phrase.trim());
      return ' ';
    });

    const exactMatches = working.match(EXACT_TOKEN_PATTERN) ?? [];
    for (const token of exactMatches) {
      const cleaned = token.replace(/^`|`$/g, '').trim();
      if (cleaned) {
        exactTokens.push(cleaned);
      }
    }

    const pathMatches = working.match(PATH_LIKE_PATTERN) ?? [];
    for (const token of pathMatches) {
      exactTokens.push(token.trim());
    }

    working = working
      .replace(EXACT_TOKEN_PATTERN, ' ')
      .replace(PATH_LIKE_PATTERN, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const terms = working
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean);

    const ftsParts = [
      ...quotedPhrases.map((phrase) => `"${escapeFtsToken(phrase.toLowerCase())}"`),
      ...exactTokens.map((token) => `"${escapeFtsToken(token.toLowerCase())}"`),
      ...terms.map((term) => `"${escapeFtsToken(term.toLowerCase())}"`),
    ].filter(Boolean);

    const ftsQuery = ftsParts.length > 0 ? ftsParts.join(' AND ') : `"${escapeFtsToken(trimmed.toLowerCase())}"`;

    return {
      originalQuery: trimmed,
      normalizedQuery: trimmed.toLowerCase(),
      quotedPhrases,
      exactTokens,
      ftsQuery,
    };
  }
}

function escapeFtsToken(token: string): string {
  return token.replace(/"/g, '""');
}
