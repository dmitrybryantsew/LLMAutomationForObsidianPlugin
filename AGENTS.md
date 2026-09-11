# Agent Entry Point

Read `docs/PROJECT-MAP.md` first — it is the single source of truth for:

- Repo layout and every subsystem's file map (`src/retrieval/`, modals, utils)
- The companion Python service (lives in `H:\Common\Python\GeneralTools\bundled_projects\obsidian_companion`, NOT this repo — single-copy rule)
- Runtime port topology (43110 companion, 8005 llama-server embeddings, 8001 gpt4freeTest, 11434 Ollama)
- Vault deployment target and build/deploy commands
- Plan docs index (`plans/`), including the active feature plan
  `plans/12-index-external-companion-sources.md` (index external codebases
  like `pfe-game` into the retrieval DB — chunks verified, plugin wiring pending)
- Test commands (vitest, pytest) and known pre-existing test failure
- Secrets safety (never commit `.env`, proxy clones, GGUFs)
- Where to make common changes (add provider, add command, schema changes)

Note: `docs/` and `plans/` are intentionally gitignored (local working
notes); they exist only on this machine, so this file is the durable
pointer to them.
