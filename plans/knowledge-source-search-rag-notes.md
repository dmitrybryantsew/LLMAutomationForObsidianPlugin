# Knowledge Source Search And RAG Notes

Date: 2026-06-10

## Goal

Let note chat answer with context from the active note plus optional external knowledge sources, such as Unity documentation, local downloaded docs, or web search results.

## Findings

- The useful shape is not a separate "search model". It is a set of chat context sources/tools that retrieve relevant text and inject it into the prompt.
- Offline docs should be the first target. Unity docs are a good fit because they can be downloaded and indexed locally, avoiding web latency and broken links.
- Ollama can provide local embeddings through its embed API, so we can build a local semantic index without depending on OpenAI/OpenRouter for retrieval.
- Web search should be optional and provider-based. Tavily is the easiest hosted API path. SearXNG is the open/self-hosted path, but JSON API access is most reliable with a local/private instance.

## Recommended Phases

## Phase 1: Offline Knowledge Sources

- Add settings for `Knowledge Sources`.
- Allow source types:
  - extracted docs folder
  - vault folder
  - single markdown/text/html file folder tree
- Create SQLite tables:
  - `knowledge_sources`
  - `knowledge_documents`
  - `knowledge_chunks`
- Parse and chunk `.md`, `.txt`, and basic `.html`.
- Generate embeddings with Ollama, for example `nomic-embed-text` or similar.
- Retrieve top matching chunks during note chat.

## Phase 2: Note Chat Integration

- Add toggles in the note chat side pane:
  - current note
  - linked vault notes
  - local docs
  - web search
- Add a compact source list under each answer.
- Inject retrieved chunks into the prompt with source labels:

```text
Current note:
...

Retrieved Unity docs:
[1] Renderer.enabled - docs path or URL
[2] MeshRenderer - docs path or URL

User question:
...
```

## Phase 3: Web Search

- Add `Search provider: none | Tavily | SearXNG`.
- Add provider settings:
  - Tavily API key
  - SearXNG base URL
  - max results
  - allowed domains
- Add useful domain presets:
  - `docs.unity3d.com`
  - `learn.unity.com`
  - `docs.microsoft.com`
  - project-specific docs domains

## Notes

- Search results should be treated as context, not truth. The answer should cite which retrieved chunk/result it used.
- Keep retrieval separate from generation so the same chat UI can use Ollama, OpenRouter, Chutes, or ZAI later.
- For Unity specifically, offline docs plus current note context will probably cover most daily questions better than live web search.
