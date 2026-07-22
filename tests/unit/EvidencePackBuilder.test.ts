import { describe, expect, it } from 'vitest';
import {
  EvidencePackBuilder,
  formatEvidenceForModel,
  formatEvidenceFileContextName,
  GROUNDED_ANSWER_INSTRUCTION,
} from '../../src/retrieval/EvidencePackBuilder';
import { SearchHit } from '../../src/types/retrieval';

function hit(
  path: string,
  text: string,
  headingPath: string[] = ['H'],
  basename = 'note'
): SearchHit {
  return {
    id: `id-${path}`,
    sourceId: 's',
    path,
    basename,
    headingPath,
    startLine: 1,
    endLine: 10,
    text,
    normalizedText: text.toLowerCase(),
    tags: [],
    outboundLinks: [],
    contentHash: 'h',
    modifiedTime: 0,
    lexicalScore: 1,
    finalScore: 1,
    matchReasons: [],
    retrievalMode: 'strict-and',
    fallbackUsed: false,
    matchedTerms: [],
    matchedTermFraction: 0,
  };
}

describe('EvidencePackBuilder', () => {
  describe('citation IDs', () => {
    it('assigns stable sequential citation IDs S1, S2, ... in input order', () => {
      const builder = new EvidencePackBuilder();
      const pack = builder.build('q', [hit('a.md', 'aa'), hit('b.md', 'bb'), hit('c.md', 'cc')], {
        evidenceTokenBudget: 10000,
      });
      expect(pack.items.map((i) => i.citationId)).toEqual(['S1', 'S2', 'S3']);
    });

    it('citation IDs are stable for identical input order', () => {
      const builder = new EvidencePackBuilder();
      const hits = [hit('a.md', 'aa'), hit('b.md', 'bb')];
      const p1 = builder.build('q', hits, { evidenceTokenBudget: 10000 });
      const p2 = builder.build('q', hits, { evidenceTokenBudget: 10000 });
      expect(p1.items.map((i) => i.citationId)).toEqual(p2.items.map((i) => i.citationId));
    });
  });

  describe('token budget', () => {
    it('admits all hits when total estimate fits the budget', () => {
      const builder = new EvidencePackBuilder();
      const pack = builder.build('q', [hit('a.md', 'a'.repeat(40)), hit('b.md', 'b'.repeat(40))], {
        evidenceTokenBudget: 1000,
      });
      expect(pack.items).toHaveLength(2);
      expect(pack.omittedHitCount).toBe(0);
      expect(pack.totalEstimatedTokens).toBeGreaterThan(0);
    });

    it('reserves instructionReserveRatio (default 0.18) of the budget', () => {
      const builder = new EvidencePackBuilder();
      // 100 tokens budget, 18% reserved -> 82 usable. 40-char hit = 10 tokens.
      const pack = builder.build('q', [hit('a.md', 'a'.repeat(40))], {
        evidenceTokenBudget: 100,
      });
      expect(pack.items).toHaveLength(1);
      expect(pack.totalEstimatedTokens).toBe(10);
    });

    it('drops a hit that alone exceeds the usable budget', () => {
      const builder = new EvidencePackBuilder();
      // usable = 82; hit is 1000 chars = 250 tokens -> exceeds usable, truncated.
      // Truncation target = 82*4 = 328 chars; an all-X paragraph of 1000 chars
      // has no paragraph boundary, so truncateAtParagraphBoundary returns null.
      const pack = builder.build('q', [hit('a.md', 'X'.repeat(1000))], {
        evidenceTokenBudget: 100,
      });
      expect(pack.items).toHaveLength(0);
      expect(pack.omittedHitCount).toBe(1);
    });

    it('counts all remaining hits as omitted once the budget is exhausted', () => {
      const builder = new EvidencePackBuilder();
      const hits = [
        hit('a.md', 'a'.repeat(320)), // ~80 tokens, fills usable budget
        hit('b.md', 'b'.repeat(40)),
        hit('c.md', 'c'.repeat(40)),
      ];
      const pack = builder.build('q', hits, { evidenceTokenBudget: 100 });
      expect(pack.items).toHaveLength(1);
      expect(pack.omittedHitCount).toBe(2);
    });

    it('truncates a hit at a paragraph boundary when it does not fit whole', () => {
      const builder = new EvidencePackBuilder();
      // Two paragraphs: first fits, second pushes over budget.
      // usable = 82*4 = 328 chars target. First paragraph = 100 chars (fits),
      // second = 300 chars -> total 100+2+300 = 402 > 328, so truncate keeps
      // only the first paragraph and marks truncated=true.
      const text = 'P1.'.padEnd(100, 'a') + '\n\n' + 'P2.'.padEnd(300, 'b');
      const pack = builder.build('q', [hit('a.md', text)], {
        evidenceTokenBudget: 100,
      });
      expect(pack.items).toHaveLength(1);
      expect(pack.items[0].truncated).toBe(true);
      expect(pack.items[0].text).toContain('P1.');
      expect(pack.items[0].text).not.toContain('P2.');
    });
  });

  describe('empty packs', () => {
    it('returns an empty items array for zero hits', () => {
      const builder = new EvidencePackBuilder();
      const pack = builder.build('q', [], { evidenceTokenBudget: 1000 });
      expect(pack.items).toEqual([]);
      expect(pack.totalEstimatedTokens).toBe(0);
      expect(pack.omittedHitCount).toBe(0);
      expect(pack.query).toBe('q');
    });

    it('returns an empty pack when budget is 0', () => {
      const builder = new EvidencePackBuilder();
      const pack = builder.build('q', [hit('a.md', 'aa')], { evidenceTokenBudget: 0 });
      expect(pack.items).toHaveLength(0);
      expect(pack.omittedHitCount).toBe(1);
    });
  });

  describe('custom instructionReserveRatio', () => {
    it('honors a custom reserve ratio', () => {
      const builder = new EvidencePackBuilder();
      const pack = builder.build('q', [hit('a.md', 'a'.repeat(40))], {
        evidenceTokenBudget: 100,
        instructionReserveRatio: 0.5,
      });
      // usable = 50; 40-char hit = 10 tokens -> fits.
      expect(pack.items).toHaveLength(1);
    });

    it('with reserve 1.0 admits nothing', () => {
      const builder = new EvidencePackBuilder();
      const pack = builder.build('q', [hit('a.md', 'aa')], {
        evidenceTokenBudget: 100,
        instructionReserveRatio: 1.0,
      });
      expect(pack.items).toHaveLength(0);
      expect(pack.omittedHitCount).toBe(1);
    });
  });

  describe('formatEvidenceForModel', () => {
    it('produces a multi-line block with citation, source, heading, lines, content', () => {
      const builder = new EvidencePackBuilder();
      const pack = builder.build('q', [hit('notes/foo.md', 'Body text.')], {
        evidenceTokenBudget: 1000,
      });
      const formatted = formatEvidenceForModel(pack.items[0]);
      const lines = formatted.split('\n');
      expect(lines[0]).toBe('[S1]');
      expect(lines[1]).toBe('Source: notes/foo.md');
      expect(lines[2]).toBe('Heading: H');
      expect(lines[3]).toBe('Lines: 1-10');
      expect(lines[4]).toBe('Content:');
      expect(lines[5]).toBe('Body text.');
    });
  });

  describe('formatEvidenceFileContextName', () => {
    it('formats citation id, basename, and heading path', () => {
      const builder = new EvidencePackBuilder();
      const pack = builder.build('q', [hit('notes/foo.md', 'Body.', ['A', 'B'])], {
        evidenceTokenBudget: 1000,
      });
      expect(formatEvidenceFileContextName(pack.items[0])).toBe('[S1] note — A > B');
    });
  });

  describe('GROUNDED_ANSWER_INSTRUCTION', () => {
    it('instructs the model to cite with bracketed source IDs', () => {
      expect(GROUNDED_ANSWER_INSTRUCTION).toContain('[S1]');
      expect(GROUNDED_ANSWER_INSTRUCTION).toMatch(/cite/i);
    });

    it('instructs the model to decline when evidence is insufficient', () => {
      expect(GROUNDED_ANSWER_INSTRUCTION).toMatch(/could not find/i);
    });

    it('forbids inventing citations, paths, APIs, or details', () => {
      expect(GROUNDED_ANSWER_INSTRUCTION).toMatch(/do not invent/i);
    });
  });
});
