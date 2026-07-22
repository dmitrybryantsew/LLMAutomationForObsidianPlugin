export interface PlannedQuery {
  originalQuery: string;
  normalizedQuery: string;
  quotedPhrases: string[];
  exactTokens: string[];
  ftsQuery: string;
  strictFtsQuery: string;
  relaxedFtsQuery: string | null;
  meaningfulTerms: string[];
  requiredTermCount: number;
}

const EXACT_TOKEN_PATTERN = /(?:`[^`]+`|"[^"]+"|'[^']+'|[A-Za-z_][\w.]*(?:\.[A-Za-z_][\w.]*)+|\/[^\s]+\/|[A-Z]{2,}\d+|CS\d{4}|error\s+\d+)/gi;
const PATH_LIKE_PATTERN = /(?:[A-Za-z]:\\[^\s]+|\/[^\s]+\/[^\s]+)/g;

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'how', 'does', 'do', 'did', 'what', 'who', 'whom', 'whose', 'which',
  'for', 'to', 'of', 'with', 'and', 'or', 'but', 'not', 'so', 'yet',
  'in', 'on', 'at', 'by', 'from', 'as', 'into', 'about', 'than',
  'that', 'this', 'these', 'those', 'it', 'its', 'they', 'them',
  'their', 'there', 'here', 'has', 'have', 'had', 'can', 'could',
  'should', 'would', 'will', 'just', 'also', 'very', 'too',
  'using', 'use', 'via', 'your', 'you', 'we', 'our', 'my', 'me',
  'like', 'get', 'got', 'make', 'made', 'some', 'any', 'all',
  'if', 'then', 'else', 'when', 'where', 'why',
]);

const MAX_MEANINGFUL_TERMS = 12;

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

    const meaningfulTerms = extractMeaningfulTerms(terms);

    const relaxedFtsQuery = buildRelaxedQuery(quotedPhrases, exactTokens, meaningfulTerms);

    const requiredTermCount = computeRequiredTermCount(meaningfulTerms, exactTokens, quotedPhrases);

    return {
      originalQuery: trimmed,
      normalizedQuery: trimmed.toLowerCase(),
      quotedPhrases,
      exactTokens,
      ftsQuery,
      strictFtsQuery: ftsQuery,
      relaxedFtsQuery,
      meaningfulTerms,
      requiredTermCount,
    };
  }
}

function extractMeaningfulTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of terms) {
    const lower = term.toLowerCase();
    if (STOP_WORDS.has(lower)) continue;
    if (lower.length < 2 && !/[a-z0-9]/i.test(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(lower);
  }
  if (out.length > MAX_MEANINGFUL_TERMS) {
    return out.slice(0, MAX_MEANINGFUL_TERMS);
  }
  return out;
}

function buildRelaxedQuery(
  quotedPhrases: string[],
  exactTokens: string[],
  meaningfulTerms: string[]
): string | null {
  const requiredParts: string[] = [
    ...quotedPhrases.map((phrase) => `"${escapeFtsToken(phrase.toLowerCase())}"`),
    ...exactTokens.map((token) => `"${escapeFtsToken(token.toLowerCase())}"`),
  ];

  const orParts = meaningfulTerms.map((term) => `"${escapeFtsToken(term)}"`);

  const allParts: string[] = [];
  if (requiredParts.length > 0) {
    allParts.push(...requiredParts);
  }
  if (orParts.length > 0) {
    if (orParts.length === 1) {
      allParts.push(orParts[0]);
    } else {
      allParts.push(`(${orParts.join(' OR ')})`);
    }
  }

  if (allParts.length === 0) return null;
  return allParts.join(' AND ');
}

function computeRequiredTermCount(
  meaningfulTerms: string[],
  exactTokens: string[],
  quotedPhrases: string[]
): number {
  const hasExact = exactTokens.length > 0 || quotedPhrases.length > 0;
  const termCount = meaningfulTerms.length;

  if (termCount === 0 && hasExact) return 0;
  if (termCount <= 1) return termCount;
  if (termCount === 2) return 1;
  return 2;
}

function escapeFtsToken(token: string): string {
  return token.replace(/"/g, '""');
}
