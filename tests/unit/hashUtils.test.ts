import { describe, expect, it } from 'vitest';
import {
  buildChunkId,
  estimateTokens,
  fnv1aHash,
  normalizeRetrievalText,
  sha256Hex,
} from '../../src/retrieval/hashUtils';

describe('hashUtils', () => {
  describe('fnv1aHash', () => {
    it('returns an 8-char lowercase hex string', () => {
      const h = fnv1aHash('hello');
      expect(h).toMatch(/^[0-9a-f]{8}$/);
    });

    it('is deterministic for the same input', () => {
      expect(fnv1aHash('hello world')).toBe(fnv1aHash('hello world'));
    });

    it('differs for different inputs', () => {
      expect(fnv1aHash('hello')).not.toBe(fnv1aHash('world'));
    });

    it('returns a known FNV-1a-32 value for the empty string', () => {
      // FNV-1a 32-bit offset basis is 0x811c9dc5
      expect(fnv1aHash('')).toBe('811c9dc5');
    });

    it('returns the canonical FNV-1a value for "a"', () => {
      // 0xe40c292c = canonical FNV-1a("a")
      expect(fnv1aHash('a')).toBe('e40c292c');
    });

    it('produces a 32-bit unsigned result (no negative hex)', () => {
      // Some inputs cause signed-overflow; the >>> 0 must normalize to unsigned.
      const h = fnv1aHash('\u0000'.repeat(8));
      expect(parseInt(h, 16)).toBeGreaterThanOrEqual(0);
      expect(parseInt(h, 16)).toBeLessThanOrEqual(0xffffffff);
    });
  });

  describe('sha256Hex', () => {
    it('returns a 64-char hex string in Node where crypto.subtle is available', async () => {
      const h = await sha256Hex('hello');
      expect(h).toMatch(/^[0-9a-f]{64}$/);
      expect(h).toBe(
        '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
      );
    });

    it('is deterministic for the same input', async () => {
      expect(await sha256Hex('test')).toBe(await sha256Hex('test'));
    });

    it('differs for different inputs', async () => {
      expect(await sha256Hex('a')).not.toBe(await sha256Hex('b'));
    });
  });

  describe('normalizeRetrievalText', () => {
    it('lowercases the text', () => {
      expect(normalizeRetrievalText('Hello WORLD')).toBe('hello world');
    });

    it('collapses runs of spaces and tabs into a single space', () => {
      expect(normalizeRetrievalText('a   b\t\tc')).toBe('a b c');
    });

    it('normalizes CRLF and CR to LF first', () => {
      expect(normalizeRetrievalText('a\r\nb\rc')).toBe('a\nb\nc');
    });

    it('trims leading and trailing whitespace', () => {
      expect(normalizeRetrievalText('   hello   ')).toBe('hello');
    });

    it('applies NFKC normalization', () => {
      // Fullwidth Latin "Ａ" (U+FF21) -> NFKC -> "A"
      expect(normalizeRetrievalText('Ａ')).toBe('a');
    });
  });

  describe('buildChunkId', () => {
    it('is deterministic for identical inputs', () => {
      const a = buildChunkId({
        sourceId: 's1',
        path: 'p.md',
        headingPath: ['H1', 'H2'],
        ordinal: 0,
        contentHash: 'abcdef00',
      });
      const b = buildChunkId({
        sourceId: 's1',
        path: 'p.md',
        headingPath: ['H1', 'H2'],
        ordinal: 0,
        contentHash: 'abcdef00',
      });
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{8}$/);
    });

    it('differs when any component changes', () => {
      const base = {
        sourceId: 's1',
        path: 'p.md',
        headingPath: ['H1'],
        ordinal: 0,
        contentHash: 'abcdef00',
      };
      const id = buildChunkId(base);
      expect(buildChunkId({ ...base, sourceId: 's2' })).not.toBe(id);
      expect(buildChunkId({ ...base, path: 'q.md' })).not.toBe(id);
      expect(buildChunkId({ ...base, headingPath: ['H2'] })).not.toBe(id);
      expect(buildChunkId({ ...base, ordinal: 1 })).not.toBe(id);
      expect(buildChunkId({ ...base, contentHash: '11111111' })).not.toBe(id);
    });

    it('joins headingPath with >', () => {
      const withHeadings = buildChunkId({
        sourceId: 's',
        path: 'p',
        headingPath: ['A', 'B', 'C'],
        ordinal: 0,
        contentHash: 'h',
      });
      const flat = buildChunkId({
        sourceId: 's',
        path: 'p',
        headingPath: ['A>B>C'],
        ordinal: 0,
        contentHash: 'h',
      });
      // Same joined string -> same id
      expect(withHeadings).toBe(flat);
    });
  });

  describe('estimateTokens', () => {
    it('estimates ~4 chars per token', () => {
      expect(estimateTokens('abcdefgh')).toBe(2); // ceil(8/4)
    });

    it('rounds up for any non-zero length', () => {
      expect(estimateTokens('a')).toBe(1);
      expect(estimateTokens('abc')).toBe(1);
      expect(estimateTokens('abcde')).toBe(2);
    });

    it('returns 0 for the empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });
  });
});
