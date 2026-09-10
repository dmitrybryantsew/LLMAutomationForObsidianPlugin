# LLM Automation For Obsidian Plugin

Personal Obsidian plugin for LLM-assisted knowledge-base work: text generation, article and video summarization, transcript handling, quizzes, flashcards, spaced repetition, a hybrid knowledge-retrieval (RAG) engine over the vault, coding exercises, and path/tag management.

The repository name is `LLMAutomationForObsidianPlugin`, but the Obsidian plugin id intentionally remains `gpt4free-text-generator-plugin`. Keeping the id preserves compatibility with the existing installed plugin folder, local `data.json`, and local `transcripts.db`.

## What Is In This Repo

This repo contains the Obsidian plugin frontend/runtime code:

- TypeScript source in `src/`
- Obsidian manifest in `manifest.json`
- Build scripts and deploy helpers
- Vitest tests and Obsidian API mocks

It does not contain private runtime state or the server-side GeneralTools project.

## Server-Side Tools

Some workflows still use server-side/general tooling. That code lives separately:

- Local reference: `H:\Common\Python\GeneralTools`
- GitHub: https://github.com/dmitrybryantsew/GeneralTools

Keep this plugin repo focused on the Obsidian plugin. Treat GeneralTools as a separate dependency/tooling repo.

## Private Runtime Files

Never commit these files:

- `data.json` - Obsidian plugin settings and provider API keys.
- `transcripts.db` - local JSON transcript/summary database.

They belong in the installed Obsidian plugin directory and private backups only. The `.gitignore` is configured to keep them out of git.

## Build

Recommended PowerShell command:

```powershell
.\scripts\Build-Plugin.ps1
```

Equivalent npm command:

```powershell
npm install
npm run build
```

Build output is written to:

```text
build/gpt4free-text-generator-plugin/
```

The generated package currently contains:

- `main.js`
- `manifest.json`

## Build And Test

```powershell
.\scripts\Build-Plugin.ps1 -Test
```

or:

```powershell
npm test
```

Current baseline: `472` tests pass across 40 files (plus a separate pytest suite for the optional companion service).

## OpenAI-Compatible Proxy Provider

The plugin can use the local/VPS `openai-nim-proxy` as an additional text provider. In plugin settings:

- Set `Default LLM Provider` to `OpenAI Proxy`.
- Set `Proxy Base URL` to `http://your-server:3000` or `http://your-server:3000/v1`. The plugin normalizes either form to the OpenAI-compatible `/v1` API.
- Set `Proxy API Key` to the proxy server `PROXY_API_KEY`.
- Click `Refresh Proxy Models` to load model IDs such as `nim:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`, `ollama:<model>`, `chutes:<model>`, and `openrouter:<model>`.

The same settings page also has default request controls for text generation: temperature, max tokens, top-p, presence penalty, and frequency penalty. The text generator options modal can override these values per run.

For long video summaries, increase `Provider Timeout (seconds)` in the same settings section. The current default is 1200 seconds, and older saved values at or below 600 seconds are upgraded automatically on plugin load.

## Knowledge Retrieval (RAG)

The plugin has an optional hybrid retrieval engine over the vault, gated by
`Retrieval` → `Enable retrieval` in Settings. When enabled it indexes markdown notes
into a local SQLite database (FTS5 lexical search) and can optionally add semantic
search via local Ollama embeddings or remote Chutes embeddings, fused by reciprocal
rank. A `KnowledgeAgent` runs a bounded multi-step loop (search → optional reads →
answer with `[S1]` citations) for quick-context queries.

- `Search Knowledge Base` command — ranked, linkable lexical/hybrid results, no LLM required.
- `Quick Query (Current Note Context)` — LLM answer grounded in retrieved evidence.
- Lexical veto: when `embedding.lexicalVeto` is on (default), hybrid mode returns no
  hits if lexical search finds nothing, preventing semantic-only hallucinated matches.

The retrieval database uses a vendored FTS5-enabled `sql.js` wasm
(`vendor/sqljs-fts5/`), because the upstream npm `sql.js` build does not enable FTS5.
See `vendor/sqljs-fts5/README.md` for provenance and reproduction steps.

## Optional Companion Service

External/code-source indexing is handled by an optional Python FastAPI companion
(loopback only), used for sources outside the vault such as code repositories. It
performs tree-sitter chunking for code (Python, C#, TypeScript, JavaScript) and an
allowlist-enforced scan.

The companion code has **moved to GeneralTools** and is no longer in this repo:

```
H:\Common\Python\GeneralTools\bundled_projects\obsidian_companion
```

Start it from the GeneralTools GUI ("Obsidian Companion Server" plugin) or
manually:

```powershell
cd H:\Common\Python\GeneralTools\bundled_projects\obsidian_companion
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 43110
```

Enable it in Settings under `Retrieval` → `Companion` and set the endpoint
(default `http://127.0.0.1:43110`). See `companion/README.md` for details; the
pytest suite lives with the code in GeneralTools.

## Deploy To Obsidian

Set the target install directory and deploy:

```powershell
.\scripts\Build-Plugin.ps1 -Deploy -PluginDir "H:\Common\foam\knowledgeBase\.obsidian\plugins\gpt4free-text-generator-plugin"
```

You can also use an environment variable:

```powershell
$env:OBSIDIAN_PLUGIN_DIR = "H:\Common\foam\knowledgeBase\.obsidian\plugins\gpt4free-text-generator-plugin"
.\scripts\Build-Plugin.ps1 -Deploy
```

Deploy copies only generated plugin files from `build/gpt4free-text-generator-plugin/`. It does not delete or overwrite local runtime files such as `data.json` and `transcripts.db`.

## In-Vault Command Cheatsheet

Run this Obsidian command from the command palette:

```text
Create/Update Plugin Commands Cheatsheet
```

It creates or refreshes this generated vault note:

```text
LLM Automation Plugin Commands.md
```

The command list is generated from `src/commandCatalog.ts`, so update that catalog when adding or removing plugin commands.

## GitHub Setup

After creating the GitHub repository:

```powershell
git remote add origin https://github.com/dmitrybryantsew/LLMAutomationForObsidianPlugin.git
git push -u origin main
```

Before making the repo public, rotate any API keys that were ever stored in the old plugin `data.json`.

## Useful Commands

```powershell
npm run clean
npm run build
npm test
npm run deploy
npm run build:ps
npm run deploy:ps
```
