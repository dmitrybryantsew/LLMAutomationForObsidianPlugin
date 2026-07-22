/**
 * Deterministic FNV-1a hash for content IDs and change detection.
 */
export function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export async function sha256Hex(input: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    const bytes = new TextEncoder().encode(input);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  return fnv1aHash(input);
}

export function normalizeRetrievalText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .toLowerCase();
}

export function buildChunkId(parts: {
  sourceId: string;
  path: string;
  headingPath: string[];
  ordinal: number;
  contentHash: string;
}): string {
  const heading = parts.headingPath.join('>');
  return fnv1aHash(`${parts.sourceId}|${parts.path}|${heading}|${parts.ordinal}|${parts.contentHash}`);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
