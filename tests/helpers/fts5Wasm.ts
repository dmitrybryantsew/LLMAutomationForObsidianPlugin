import path from 'path';
import { readFileSync } from 'fs';
import Module from 'module';

/**
 * Paths to the vendored FTS5-enabled sql.js build.
 *
 * The upstream npm `sql.js` wasm does NOT include FTS5 (only FTS3), and the
 * npm JS loader is built against a different Emscripten version than our FTS5
 * build. The JS loader and wasm binary MUST come from the same build, so tests
 * that exercise FTS5 must use `initFts5SqlJs()` (which loads the vendored JS)
 * instead of `import initSqlJs from 'sql.js'`.
 *
 * See `vendor/sqljs-fts5/README.md` for provenance and reproduction steps.
 */
export const FTS5_WASM_DIR = path.join(process.cwd(), 'vendor', 'sqljs-fts5');
export const FTS5_WASM_PATH = path.join(FTS5_WASM_DIR, 'sql-wasm.wasm');
export const FTS5_WASM_JS_PATH = path.join(FTS5_WASM_DIR, 'sql-wasm.js');

/** The wasm path as expected by the plugin's adapter convention. */
export const FTS5_ADAPTER_WASM_PATH =
  '.obsidian/plugins/gpt4free-text-generator-plugin/sql-wasm.wasm';

/** The FTS5 wasm binary, for passing as `wasmBinary`. */
export function readFts5WasmBinary(): Uint8Array {
  return readFileSync(FTS5_WASM_PATH);
}

/**
 * Load the vendored FTS5-enabled sql.js JS loader. Returns the `initSqlJs`
 * function, identical in shape to `import initSqlJs from 'sql.js'` but bound
 * to the matching FTS5-enabled wasm glue.
 *
 * Why not `require()`/`import()` directly?
 * - vitest's ESM-with-CJS-interop loader intercepts `require()` of the
 *   vendored UMD file and returns an empty namespace (the SSR transform
 *   doesn't recognize the hand-built Emscripten UMD shape).
 * - The Emscripten UMD wrapper internally calls `require("node:fs")` on the
 *   Node sync-load path, so naive `new Function('module','exports',source)`
 *   crashes with `require is not defined`.
 *
 * Solution: instantiate a real Node CJS `Module` and call `_compile` on the
 * source. `_compile` is exactly what Node's own `require()` uses internally:
 * it wraps the source in `(function(exports,require,module,__filename,__dirname){...})`,
 * providing a real `require` bound to this module's filename. This bypasses
 * vitest's interception (we never call `require()`/`import()` on the file)
 * while giving the UMD wrapper the Node globals it expects.
 *
 * Usage:
 *   const initSqlJs = initFts5SqlJs();
 *   const SQL = await initSqlJs({ wasmBinary: readFts5WasmBinary() });
 */
export function initFts5SqlJs(): typeof import('sql.js') {
  const source = readFileSync(FTS5_WASM_JS_PATH, 'utf8');
  const m = new Module(FTS5_WASM_JS_PATH, module);
  m.filename = FTS5_WASM_JS_PATH;
  m.paths = Module._nodeModulePaths(path.dirname(FTS5_WASM_JS_PATH));
  // `_compile` wraps the source in Node's CJS wrapper function, providing
  // `require`, `module`, `exports`, `__filename`, `__dirname`.
  m._compile(source, FTS5_WASM_JS_PATH);
  const exports = m.exports as Record<string, unknown> & {
    default?: typeof import('sql.js');
    Module?: typeof import('sql.js');
  };
  // The Emscripten UMD wrapper assigns `exports["Module"] = initSqlJs` in CJS
  // contexts. Some toolchains also surface it as `exports.default`.
  const initSqlJs = (exports.Module ??
    exports.default ??
    (typeof m.exports === 'function' ? (m.exports as unknown) : undefined)) as
    | typeof import('sql.js')
    | undefined;
  if (typeof initSqlJs !== 'function') {
    throw new Error(
      'Failed to load FTS5 sql.js loader: vendored sql-wasm.js did not export a function. ' +
        `exports keys: ${JSON.stringify(Object.keys(exports))}. ` +
        'Check vendor/sqljs-fts5/README.md and rebuild if needed.'
    );
  }
  return initSqlJs;
}
