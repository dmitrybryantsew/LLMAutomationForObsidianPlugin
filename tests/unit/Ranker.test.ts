import { describe, expect, it } from 'vitest';
import { Ranker } from '../../src/retrieval/Ranker';
import { SearchHit } from '../../src/types/retrieval';

function hit(path: string, heading: string, score: number): SearchHit {
  return {
    id: `${path}/${heading}`,
    sourceId: 's',
    path,
    basename: path.split('/').pop() ?? path,
    headingPath: heading.split('>'),
    startLine: 1,
    endLine: 1,
    text: '',
    normalizedText: '',
    tags: [],
    outboundLinks: [],
    contentHash: 'h',
    modifiedTime: 0,
    lexicalScore: score,
    finalScore: score,
    matchReasons: [],
    retrievalMode: 'strict-and',
    fallbackUsed: false,
    matchedTerms: [],
    matchedTermFraction: 0,
  };
}

describe('Ranker', () => {
  it('returns hits unchanged when under all caps', () => {
    const r = new Ranker();
    const hits = [hit('a.md', 'H1', 1), hit('b.md', 'H1', 2), hit('c.md', 'H1', 3)];
    const out = r.select(hits);
    expect(out).toEqual(hits);
  });

  it('preserves input order (stable, no re-sort)', () => {
    const r = new Ranker();
    const hits = [
      hit('a.md', 'H1', 5),
      hit('b.md', 'H1', 1),
      hit('c.md', 'H1', 3),
    ];
    const out = r.select(hits);
    expect(out.map((h) => h.path)).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('caps chunks per file at default 2', () => {
    const r = new Ranker();
    const hits = [
      hit('a.md', 'H1', 1),
      hit('a.md', 'H2', 2),
      hit('a.md', 'H3', 3),
      hit('b.md', 'H1', 4),
    ];
    const out = r.select(hits);
    expect(out.map((h) => h.headingPath[0])).toEqual(['H1', 'H2', 'H1']);
    expect(out.filter((h) => h.path === 'a.md')).toHaveLength(2);
  });

  it('caps chunks per heading at default 1', () => {
    const r = new Ranker();
    const hits = [
      hit('a.md', 'H1', 1),
      hit('a.md', 'H1', 2), // same path+heading, second hit
      hit('a.md', 'H2', 3),
    ];
    const out = r.select(hits);
    // First H1 consumed, second H1 skipped (heading cap), H2 fills the file slot.
    expect(out.map((h) => h.headingPath[0])).toEqual(['H1', 'H2']);
  });

  it('respects a custom limit', () => {
    const r = new Ranker();
    const hits = Array.from({ length: 10 }, (_, i) => hit(`f${i}.md`, 'H', i));
    const out = r.select(hits, { limit: 3 });
    expect(out).toHaveLength(3);
    expect(out.map((h) => h.path)).toEqual(['f0.md', 'f1.md', 'f2.md']);
  });

  it('respects custom maxChunksPerFile', () => {
    const r = new Ranker();
    const hits = [
      hit('a.md', 'H1', 1),
      hit('a.md', 'H2', 2),
      hit('a.md', 'H3', 3),
      hit('a.md', 'H4', 4),
    ];
    const out = r.select(hits, { maxChunksPerFile: 3 });
    expect(out).toHaveLength(3);
    expect(out.map((h) => h.headingPath[0])).toEqual(['H1', 'H2', 'H3']);
  });

  it('respects custom maxChunksPerHeading', () => {
    const r = new Ranker();
    const hits = [
      hit('a.md', 'H1', 1),
      hit('a.md', 'H1', 2),
      hit('b.md', 'H1', 3),
    ];
    const out = r.select(hits, { maxChunksPerHeading: 2 });
    // a.md/H1 (slot 1), a.md/H1 (slot 2 - heading cap allows 2 but file cap is 2 so this is slot 2),
    // b.md/H1
    expect(out).toHaveLength(3);
  });

  it('returns empty array for empty input', () => {
    expect(new Ranker().select([])).toEqual([]);
  });

  it('stops as soon as the limit is reached even if more files remain', () => {
    const r = new Ranker();
    const hits = [
      hit('a.md', 'H1', 1),
      hit('b.md', 'H1', 2),
      hit('c.md', 'H1', 3),
      hit('d.md', 'H1', 4),
    ];
    const out = r.select(hits, { limit: 2 });
    expect(out.map((h) => h.path)).toEqual(['a.md', 'b.md']);
  });

  it('treats heading key as path+heading combination (same heading in different files is independent)', () => {
    const r = new Ranker();
    const hits = [
      hit('a.md', 'Shared', 1),
      hit('b.md', 'Shared', 2),
      hit('c.md', 'Shared', 3),
    ];
    const out = r.select(hits);
    expect(out).toHaveLength(3); // each file has its own heading bucket
  });
});
