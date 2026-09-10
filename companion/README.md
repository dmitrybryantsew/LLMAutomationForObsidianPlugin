# Companion service — MOVED

The Python companion service (FastAPI scanner/indexer/tree-sitter chunker for
the plugin's external-source retrieval) now lives in **GeneralTools**:

```
H:\Common\Python\GeneralTools\bundled_projects\obsidian_companion
```

It is managed by the GeneralTools GUI plugin
`app/plugins/obsidian_companion_launcher` ("Obsidian Companion Server"),
which creates a managed venv under `app_data/venvs/obsidian_companion_*`,
keeps allowlist state in `app_data/companion-state`, and runs the server on
`http://127.0.0.1:43110`.

This folder intentionally contains **no code** — keep a single copy in
GeneralTools to avoid divergent duplicates.

Nothing changed on the plugin side: the endpoint default stays
`http://127.0.0.1:43110` (`src/constants.ts`, `retrieval.companion.endpoint`),
so no plugin settings or protocol changes are required.

The pytest suite (68 tests) moved with the code and passes from the new
location.
