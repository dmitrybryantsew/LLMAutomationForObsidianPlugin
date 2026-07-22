# sql.js with FTS5 (vendored build)

This directory contains a custom build of [sql.js](https://github.com/sql-js/sql.js)
with **FTS5 enabled**, which the upstream npm package does **not** include.

## Why

`RetrievalDatabase.ts` uses SQLite FTS5 (`CREATE VIRTUAL TABLE … USING fts5(...)`
and `bm25(...)`) for ranked lexical search. The official `sql.js` Makefile only
enables `-DSQLITE_ENABLE_FTS3`, so the npm `sql-wasm.wasm` raises
`no such module: fts5` at runtime. Obsidian bundles the same npm wasm, so the
plugin would fail in real Obsidian too.

## Provenance

Built from official sources:

- **sql.js source**: `https://github.com/sql-js/sql.js` at tag `v1.14.1`
- **SQLite amalgamation**: `3.49.1` (downloaded by the sql.js Makefile from
  `https://sqlite.org/2025/sqlite-amalgamation-3490100.zip`)
- **Emscripten**: `6.0.3`
- **Makefile change**: added `-DSQLITE_ENABLE_FTS5` to `SQLITE_COMPILATION_FLAGS`
  (one line). No other source changes.

## Files

| File | Purpose |
| --- | --- |
| `sql-wasm.js` | sql.js loader (Node + general use) |
| `sql-wasm.wasm` | WebAssembly binary with FTS5 compiled in |

## Reproducing

```sh
git clone https://github.com/sql-js/sql.js && cd sql.js && git checkout v1.14.1
# In Makefile, add -DSQLITE_ENABLE_FTS5 to SQLITE_COMPILATION_FLAGS
source <emsdk>/emsdk_env.sh
make dist/sql-wasm.js
cp dist/sql-wasm.js dist/sql-wasm.wasm <plugin>/vendor/sqljs-fts5/
```

## Verification

The FTS5 probe in `tests/unit/Fts5Probe.test.ts` loads this wasm and verifies:
- `CREATE VIRTUAL TABLE … USING fts5(content)` succeeds
- `MATCH` returns only matching rows
- `bm25()` produces a numeric score
- export → close → reload from bytes preserves the FTS5 index

## License

sql.js is MIT licensed; SQLite is public domain. See
https://github.com/sql-js/sql.js/blob/master/LICENSE.
