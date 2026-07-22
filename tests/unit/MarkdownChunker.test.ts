import { describe, expect, it } from 'vitest';
import { chunkMarkdown } from '../../src/retrieval/MarkdownChunker';

const SRC_ID = 'src-test';
const MOD_TIME = 1700000000;

function chunk(content: string, path = 'notes/test.md') {
  return chunkMarkdown({ sourceId: SRC_ID, path, content, modifiedTime: MOD_TIME });
}

describe('MarkdownChunker', () => {
  describe('frontmatter', () => {
    it('strips YAML frontmatter that starts at byte zero and is terminated by a matching --- line', () => {
      const content = '---\ntags: [foo, bar]\n---\n\n# Heading\n\nBody text.';
      const chunks = chunk(content);
      expect(chunks.length).toBe(1);
      expect(chunks[0].tags).toEqual(['foo', 'bar']);
      expect(chunks[0].text).not.toContain('tags:');
      expect(chunks[0].text).toContain('Body text.');
    });

    it('parses inline-flow tags list', () => {
      const content = '---\ntags: alpha, beta, gamma\n---\n\nBody.';
      const chunks = chunk(content);
      expect(chunks[0].tags).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('strips leading # from inline-flow tags', () => {
      const content = '---\ntags: #alpha, #beta\n---\n\nBody.';
      const chunks = chunk(content);
      expect(chunks[0].tags).toEqual(['alpha', 'beta']);
    });

    it('does not treat body content as frontmatter when --- is not at byte zero', () => {
      const content = 'Intro line\n\n---\n\ntags: should-not-parse\n\n---\n\n# H';
      const chunks = chunk(content);
      expect(chunks.some((c) => c.tags.includes('should-not-parse'))).toBe(false);
    });

    it('does not discard body when frontmatter is malformed (no closing ---)', () => {
      const content = '---\ntags: [foo]\nNo closing fence here';
      const chunks = chunk(content);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].text).toContain('No closing fence here');
    });

    it('parses tags with mixed quotes/brackets conservatively', () => {
      const content = '---\ntags: ["foo", "bar", "baz"]\n---\n\nBody.';
      const chunks = chunk(content);
      expect(chunks[0].tags).toEqual(['foo', 'bar', 'baz']);
    });
  });

  describe('headings and sections', () => {
    it('treats content before first heading as a (preamble) section with the filename as implicit title', () => {
      const content = 'Intro paragraph.\n\nMore preamble.\n\n# First Heading\n\nBody.';
      const chunks = chunk(content, 'notes/MyNote.md');
      expect(chunks.length).toBe(2);
      expect(chunks[0].headingPath).toEqual(['(preamble)']);
      expect(chunks[0].text).toContain('Note: MyNote');
      expect(chunks[0].text).toContain('Intro paragraph.');
      expect(chunks[1].headingPath).toEqual(['First Heading']);
    });

    it('maintains a nested heading stack and replaces same-or-deeper levels', () => {
      const content = [
        '# H1',
        '',
        'body h1',
        '',
        '## H2a',
        '',
        'body h2a',
        '',
        '### H3',
        '',
        'body h3',
        '',
        '## H2b',
        '',
        'body h2b',
      ].join('\n');
      const chunks = chunk(content);
      const headings = chunks.map((c) => c.headingPath);
      expect(headings).toEqual([
        ['H1'],
        ['H1', 'H2a'],
        ['H1', 'H2a', 'H3'],
        ['H1', 'H2b'],
      ]);
    });

    it('handles a deeper heading popping back to a shallower one', () => {
      const content = [
        '# Top',
        '',
        'body top',
        '',
        '### Deep',
        '',
        'body deep',
        '',
        '# Other',
        '',
        'body other',
      ].join('\n');
      const chunks = chunk(content);
      expect(chunks.map((c) => c.headingPath)).toEqual([
        ['Top'],
        ['Top', undefined, 'Deep'],
        ['Other'],
      ]);
    });

    it('skips headings with no body without producing empty chunks', () => {
      const content = '# H1\n# H2\n# H3\n\nBody.';
      const chunks = chunk(content);
      expect(chunks.length).toBe(1);
      expect(chunks[0].headingPath).toEqual(['H3']);
      expect(chunks[0].text).toContain('Body.');
    });

    it('does not detect headings inside fenced code blocks', () => {
      const content = [
        '# Real Heading',
        '',
        '```',
        '# Not a heading',
        '## Also not a heading',
        '```',
        '',
        'After fence.',
      ].join('\n');
      // No second heading outside the fence, so everything stays in one section.
      const chunks = chunk(content);
      expect(chunks.length).toBe(1);
      expect(chunks[0].headingPath).toEqual(['Real Heading']);
      expect(chunks[0].text).toContain('# Not a heading');
      expect(chunks[0].text).toContain('## Also not a heading');
      expect(chunks[0].text).toContain('After fence.');
    });

    it('creates a new section when a heading appears after a closed fence', () => {
      const content = [
        '# Real Heading',
        '',
        '```',
        '# Not a heading',
        '```',
        '',
        '# Second Heading',
        '',
        'After fence.',
      ].join('\n');
      const chunks = chunk(content);
      expect(chunks.length).toBe(2);
      expect(chunks[0].headingPath).toEqual(['Real Heading']);
      expect(chunks[0].text).toContain('# Not a heading');
      expect(chunks[1].headingPath).toEqual(['Second Heading']);
      expect(chunks[1].text).toContain('After fence.');
    });

    it('treats a # inside a code fence as ordinary text and never creates a section boundary', () => {
      const content = [
        '```python',
        'def f():',
        '    # comment',
        '    return 1',
        '```',
        '',
        'Tail text.',
      ].join('\n');
      const chunks = chunk(content);
      expect(chunks.length).toBe(1);
      expect(chunks[0].headingPath).toEqual(['(preamble)']);
      expect(chunks[0].text).toContain('# comment');
      expect(chunks[0].text).toContain('Tail text.');
    });

    it('preserves blockquotes, tables, and lists as ordinary section text', () => {
      const content = [
        '# H',
        '',
        '> a quote',
        '',
        '| a | b |',
        '|---|---|',
        '| 1 | 2 |',
        '',
        '- item 1',
        '- item 2',
      ].join('\n');
      const chunks = chunk(content);
      expect(chunks.length).toBe(1);
      expect(chunks[0].text).toContain('> a quote');
      expect(chunks[0].text).toContain('| a | b |');
      expect(chunks[0].text).toContain('- item 1');
    });
  });

  describe('long-section splitting', () => {
    it('keeps a section under maxSectionChars as a single chunk', () => {
      const body = 'Para one.';
      const content = `# H\n\n${body}`;
      const chunks = chunkMarkdown({
        sourceId: SRC_ID,
        path: 'n.md',
        content,
        modifiedTime: MOD_TIME,
        maxSectionChars: 1000,
      });
      expect(chunks.length).toBe(1);
      expect(chunks[0].text).toContain(body);
    });

    it('splits an overlong section at paragraph boundaries with overlap of the last paragraph', () => {
      const p1 = 'A'.repeat(400);
      const p2 = 'B'.repeat(400);
      const p3 = 'C'.repeat(400);
      const content = `# H\n\n${p1}\n\n${p2}\n\n${p3}`;
      const chunks = chunkMarkdown({
        sourceId: SRC_ID,
        path: 'n.md',
        content,
        modifiedTime: MOD_TIME,
        maxSectionChars: 900,
      });
      expect(chunks.length).toBe(2);
      expect(chunks[0].text).toContain(p1);
      expect(chunks[0].text).toContain(p2);
      expect(chunks[1].text).toContain(p2);
      expect(chunks[1].text).toContain(p3);
    });

    it('handles a single paragraph larger than maxSectionChars by producing at least one chunk', () => {
      const huge = 'X'.repeat(5000);
      const content = `# H\n\n${huge}`;
      const chunks = chunkMarkdown({
        sourceId: SRC_ID,
        path: 'n.md',
        content,
        modifiedTime: MOD_TIME,
        maxSectionChars: 1000,
      });
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].text).toContain(huge.slice(0, 50));
    });
  });

  describe('line numbers', () => {
    it('records 1-based start/end lines for each chunk', () => {
      const content = [
        '# H1', // line 1
        '',    // line 2
        'Para A', // line 3
        '',    // line 4
        '## H2', // line 5
        '',    // line 6
        'Para B', // line 7
      ].join('\n');
      const chunks = chunk(content);
      expect(chunks.length).toBe(2);
      expect(chunks[0].startLine).toBe(3);
      expect(chunks[0].endLine).toBe(3);
      expect(chunks[1].startLine).toBe(7);
      expect(chunks[1].endLine).toBe(7);
    });
  });

  describe('links', () => {
    it('extracts wiki links and Markdown links for metadata but does not follow them', () => {
      const content = [
        '# H',
        '',
        'See [[Target Note]] and [[Alias Link|display]].',
        'Also [external](https://example.com/foo) and [md](other.md).',
      ].join('\n');
      const chunks = chunk(content);
      expect(chunks.length).toBe(1);
      expect(chunks[0].outboundLinks).toEqual(
        expect.arrayContaining([
          'Target Note',
          'Alias Link',
          'https://example.com/foo',
          'other.md',
        ])
      );
      expect(chunks[0].outboundLinks).toHaveLength(4);
    });

    it('deduplicates links', () => {
      const content = '# H\n\n[[note]] and [[note]] again. Also [a](x.md) and [b](x.md).';
      const chunks = chunk(content);
      expect(chunks[0].outboundLinks).toEqual(['note', 'x.md']);
    });
  });

  describe('chunk IDs and metadata', () => {
    it('produces a deterministic ID stable across calls with identical inputs', () => {
      const content = '# H\n\nBody text here.';
      const a = chunk(content);
      const b = chunk(content);
      expect(a[0].id).toBe(b[0].id);
      expect(a[0].id).toMatch(/^[0-9a-f]{8}$/);
    });

    it('produces different IDs when content changes but path/source/heading/ordinal stay the same', () => {
      const idA = chunk('# H\n\nBody A.')[0].id;
      const idB = chunk('# H\n\nBody B.')[0].id;
      expect(idA).not.toBe(idB);
    });

    it('sets basename from path without .md extension', () => {
      const chunks = chunk('Body.', 'folder/My File.md');
      expect(chunks[0].basename).toBe('My File');
    });

    it('prefixes display text exactly once with Note/Heading and does not prefix normalizedText', () => {
      const chunks = chunk('# My Heading\n\nBody.');
      expect(chunks[0].text).toBe('Note: test\nHeading: My Heading\n\nBody.');
      expect(chunks[0].normalizedText).not.toContain('Note:');
      expect(chunks[0].normalizedText).not.toContain('Heading:');
    });

    it('propagates sourceId, path, and modifiedTime to every chunk', () => {
      const chunks = chunk('# H\n\nA.\n\n## H2\n\nB.', 'folder/x.md');
      for (const c of chunks) {
        expect(c.sourceId).toBe(SRC_ID);
        expect(c.path).toBe('folder/x.md');
        expect(c.modifiedTime).toBe(MOD_TIME);
      }
    });

    it('produces a contentHash that is stable for identical normalized text', () => {
      const a = chunk('# H\n\nBody.');
      const b = chunk('# H\n\nBody.');
      expect(a[0].contentHash).toBe(b[0].contentHash);
      expect(a[0].contentHash).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  describe('edge cases', () => {
    it('returns an empty array for an empty document', () => {
      expect(chunk('')).toEqual([]);
    });

    it('returns an empty array for a document with only whitespace', () => {
      expect(chunk('   \n\n  \n')).toEqual([]);
    });

    it('returns an empty array for a document with only frontmatter and no body', () => {
      expect(chunk('---\ntags: [x]\n---\n')).toEqual([]);
    });

    it('normalizes CRLF line endings', () => {
      const content = '# H\r\n\r\nBody.\r\n';
      const chunks = chunk(content);
      expect(chunks.length).toBe(1);
      expect(chunks[0].text).toContain('Body.');
    });

    it('handles a path with no .md extension', () => {
      const chunks = chunk('Body.', 'notes/note.txt');
      expect(chunks[0].basename).toBe('note.txt');
    });
  });
});
