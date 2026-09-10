import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CompanionClient } from '../../src/retrieval/CompanionClient';
import { spawn, ChildProcess } from 'child_process';
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const COMPANION_ENDPOINT = 'http://127.0.0.1:43110';
// The companion source moved to GeneralTools (single copy). This repo keeps
// only a pointer README under companion/.
const GENERALTOOLS_ROOT = 'H:\\Common\\Python\\GeneralTools';
const COMPANION_SOURCE = join(GENERALTOOLS_ROOT, 'bundled_projects', 'obsidian_companion');
const VENV_PYTHON = join(GENERALTOOLS_ROOT, 'app_data', 'venvs', 'obsidian_companion_16d0fefc02', 'Scripts', 'python.exe');
const FALLBACK_PYTHON = 'C:\\Users\\User\\AppData\\Local\\Microsoft\\WindowsApps\\PythonSoftwareFoundation.Python.3.11_qbz5n2kfra8p0\\python.exe';

let companionProcess: ChildProcess | null = null;
let reusedRunningServer = false;
let tmpRoot: string;
let tmpStateDir: string;

async function isCompanionUp(): Promise<boolean> {
  try {
    const res = await fetch(`${COMPANION_ENDPOINT}/status`);
    return res.ok;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  // Create a temp source tree
  tmpRoot = mkdtempSync(join(tmpdir(), 'companion-int-'));
  writeFileSync(join(tmpRoot, 'README.md'), '# Test Repo\n\nHello from the test repo.\n');
  mkdirSync(join(tmpRoot, 'src'));
  writeFileSync(join(tmpRoot, 'src', 'main.py'), 'def hello():\n    print("hi")\n');

  // If a compatible companion is already running on the endpoint, reuse it
  // instead of failing to bind the port.
  if (await isCompanionUp()) {
    reusedRunningServer = true;
    return;
  }

  if (!existsSync(COMPANION_SOURCE)) {
    throw new Error(`Companion source not found at ${COMPANION_SOURCE}. Start it via GeneralTools or clone GeneralTools.`);
  }

  // Create a unique state dir per test run so the allowlist is clean
  tmpStateDir = mkdtempSync(join(tmpdir(), 'companion-state-'));

  const python = existsSync(VENV_PYTHON) ? VENV_PYTHON : FALLBACK_PYTHON;
  companionProcess = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '43110'], {
    cwd: COMPANION_SOURCE,
    stdio: 'pipe',
    env: { ...process.env, COMPANION_STATE_DIR: tmpStateDir },
  });

  // Wait for server to be ready
  const maxRetries = 20;
  for (let i = 0; i < maxRetries; i++) {
    await new Promise(resolve => setTimeout(resolve, 300));
    if (await isCompanionUp()) return;
  }
  throw new Error('Companion server did not start');
}, 60_000);

afterAll(async () => {
  if (companionProcess) {
    companionProcess.kill();
    companionProcess = null;
  }
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
  if (tmpStateDir) {
    rmSync(tmpStateDir, { recursive: true, force: true });
  }
});

describe('CompanionClient live integration', () => {
  it('checks status', async () => {
    const client = new CompanionClient(COMPANION_ENDPOINT);
    const status = await client.checkStatus(true);
    expect(status).not.toBeNull();
    expect(status!.running).toBe(true);
    expect(status!.version).toBe('0.1.0');
    expect(status!.capabilities).toContain('scan');
  });

  it('adds root to allowlist, scans, and indexes', async () => {
    const client = new CompanionClient(COMPANION_ENDPOINT);

    // Clear any stale 'test-src' entry from previous runs (add_root is
    // idempotent on id, so an old entry would silently block this run).
    await client.removeAllowlistRoot('test-src').catch(() => {});

    // Add to allowlist
    await client.addAllowlistRoot('test-src', tmpRoot);

    // Scan
    const scan = await client.scanSource({ rootPath: tmpRoot });
    expect(scan.totalFiles).toBeGreaterThanOrEqual(2);
    const paths = scan.includedFiles.map(f => f.relativePath);
    expect(paths).toContain('README.md');
    expect(paths).toContain('src/main.py');

    // Index
    const indexResult = await client.indexSource({
      sourceId: 'test-src',
      rootPath: tmpRoot,
    });
    expect(indexResult.chunkCount).toBeGreaterThan(0);
    expect(indexResult.fileCount).toBeGreaterThanOrEqual(2);

    // Verify chunk shape
    const chunk = indexResult.chunks[0];
    expect(chunk).toHaveProperty('id');
    expect(chunk).toHaveProperty('sourceId');
    expect(chunk).toHaveProperty('path');
    expect(chunk).toHaveProperty('basename');
    expect(chunk).toHaveProperty('headingPath');
    expect(chunk).toHaveProperty('startLine');
    expect(chunk).toHaveProperty('endLine');
    expect(chunk).toHaveProperty('text');
    expect(chunk).toHaveProperty('normalizedText');
    expect(chunk).toHaveProperty('tags');
    expect(chunk).toHaveProperty('outboundLinks');
    expect(chunk).toHaveProperty('contentHash');
    expect(chunk).toHaveProperty('modifiedTime');

    // README.md should have heading "Test Repo"
    const readmeChunk = indexResult.chunks.find(c => c.path === 'README.md');
    expect(readmeChunk).toBeDefined();
    expect(readmeChunk!.headingPath).toContain('Test Repo');

    // src/main.py should be code-chunked (tags include "python")
    const pyChunks = indexResult.chunks.filter(c => c.path === 'src/main.py');
    expect(pyChunks.length).toBeGreaterThanOrEqual(1);
    expect(pyChunks.some(c => c.tags.includes('python'))).toBe(true);
    // Should have a function chunk for "hello"
    const helloChunk = pyChunks.find(c => c.headingPath.includes('hello'));
    expect(helloChunk).toBeDefined();

    // Clean up our allowlist entry (the reused running server persists state).
    if (reusedRunningServer) {
      await client.removeAllowlistRoot('test-src').catch(() => {});
    }
  });

  it('rejects non-allowlisted paths with 403', async () => {
    const client = new CompanionClient(COMPANION_ENDPOINT);
    await expect(client.scanSource({ rootPath: 'C:/nonexistent/path' })).rejects.toThrow();
  });
});
