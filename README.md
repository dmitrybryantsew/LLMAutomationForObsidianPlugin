# LLM Automation For Obsidian Plugin

Personal Obsidian plugin for LLM-assisted knowledge-base work: text generation, article and video summarization, transcript handling, quizzes, flashcards, and path/tag management.

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

Current baseline: `155` tests pass.

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
