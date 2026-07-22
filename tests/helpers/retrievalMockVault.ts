import { vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { readFts5WasmBinary } from './fts5Wasm';

/**
 * In-memory mock vault for retrieval integration tests.
 *
 * Provides what the retrieval stack needs from `App`:
 *  - `vault.getMarkdownFiles()` / `vault.getAbstractFileByPath(path)` / `vault.read(file)`
 *  - `vault.on('modify'|'create'|'delete'|'rename', cb)` returning an EventRef
 *  - `vault.adapter.exists/mkdir/readBinary/writeBinary` for SQLite persistence
 *
 * The FTS5-enabled sql.js wasm is seeded into the adapter at the standard plugin
 * path so `RetrievalDatabase.readWasmBinary()` picks it up.
 */

export interface MockFile {
  path: string;
  content: string;
  mtime: number;
  size: number;
}

export interface RetrievalMockVault {
  app: any;
  files: Map<string, MockFile>;
  binaryFiles: Map<string, Uint8Array>;
  events: { type: string; handler: (file: any, oldPath?: string) => void }[];
  emitCreate(path: string): void;
  emitModify(path: string): void;
  emitDelete(path: string): void;
  emitRename(oldPath: string, newPath: string): void;
  addFile(path: string, content: string, mtime?: number): MockFile;
  updateFile(path: string, content: string, mtime?: number): MockFile;
  deleteFile(path: string): void;
  renameFile(oldPath: string, newPath: string): void;
  reset(): void;
}

const ADAPTER_WASM_PATH = '.obsidian/plugins/gpt4free-text-generator-plugin/sql-wasm.wasm';
const DEFAULT_DB_PATH = '.obsidian/plugins/gpt4free-text-generator-plugin/retrieval.sqlite';

export function createRetrievalMockVault(): RetrievalMockVault {
  const files = new Map<string, MockFile>();
  const binaryFiles = new Map<string, Uint8Array>();
  const events: { type: string; handler: (file: any, oldPath?: string) => void }[] = [];

  // Seed the FTS5 wasm into the adapter so RetrievalDatabase can load it.
  binaryFiles.set(ADAPTER_WASM_PATH, readFts5WasmBinary());

  function makeFile(path: string, content: string, mtime?: number): MockFile {
    return {
      path,
      content,
      mtime: mtime ?? Date.now(),
      size: Buffer.byteLength(content, 'utf8'),
    };
  }

  function emit(type: string, file: any, oldPath?: string) {
    for (const e of events) {
      if (e.type === type) {
        e.handler(file, oldPath);
      }
    }
  }

  const app = {
    vault: {
      getMarkdownFiles: vi.fn(() => {
        return Array.from(files.values()).map((f) => ({
          path: f.path,
          stat: { mtime: f.mtime, size: f.size },
        }));
      }),
      getAbstractFileByPath: vi.fn((p: string) => {
        const f = files.get(p);
        if (!f) return null;
        return { path: f.path, stat: { mtime: f.mtime, size: f.size } };
      }),
      read: vi.fn(async (file: { path: string }) => {
        const f = files.get(file.path);
        if (!f) throw new Error(`Mock file not found: ${file.path}`);
        return f.content;
      }),
      on: vi.fn((type: string, handler: (file: any, oldPath?: string) => void) => {
        events.push({ type, handler });
        return { type, handler };
      }),
      off: vi.fn((ref: { type: string; handler: (file: any) => void }) => {
        const idx = events.findIndex((e) => e.handler === ref.handler && e.type === ref.type);
        if (idx >= 0) events.splice(idx, 1);
      }),
      adapter: {
        exists: vi.fn(async (p: string) => files.has(p) || binaryFiles.has(p)),
        mkdir: vi.fn(async (_dir: string) => {}),
        readBinary: vi.fn(async (p: string) => {
          const bytes = binaryFiles.get(p);
          if (!bytes) throw new Error(`Mock binary file not found: ${p}`);
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        }),
        writeBinary: vi.fn(async (p: string, data: ArrayBuffer) => {
          binaryFiles.set(p, new Uint8Array(data));
        }),
        read: vi.fn(async (p: string) => {
          // base64 fallback path (not used when readBinary is present)
          const bytes = binaryFiles.get(p);
          if (!bytes) throw new Error(`Mock file not found: ${p}`);
          return Buffer.from(bytes).toString('base64');
        }),
        write: vi.fn(async (p: string, data: string) => {
          binaryFiles.set(p, Uint8Array.from(Buffer.from(data, 'base64')));
        }),
      },
    },
  };

  return {
    app,
    files,
    binaryFiles,
    events,
    emitCreate(p: string) {
      const f = files.get(p);
      emit('create', f ? { path: f.path, stat: { mtime: f.mtime, size: f.size } } : { path: p });
    },
    emitModify(p: string) {
      const f = files.get(p);
      emit('modify', f ? { path: f.path, stat: { mtime: f.mtime, size: f.size } } : { path: p });
    },
    emitDelete(p: string) {
      emit('delete', { path: p });
    },
    emitRename(oldPath: string, newPath: string) {
      emit('rename', { path: newPath, stat: { mtime: Date.now(), size: 0 } }, oldPath);
    },
    addFile(p: string, content: string, mtime?: number) {
      const f = makeFile(p, content, mtime);
      files.set(p, f);
      return f;
    },
    updateFile(p: string, content: string, mtime?: number) {
      const existing = files.get(p);
      const f = makeFile(p, content, mtime ?? (existing ? existing.mtime + 1 : Date.now()));
      files.set(p, f);
      return f;
    },
    deleteFile(p: string) {
      files.delete(p);
    },
    renameFile(oldPath: string, newPath: string) {
      const f = files.get(oldPath);
      if (!f) return;
      files.delete(oldPath);
      files.set(newPath, { ...f, path: newPath });
    },
    reset() {
      files.clear();
      binaryFiles.clear();
      binaryFiles.set(ADAPTER_WASM_PATH, readFts5WasmBinary());
      events.length = 0;
      vi.clearAllMocks();
    },
  };
}

export { ADAPTER_WASM_PATH, DEFAULT_DB_PATH };
