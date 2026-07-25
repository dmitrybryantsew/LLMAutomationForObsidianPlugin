import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CompanionClient } from '../../src/retrieval/CompanionClient';

let mockFetch: any;

beforeEach(() => {
  mockFetch = vi.fn();
  global.fetch = mockFetch;
});

describe('CompanionClient', () => {
  describe('checkStatus', () => {
    it('returns status when companion is running', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          running: true,
          version: '0.1.0',
          capabilities: ['scan', 'index', 'git-info', 'allowlist'],
          allowlistSize: 2,
          defaultIncludeGlobs: ['**/*.md'],
          defaultExcludeGlobs: ['**/.git/**'],
        }),
      });

      const client = new CompanionClient('http://127.0.0.1:43110');
      const status = await client.checkStatus(true);

      expect(status).not.toBeNull();
      expect(status!.running).toBe(true);
      expect(status!.version).toBe('0.1.0');
      expect(status!.allowlistSize).toBe(2);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:43110/status',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('returns null when companion is offline', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const client = new CompanionClient('http://127.0.0.1:43110');
      const status = await client.checkStatus(true);
      expect(status).toBeNull();
    });

    it('returns null on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      const client = new CompanionClient('http://127.0.0.1:43110');
      const status = await client.checkStatus(true);
      expect(status).toBeNull();
    });

    it('caches status within interval', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ running: true, version: '0.1.0', capabilities: [], allowlistSize: 0, defaultIncludeGlobs: [], defaultExcludeGlobs: [] }),
      });

      const client = new CompanionClient('http://127.0.0.1:43110');
      await client.checkStatus(true);
      // Second call within interval should use cache
      const status = await client.checkStatus();
      expect(status).not.toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('scanSource', () => {
    it('sends scan request and returns result', async () => {
      const mockResult = {
        root: 'C:/repo',
        totalFiles: 10,
        includedFiles: [
          { relativePath: 'README.md', absolutePath: 'C:/repo/README.md', sizeBytes: 100, modifiedTime: 1000, extension: '.md', tooLarge: false },
        ],
        skippedReasons: { excluded_by_glob: 5 },
      };
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockResult });

      const client = new CompanionClient('http://127.0.0.1:43110');
      const result = await client.scanSource({ rootPath: 'C:/repo' });

      expect(result.totalFiles).toBe(10);
      expect(result.includedFiles).toHaveLength(1);
      expect(result.includedFiles[0].relativePath).toBe('README.md');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:43110/source/scan');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.rootPath).toBe('C:/repo');
    });

    it('throws on 403 (not allowlisted)', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'not allowed' });
      const client = new CompanionClient('http://127.0.0.1:43110');
      await expect(client.scanSource({ rootPath: 'C:/bad' })).rejects.toThrow('not allowlisted');
    });
  });

  describe('getGitInfo', () => {
    it('returns git metadata', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          available: true,
          branch: 'main',
          commitSha: 'abc123',
          originUrl: 'https://github.com/test/repo',
          dirty: false,
          error: null,
        }),
      });

      const client = new CompanionClient('http://127.0.0.1:43110');
      const info = await client.getGitInfo('C:/repo');

      expect(info.available).toBe(true);
      expect(info.branch).toBe('main');
      expect(info.commitSha).toBe('abc123');
    });
  });

  describe('indexSource', () => {
    it('sends index request and returns chunks', async () => {
      const mockResult = {
        sourceId: 'ext-1',
        root: 'C:/repo',
        chunkCount: 3,
        fileCount: 2,
        errors: {},
        chunks: [
          {
            id: 'chunk-1',
            sourceId: 'ext-1',
            path: 'README.md',
            basename: 'README',
            headingPath: ['Title'],
            startLine: 1,
            endLine: 5,
            text: '...',
            normalizedText: '...',
            tags: [],
            outboundLinks: [],
            contentHash: 'abc12345',
            modifiedTime: 1000,
          },
        ],
      };
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockResult });

      const client = new CompanionClient('http://127.0.0.1:43110');
      const result = await client.indexSource({ sourceId: 'ext-1', rootPath: 'C:/repo' });

      expect(result.chunkCount).toBe(3);
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].id).toBe('chunk-1');
      expect(result.chunks[0].sourceId).toBe('ext-1');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:43110/source/index');
      const body = JSON.parse(opts.body);
      expect(body.sourceId).toBe('ext-1');
      expect(body.rootPath).toBe('C:/repo');
    });
  });

  describe('allowlist management', () => {
    it('adds a root', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ roots: [{ id: 'src-1', path: 'C:/repo', addedAt: 1000 }] }),
      });

      const client = new CompanionClient('http://127.0.0.1:43110');
      const roots = await client.addAllowlistRoot('src-1', 'C:/repo');

      expect(roots).toHaveLength(1);
      expect(roots[0].id).toBe('src-1');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:43110/allowlist/add');
      const body = JSON.parse(opts.body);
      expect(body.id).toBe('src-1');
      expect(body.path).toBe('C:/repo');
    });

    it('removes a root', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ roots: [] }),
      });

      const client = new CompanionClient('http://127.0.0.1:43110');
      const roots = await client.removeAllowlistRoot('src-1');
      expect(roots).toHaveLength(0);
    });
  });

  describe('endpoint handling', () => {
    it('strips trailing slash', () => {
      const client = new CompanionClient('http://127.0.0.1:43110/');
      expect((client as any).endpoint).toBe('http://127.0.0.1:43110');
    });

    it('setEndpoint resets cache', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ running: true, version: '0.1.0', capabilities: [], allowlistSize: 0, defaultIncludeGlobs: [], defaultExcludeGlobs: [] }),
      });

      const client = new CompanionClient('http://127.0.0.1:43110');
      await client.checkStatus(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      client.setEndpoint('http://127.0.0.1:43111');
      // Cache should be reset
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ running: true, version: '0.1.0', capabilities: [], allowlistSize: 0, defaultIncludeGlobs: [], defaultExcludeGlobs: [] }),
      });
      await client.checkStatus(true);
      expect(mockFetch.mock.calls[1][0]).toBe('http://127.0.0.1:43111/status');
    });
  });
});
