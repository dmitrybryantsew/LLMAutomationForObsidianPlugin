# LLM Automation For Obsidian Plugin

Personal Obsidian plugin for LLM-assisted knowledge-base work: text generation, article/video summarization, transcript handling, quizzes, flashcards, and path/tag management.

The repository name is `LLMAutomationForObsidianPlugin`, but the Obsidian plugin id is intentionally still `gpt4free-text-generator-plugin` so existing local settings and database files keep working.

## Server-Side Tools

Some workflows still depend on server-side/general tooling. That server is not bundled in this plugin repository. Keep it in the separate GeneralTools project:

- Local reference: `H:\Common\Python\GeneralTools`
- GitHub reference: https://github.com/dmitrybryantsew/GeneralTools

## Private Runtime Files

Do not commit these files:

- `data.json` - Obsidian plugin settings and provider API keys.
- `transcripts.db` - local JSON transcript/summary database.

They belong in the installed Obsidian plugin directory and in private backups only.

## Build

```powershell
npm install
npm run build
```

Build output is written to:

```text
build/gpt4free-text-generator-plugin/
```

## Deploy To Obsidian

Set the target install directory and deploy:

```powershell
$env:OBSIDIAN_PLUGIN_DIR = "H:\Common\foam\knowledgeBase\.obsidian\plugins\gpt4free-text-generator-plugin"
npm run build
npm run deploy
```

Deploy copies only generated plugin files such as `main.js` and `manifest.json`. It does not delete or overwrite local runtime files like `data.json` and `transcripts.db`.

## Current Test Status

```powershell
npm test
```

Some tests are known to be out of sync with the current provider implementation because the code now uses Obsidian `requestUrl`, while older tests mock a fetch-style path. Build currently matters more for preserving the working plugin; fix the test harness before treating tests as the regression gate.

## Publishing Notes

Before pushing this repository publicly:

- Rotate any API keys that were ever stored in the old plugin `data.json`.
- Confirm `git status --short` does not include runtime state or build output.
- Run a secret scan for `sk-`, `Bearer`, `apiKey`, `openRouterApiKey`, `chutesApiKey`, and `zaiApiKey`.
