import { describe, expect, it } from 'vitest';
import { IgnoreMatcher } from '../../src/retrieval/IgnoreMatcher';

describe('IgnoreMatcher', () => {
  describe('default behavior', () => {
    it('indexes .md files under an empty root by default', () => {
      const m = new IgnoreMatcher({ rootPath: '', includeGlobs: [], excludeGlobs: [] });
      expect(m.shouldIndex('notes/foo.md')).toBe(true);
      expect(m.shouldIndex('a/b/c.md')).toBe(true);
    });

    it('defaults to **/*.md when includeGlobs is empty', () => {
      const m = new IgnoreMatcher({ rootPath: '', includeGlobs: [], excludeGlobs: [] });
      expect(m.shouldIndex('notes/foo.txt')).toBe(false);
      expect(m.shouldIndex('notes/foo.md')).toBe(true);
    });

    it('applies default excludes (.obsidian, .trash, *.pdf) even when excludeGlobs is empty', () => {
      const m = new IgnoreMatcher({ rootPath: '', includeGlobs: [], excludeGlobs: [] });
      expect(m.shouldIndex('.obsidian/plugins/foo.md')).toBe(false);
      expect(m.shouldIndex('.trash/deleted.md')).toBe(false);
      expect(m.shouldIndex('notes/doc.pdf')).toBe(false);
    });
  });

  describe('source-root boundaries', () => {
    it('rejects paths outside the configured root', () => {
      const m = new IgnoreMatcher({ rootPath: 'notes', includeGlobs: [], excludeGlobs: [] });
      expect(m.shouldIndex('notes/foo.md')).toBe(true);
      expect(m.shouldIndex('other/foo.md')).toBe(false);
      expect(m.shouldIndex('notes2/foo.md')).toBe(false); // boundary: prefix without slash
    });

    it('accepts the root path itself if it is a .md file', () => {
      const m = new IgnoreMatcher({ rootPath: 'notes', includeGlobs: [], excludeGlobs: [] });
      // root equals path
      expect(m.shouldIndex('notes')).toBe(false); // not a .md
    });

    it('treats root of empty string as matching everything', () => {
      const m = new IgnoreMatcher({ rootPath: '', includeGlobs: [], excludeGlobs: [] });
      expect(m.shouldIndex('anywhere/foo.md')).toBe(true);
    });

    it('normalizes backslashes to forward slashes', () => {
      const m = new IgnoreMatcher({ rootPath: 'notes', includeGlobs: [], excludeGlobs: [] });
      expect(m.shouldIndex('notes\\sub\\foo.md')).toBe(true);
      expect(m.shouldIndex('other\\foo.md')).toBe(false);
    });
  });

  describe('include globs', () => {
    it('respects a custom include glob', () => {
      const m = new IgnoreMatcher({
        rootPath: '',
        includeGlobs: ['docs/**/*.md'],
        excludeGlobs: [],
      });
      expect(m.shouldIndex('docs/intro.md')).toBe(true);
      expect(m.shouldIndex('docs/sub/intro.md')).toBe(true);
      expect(m.shouldIndex('notes/intro.md')).toBe(false);
    });

    it('single-star * matches within a single path segment', () => {
      const m = new IgnoreMatcher({
        rootPath: '',
        includeGlobs: ['notes/*.md'],
        excludeGlobs: [],
      });
      expect(m.shouldIndex('notes/foo.md')).toBe(true);
      expect(m.shouldIndex('notes/sub/foo.md')).toBe(false); // * does not cross /
    });

    it('double-star ** matches across path segments', () => {
      const m = new IgnoreMatcher({
        rootPath: '',
        includeGlobs: ['notes/**/*.md'],
        excludeGlobs: [],
      });
      expect(m.shouldIndex('notes/foo.md')).toBe(true);
      expect(m.shouldIndex('notes/a/b/c.md')).toBe(true);
    });

    it('matching is case-insensitive', () => {
      const m = new IgnoreMatcher({
        rootPath: '',
        includeGlobs: ['notes/*.md'],
        excludeGlobs: [],
      });
      expect(m.shouldIndex('Notes/Foo.MD')).toBe(true);
    });
  });

  describe('exclude globs', () => {
    it('a configured exclude overrides a default include', () => {
      const m = new IgnoreMatcher({
        rootPath: '',
        includeGlobs: [],
        excludeGlobs: ['drafts/**'],
      });
      expect(m.shouldIndex('drafts/foo.md')).toBe(false);
      expect(m.shouldIndex('notes/foo.md')).toBe(true);
    });

    it('exclude with single star stays within a segment (path-anchored)', () => {
      const m = new IgnoreMatcher({
        rootPath: '',
        includeGlobs: [],
        excludeGlobs: ['*.tmp.md'],
      });
      // Bare *.tmp.md is path-anchored: only matches a file literally named
      // "<something>.tmp.md" at the vault root. Use **/*.tmp.md for any-dir.
      expect(m.shouldIndex('foo.tmp.md')).toBe(false);
      expect(m.shouldIndex('notes/foo.tmp.md')).toBe(true); // not matched
      expect(m.shouldIndex('foo.md')).toBe(true);
    });

    it('exclude with ** prefix matches in any directory', () => {
      const m = new IgnoreMatcher({
        rootPath: '',
        includeGlobs: [],
        excludeGlobs: ['**/*.tmp.md'],
      });
      expect(m.shouldIndex('foo.tmp.md')).toBe(false);
      expect(m.shouldIndex('notes/foo.tmp.md')).toBe(false);
      expect(m.shouldIndex('notes/foo.md')).toBe(true);
    });

    it('combines excludes with default excludes', () => {
      const m = new IgnoreMatcher({
        rootPath: '',
        includeGlobs: [],
        excludeGlobs: ['secrets/**'],
      });
      expect(m.shouldIndex('secrets/api-keys.md')).toBe(false);
      expect(m.shouldIndex('.obsidian/config.md')).toBe(false); // default
      expect(m.shouldIndex('notes/foo.md')).toBe(true);
    });
  });

  describe('path normalization', () => {
    it('strips trailing slashes from root', () => {
      const m = new IgnoreMatcher({ rootPath: 'notes/', includeGlobs: [], excludeGlobs: [] });
      expect(m.shouldIndex('notes/foo.md')).toBe(true);
      expect(m.shouldIndex('other/foo.md')).toBe(false);
    });

    it('strips leading/trailing slashes from paths', () => {
      const m = new IgnoreMatcher({ rootPath: 'notes', includeGlobs: [], excludeGlobs: [] });
      expect(m.shouldIndex('/notes/foo.md')).toBe(true);
    });
  });

  describe('glob special-character escaping', () => {
    it('treats literal dots in globs as dots, not wildcards', () => {
      const m = new IgnoreMatcher({
        rootPath: '',
        includeGlobs: ['*.md'],
        excludeGlobs: [],
      });
      expect(m.shouldIndex('foo.md')).toBe(true);
      expect(m.shouldIndex('fooXmd')).toBe(false); // . is literal
    });

    it('escapes regex metacharacters in glob segments', () => {
      const m = new IgnoreMatcher({
        rootPath: '',
        includeGlobs: [],
        excludeGlobs: ['notes/(draft)/**'],
      });
      expect(m.shouldIndex('notes/(draft)/foo.md')).toBe(false);
    });
  });
});
