import { describe, expect, it } from 'vitest';
import { initFts5SqlJs, readFts5WasmBinary } from '../helpers/fts5Wasm';

/**
 * Preflight spike: verify the vendored FTS5-enabled sql.js wasm works before
 * relying on it in RetrievalDatabase. See vendor/sqljs-fts5/README.md.
 *
 * The JS loader and wasm must come from the same build (Emscripten version
 * binding), so we use `initFts5SqlJs()` rather than `import initSqlJs from
 * 'sql.js'` (which is bound to the non-FTS5 npm wasm).
 */
describe('SQL.js FTS5 probe', () => {
  it('creates FTS5 table, matches rows, and survives export/reload', async () => {
    const initSqlJs = initFts5SqlJs();
    const wasmBinary = readFts5WasmBinary();
    const SQL = await initSqlJs({ wasmBinary });

    const runProbe = (db: InstanceType<typeof SQL.Database>) => {
      db.run('CREATE VIRTUAL TABLE fts_probe USING fts5(content)');
      db.run('INSERT INTO fts_probe(rowid, content) VALUES (?, ?)', [1, 'alpha retrieval test']);
      db.run('INSERT INTO fts_probe(rowid, content) VALUES (?, ?)', [2, 'beta unrelated note']);

      const rows = db.exec("SELECT rowid, content FROM fts_probe WHERE fts_probe MATCH 'retrieval'");
      expect(rows).toHaveLength(1);
      expect(rows[0].values).toEqual([[1, 'alpha retrieval test']]);

      // bm25() is FTS5-specific; verify it returns a numeric score.
      const bm = db.exec(
        "SELECT rowid, bm25(fts_probe) FROM fts_probe WHERE fts_probe MATCH 'retrieval'"
      );
      expect(bm).toHaveLength(1);
      expect(typeof bm[0].values[0][1]).toBe('number');
    };

    const db = new SQL.Database();
    runProbe(db);

    const exported = db.export();
    db.close();

    const reloaded = new SQL.Database(exported);
    const rowsAfterReload = reloaded.exec("SELECT rowid FROM fts_probe WHERE fts_probe MATCH 'retrieval'");
    expect(rowsAfterReload[0].values).toEqual([[1]]);
    reloaded.close();
  });
});
