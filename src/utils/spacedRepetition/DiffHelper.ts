export type DiffType = 'equal' | 'missing' | 'extra';

export interface DiffChunk {
  type: DiffType;
  text: string;
}

/**
 * Computes a character-level Longest Common Subsequence (LCS) diff between
 * the user's actual answer and the expected answer.
 *
 * - 'equal': Matching character sequence
 * - 'missing': Character sequence in expected answer that user omitted
 * - 'extra': Character sequence in user's answer that wasn't expected
 */
export function computeCharDiff(actual: string, expected: string): DiffChunk[] {
  const n = actual.length;
  const m = expected.length;

  if (n === 0 && m === 0) return [];
  if (n === 0) return [{ type: 'missing', text: expected }];
  if (m === 0) return [{ type: 'extra', text: actual }];

  // For longer strings (> 500 chars), fall back to word-level diff to prevent O(N*M) table growth
  if (n > 500 || m > 500) {
    return computeTokenDiff(actual, expected);
  }

  // 2D dynamic programming table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (actual[i - 1] === expected[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to recover diff
  let i = n;
  let j = m;
  const rawChunks: DiffChunk[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && actual[i - 1] === expected[j - 1]) {
      rawChunks.push({ type: 'equal', text: actual[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      // Expected char missing from actual
      rawChunks.push({ type: 'missing', text: expected[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      // Extra char in actual not in expected
      rawChunks.push({ type: 'extra', text: actual[i - 1] });
      i--;
    }
  }

  rawChunks.reverse();

  // Consolidate adjacent chunks of identical type
  return consolidateChunks(rawChunks);
}

/**
 * Computes a token/word-level diff for longer texts.
 */
export function computeTokenDiff(actual: string, expected: string): DiffChunk[] {
  const tokenRegex = /\s+|[^\s\w]+|\w+/g;
  const actualTokens = actual.match(tokenRegex) || [];
  const expectedTokens = expected.match(tokenRegex) || [];

  const n = actualTokens.length;
  const m = expectedTokens.length;

  if (n === 0 && m === 0) return [];
  if (n === 0) return [{ type: 'missing', text: expected }];
  if (m === 0) return [{ type: 'extra', text: actual }];

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (actualTokens[i - 1] === expectedTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = n;
  let j = m;
  const rawChunks: DiffChunk[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && actualTokens[i - 1] === expectedTokens[j - 1]) {
      rawChunks.push({ type: 'equal', text: actualTokens[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rawChunks.push({ type: 'missing', text: expectedTokens[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      rawChunks.push({ type: 'extra', text: actualTokens[i - 1] });
      i--;
    }
  }

  rawChunks.reverse();
  return consolidateChunks(rawChunks);
}

function consolidateChunks(chunks: DiffChunk[]): DiffChunk[] {
  const consolidated: DiffChunk[] = [];
  for (const chunk of chunks) {
    if (!chunk.text) continue;
    if (consolidated.length > 0 && consolidated[consolidated.length - 1].type === chunk.type) {
      consolidated[consolidated.length - 1].text += chunk.text;
    } else {
      consolidated.push({ ...chunk });
    }
  }
  return consolidated;
}

/**
 * Renders diff chunks into an Obsidian DOM container.
 */
export function renderDiffToElement(container: HTMLElement, chunks: DiffChunk[]): HTMLElement {
  const wrapper = container.createDiv({ cls: 'sr-diff-container' });

  for (const chunk of chunks) {
    const span = wrapper.createSpan({
      text: chunk.text,
      cls: `sr-diff-${chunk.type}`,
    });

    if (chunk.type === 'missing') {
      span.setAttribute('title', 'Missing from your answer');
    } else if (chunk.type === 'extra') {
      span.setAttribute('title', 'Extra in your answer');
    }
  }

  return wrapper;
}
