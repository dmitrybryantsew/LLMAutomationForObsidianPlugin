/**
 * Helpers for dealing with reasoning / thinking models (DeepSeek-R1, QwQ,
 * Nemotron reasoning, o1/o3 style, Qwen3 thinking variants, ...).
 *
 * These models may emit chain-of-thought before the actual answer, either in
 * the message content (wrapped in tags or `# Thinking ...` headers) or in a
 * separate `reasoning` / `reasoning_content` response field. JSON extraction
 * must ignore that noise.
 */

const THINKING_MODEL_PATTERNS: RegExp[] = [
    /(^|[^a-z0-9])(o[134])([^a-z0-9]|$)/i,      // o1 / o3 / o4-mini style ids
    /reasoning/i,
    /reasoner/i,
    /thinking/i,
    /(^|[^a-z0-9])think([^a-z0-9]|$)/i,          // "think" as a separate word (e.g. "thinking", "-think")
    /(^|[^a-z0-9])r1([^a-z0-9]|$)/i,            // deepseek-r1, qwen-r1 style ids
    /qwq/i,
    /(^|[^a-z0-9])kimi-k2(\.[5-9]|-thinking)/i,  // Kimi K2.5+/K2-thinking line: always emits reasoning tokens (verified live: reasoning_tokens on every response)
    /(^|[^a-z0-9])glm-(4\.5|4\.6|5)([^0-9.]|$)/i, // GLM 4.5+ default to thinking mode (5.1 etc. are configurable; treat base 4.5/4.6/5 as thinking)
    /(^|[^a-z0-9])qwen3\.[5-9]/i,                // Qwen3.5+ gateway models: thinking capability always on (verified live: reasoning_content on every response)
];

export function isThinkingModel(modelId: string): boolean {
    const model = (modelId ?? '').trim();
    if (!model) {
        return false;
    }
    return THINKING_MODEL_PATTERNS.some((pattern) => pattern.test(model));
}

/**
 * Remove chain-of-thought noise from a raw model response so that only the
 * final answer text remains, <thinking>...</thinking>, <summary>...</summary>
 *   - Qwen3 empty think blocks: "<think>\n\n</think>\n\n"
 *   - markdown "# Thinking" / "# Reasoning" sections up to next heading
 *   - Kimi-style "<|...|>" marker lines (removed entirely)
 */
export function stripThinkingTags(rawText: string): string {
    let text = rawText ?? '';

    text = text.replace(/<(think|thinking|thought|summary)>([\s\S]*?)<\/\1>/gi, '');
    // Unterminated opening tag: drop everything after it (stream cut off inside reasoning).
    text = text.replace(/<(think|thinking|thought|summary)>[\s\S]*$/gi, '');
    text = text.replace(/<\|(?:begin|end)_of_thought\|>/gi, '');
    text = text.replace(/<\|[a-z_]*\|>/gi, '');

    // Markdown "Thinking" / "Reasoning" header sections.
    text = text.replace(/^#{1,6}\s*(thinking|reasoning|thought process|chain of thought|internal monologue)\s*:?\r?\n[\s\S]*?(?=\n#{1,6}\s|$)/gim, '');

    // Leading "Thinking..." / "Let me think..." chatter before a JSON answer.
    text = text.replace(/^(?:thinking|let me think|let's think|thoughts?)\b[^{\n]*(?=\{|$)/gim, '');

    return text.trim();
}

/** True when a model list entry should sink to the bottom of the dropdown. */
export function compareModelEntries(a: string, b: string): number {
    const aThinking = isThinkingModel(a) ? 1 : 0;
    const bThinking = isThinkingModel(b) ? 1 : 0;
    if (aThinking !== bThinking) {
        return aThinking - bThinking;
    }
    return a.localeCompare(b);
}

/** Sort a model id list: non-thinking first, alphabetical inside groups. */
export function sortModelsByThinking(models: string[]): string[] {
    return [...models].sort(compareModelEntries);
}

/** Dropdown label for a model id, flagging thinking variants. */
export function modelLabel(modelId: string, displayName?: string): string {
    const base = displayName?.trim() || modelId;
    return isThinkingModel(modelId) ? `${base} (thinking)` : base;
}
