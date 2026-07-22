import { describe, expect, it } from 'vitest';
import { QueryPlanner } from '../../src/retrieval/QueryPlanner';

describe('QueryPlanner', () => {
  describe('empty / invalid input', () => {
    it('throws on an empty string', () => {
      expect(() => QueryPlanner.plan('')).toThrow();
    });

    it('throws on a whitespace-only string', () => {
      expect(() => QueryPlanner.plan('   ')).toThrow();
      expect(() => QueryPlanner.plan('\t\n')).toThrow();
    });
  });

  describe('quoted phrases', () => {
    it('extracts double-quoted phrases into quotedPhrases', () => {
      const p = QueryPlanner.plan('how do I use "spaced repetition" in notes');
      expect(p.quotedPhrases).toContain('spaced repetition');
    });

    it('removes the quoted phrase from the working string so it does not double-count as terms', () => {
      const p = QueryPlanner.plan('use "spaced repetition" now');
      // The phrase is captured once in quotedPhrases; the surrounding words
      // become plain terms.
      const fts = p.ftsQuery;
      // The phrase appears exactly once in the FTS query (as a quoted token).
      const matches = fts.match(/"spaced repetition"/g) ?? [];
      expect(matches.length).toBe(1);
    });

    it('handles multiple quoted phrases', () => {
      const p = QueryPlanner.plan('"open router" provider "api key"');
      expect(p.quotedPhrases).toEqual(expect.arrayContaining(['open router', 'api key']));
    });
  });

  describe('exact tokens', () => {
    it('extracts backtick-quoted tokens as exact tokens', () => {
      const p = QueryPlanner.plan('call `myFunction` from utils');
      expect(p.exactTokens).toContain('myFunction');
    });

    it('extracts dotted identifiers (e.g., module.symbol) as exact tokens', () => {
      const p = QueryPlanner.plan('use app.vault.read in the plugin');
      expect(p.exactTokens).toContain('app.vault.read');
    });

    it('extracts paths with forward slashes as exact tokens', () => {
      const p = QueryPlanner.plan('see /src/main.ts for the entry');
      expect(p.exactTokens.some((t) => t.includes('/src/main.ts'))).toBe(true);
    });

    it('extracts Windows-style paths as exact tokens', () => {
      const p = QueryPlanner.plan('open C:\\Users\\me\\notes.md');
      expect(p.exactTokens.some((t) => t.includes('C:\\Users\\me'))).toBe(true);
    });

    it('extracts uppercase acronyms WITH trailing digits (e.g., API404) as exact tokens', () => {
      const p = QueryPlanner.plan('configure the LLM404 client');
      expect(p.exactTokens).toContain('LLM404');
    });

    it('treats bare uppercase acronyms (no digits) as plain terms, not exact tokens', () => {
      const p = QueryPlanner.plan('configure the LLM client with API key');
      expect(p.exactTokens).not.toContain('LLM');
      expect(p.exactTokens).not.toContain('API');
      // They still appear in the FTS query as plain quoted terms (lowercased to match the FTS5 index).
      expect(p.ftsQuery).toContain('"llm"');
      expect(p.ftsQuery).toContain('"api"');
    });

    it('extracts CS#### course codes', () => {
      const p = QueryPlanner.plan('I took CS1010 last year');
      expect(p.exactTokens).toContain('CS1010');
    });

    it('extracts "error <number>" patterns', () => {
      const p = QueryPlanner.plan('the build failed with error 404 and error 500');
      expect(p.exactTokens).toContain('error 404');
      expect(p.exactTokens).toContain('error 500');
    });

    it('removes extracted exact tokens from the plain terms', () => {
      const p = QueryPlanner.plan('use `myFunction` carefully');
      // "use" and "carefully" become plain terms; "myFunction" is exact only.
      expect(p.exactTokens).toContain('myFunction');
      // The FTS query should contain "myFunction" exactly once (lowercased).
      const matches = p.ftsQuery.match(/"myfunction"/g) ?? [];
      expect(matches.length).toBe(1);
    });
  });

  describe('plain terms', () => {
    it('collects remaining words as plain FTS terms', () => {
      const p = QueryPlanner.plan('how to embed notes');
      const fts = p.ftsQuery;
      expect(fts).toContain('"how"');
      expect(fts).toContain('"to"');
      expect(fts).toContain('"embed"');
      expect(fts).toContain('"notes"');
    });

    it('joins all parts with AND', () => {
      const p = QueryPlanner.plan('how to embed notes');
      expect(p.ftsQuery).toMatch(/ AND /);
    });
  });

  describe('FTS escaping', () => {
    it('doubles double-quotes inside backtick exact tokens (FTS5 phrase escaping)', () => {
      // A backtick token containing a literal " gets escaped by doubling.
      const p = QueryPlanner.plan('use `foo"bar` function');
      expect(p.exactTokens).toContain('foo"bar');
      // The FTS query must escape the " by doubling it.
      expect(p.ftsQuery).toContain('"foo""bar"');
    });

    it('does not include literal quotes in dotted identifiers (\\w excludes ")', () => {
      // The dotted-identifier regex uses \w which excludes ", so a quote
      // terminates the match. The token captured is the part before the quote.
      const p = QueryPlanner.plan('call app.foo"bar.baz');
      expect(p.exactTokens).toContain('app.foo');
      // No exact token contains a literal quote in this case.
      expect(p.exactTokens.some((t) => t.includes('"'))).toBe(false);
    });
  });

  describe('normalization', () => {
    it('applies NFKC normalization to the FTS pipeline (not to originalQuery/normalizedQuery)', () => {
      const p = QueryPlanner.plan('ＡＩＣｏｄｙ'); // fullwidth
      // originalQuery preserves the input; normalizedQuery is lowercased only.
      expect(p.originalQuery).toBe('ＡＩＣｏｄｙ');
      expect(p.normalizedQuery).toBe('ａｉｃｏｄｙ');
      // FTS query uses NFKC-normalized text -> ASCII, lowercased for FTS5.
      expect(p.ftsQuery).toContain('"aicody"');
    });

    it('preserves original whitespace in originalQuery (only FTS terms are collapsed)', () => {
      const p = QueryPlanner.plan('foo    bar\t\tbaz');
      expect(p.originalQuery).toBe('foo    bar\t\tbaz');
      // FTS terms are derived from the collapsed working string.
      const fts = p.ftsQuery;
      expect(fts).toContain('"foo"');
      expect(fts).toContain('"bar"');
      expect(fts).toContain('"baz"');
    });

    it('lowercases normalizedQuery but preserves originalQuery case', () => {
      const p = QueryPlanner.plan('How To Use LLM');
      expect(p.originalQuery).toBe('How To Use LLM');
      expect(p.normalizedQuery).toBe('how to use llm');
    });
  });

  describe('FTS query structure', () => {
    it('places quoted phrases first, then exact tokens, then plain terms', () => {
      const p = QueryPlanner.plan('how "spaced repetition" `app.vault` works');
      const parts = p.ftsQuery.split(' AND ');
      // First part is the quoted phrase.
      expect(parts[0]).toBe('"spaced repetition"');
      // app.vault appears somewhere as an exact token.
      expect(parts.some((x) => x === '"app.vault"')).toBe(true);
      // plain terms appear too.
      expect(parts.some((x) => x === '"how"')).toBe(true);
      expect(parts.some((x) => x === '"works"')).toBe(true);
    });

    it('falls back to the whole trimmed query as a single quoted token when no parts are extracted', () => {
      // A single word with no special syntax.
      const p = QueryPlanner.plan('hello');
      expect(p.ftsQuery).toBe('"hello"');
    });
  });

  describe('P2: meaningful terms and stop-word removal', () => {
    it('removes stop words from meaningfulTerms', () => {
      const p = QueryPlanner.plan('how does the model learn from data');
      expect(p.meaningfulTerms).not.toContain('how');
      expect(p.meaningfulTerms).not.toContain('does');
      expect(p.meaningfulTerms).not.toContain('the');
      expect(p.meaningfulTerms).not.toContain('from');
      expect(p.meaningfulTerms).toContain('model');
      expect(p.meaningfulTerms).toContain('learn');
      expect(p.meaningfulTerms).toContain('data');
    });

    it('keeps all terms in strictFtsQuery (stop words are NOT removed from strict)', () => {
      const p = QueryPlanner.plan('how does the model learn');
      expect(p.strictFtsQuery).toContain('"how"');
      expect(p.strictFtsQuery).toContain('"does"');
      expect(p.strictFtsQuery).toContain('"the"');
    });

    it('deduplicates meaningful terms', () => {
      const p = QueryPlanner.plan('model model data data');
      expect(p.meaningfulTerms).toEqual(['model', 'data']);
    });

    it('preserves exact tokens in meaningfulTerms context (they are always required)', () => {
      const p = QueryPlanner.plan('how does `HttpClient.GetAsync` work with cancellation');
      expect(p.exactTokens).toContain('HttpClient.GetAsync');
      // "how", "does", "with" are stop words and removed from meaningfulTerms
      expect(p.meaningfulTerms).not.toContain('how');
      expect(p.meaningfulTerms).not.toContain('does');
      expect(p.meaningfulTerms).not.toContain('with');
      expect(p.meaningfulTerms).toContain('work');
      expect(p.meaningfulTerms).toContain('cancellation');
    });

    it('caps meaningfulTerms at MAX_MEANINGFUL_TERMS (12)', () => {
      const words = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango';
      const p = QueryPlanner.plan(words);
      expect(p.meaningfulTerms.length).toBeLessThanOrEqual(12);
    });
  });

  describe('P2: relaxed FTS query', () => {
    it('builds relaxed query with OR for meaningful terms', () => {
      const p = QueryPlanner.plan('free local alternative to Cursor using VS Code extensions');
      expect(p.relaxedFtsQuery).not.toBeNull();
      // Relaxed query should contain OR
      expect(p.relaxedFtsQuery!).toMatch(/ OR /);
      // Should contain the meaningful terms
      expect(p.relaxedFtsQuery!).toContain('"free"');
      expect(p.relaxedFtsQuery!).toContain('"local"');
      expect(p.relaxedFtsQuery!).toContain('"alternative"');
      expect(p.relaxedFtsQuery!).toContain('"cursor"');
      // Should NOT contain stop words
      expect(p.relaxedFtsQuery!).not.toContain('"to"');
      expect(p.relaxedFtsQuery!).not.toContain('"using"');
    });

    it('requires exact tokens in relaxed query with AND', () => {
      const p = QueryPlanner.plan('"HttpClient.GetAsync" cancellation behavior');
      expect(p.relaxedFtsQuery!).toContain('"httpclient.getasync"');
      expect(p.relaxedFtsQuery!).toMatch(/ AND /);
      // The exact token is required (AND'd), the meaningful terms are OR'd
      expect(p.relaxedFtsQuery!).toContain('"cancellation"');
      expect(p.relaxedFtsQuery!).toContain('"behavior"');
    });

    it('returns null relaxed query when no meaningful terms and no exact tokens', () => {
      const p = QueryPlanner.plan('the and is for to');
      // All stop words, no meaningful terms
      expect(p.meaningfulTerms).toEqual([]);
      // ftsQuery still has the stop words (strict), but relaxed is null
      // Actually, the strict query will have them. Let's check relaxed:
      expect(p.relaxedFtsQuery).toBeNull();
    });

    it('uses single term without OR parens when only one meaningful term', () => {
      const p = QueryPlanner.plan('the model');
      expect(p.meaningfulTerms).toEqual(['model']);
      expect(p.relaxedFtsQuery).toBe('"model"');
    });

    it('preserves quoted phrases as required in relaxed query', () => {
      const p = QueryPlanner.plan('"spaced repetition" for studying notes');
      expect(p.relaxedFtsQuery!).toContain('"spaced repetition"');
      expect(p.relaxedFtsQuery!).toContain('"studying"');
      expect(p.relaxedFtsQuery!).toContain('"notes"');
      expect(p.relaxedFtsQuery!).not.toContain('"for"');
    });
  });

  describe('P2: required term count', () => {
    it('returns 0 for exact-only queries', () => {
      const p = QueryPlanner.plan('`HttpClient.GetAsync`');
      expect(p.requiredTermCount).toBe(0);
    });

    it('returns 1 for single-term queries', () => {
      const p = QueryPlanner.plan('model');
      expect(p.requiredTermCount).toBe(1);
    });

    it('returns 1 for two-term queries', () => {
      const p = QueryPlanner.plan('model data');
      expect(p.requiredTermCount).toBe(1);
    });

    it('returns 2 for three+ term queries', () => {
      const p = QueryPlanner.plan('model data training learning');
      expect(p.requiredTermCount).toBe(2);
    });
  });
});
