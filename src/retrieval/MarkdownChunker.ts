import { RetrievalChunkDraft } from '../types/retrieval';
import { buildChunkId, fnv1aHash, normalizeRetrievalText } from './hashUtils';

const DEFAULT_MAX_SECTION_CHARS = 3000;
const DEFAULT_OVERLAP_PARAGRAPHS = 1;

export interface ChunkMarkdownInput {
  sourceId: string;
  path: string;
  content: string;
  modifiedTime: number;
  maxSectionChars?: number;
}

interface ParsedFrontmatter {
  body: string;
  tags: string[];
}

interface SectionDraft {
  headingPath: string[];
  lines: string[];
  startLine: number;
}

export function chunkMarkdown(input: ChunkMarkdownInput): RetrievalChunkDraft[] {
  const { tags, body } = parseFrontmatter(input.content);
  const lines = body.split('\n');
  const sections = splitIntoSections(lines);
  const basename = input.path.split('/').pop()?.replace(/\.md$/i, '') ?? input.path;
  const maxSectionChars = input.maxSectionChars ?? DEFAULT_MAX_SECTION_CHARS;
  const chunks: RetrievalChunkDraft[] = [];
  let ordinal = 0;

  for (const section of sections) {
    const sectionText = section.lines.join('\n').trim();
    if (!sectionText) {
      continue;
    }

    const headingLabel = section.headingPath.length > 0
      ? section.headingPath.join(' > ')
      : basename;
    const subChunks = splitLongSection(sectionText, maxSectionChars);

    for (const subChunk of subChunks) {
      const normalizedText = normalizeRetrievalText(subChunk.text);
      const links = extractLinks(subChunk.text);
      const contentHash = fnv1aHash(normalizedText);
      const displayText = `Note: ${basename}\nHeading: ${headingLabel}\n\n${subChunk.text}`;
      const id = buildChunkId({
        sourceId: input.sourceId,
        path: input.path,
        headingPath: section.headingPath,
        ordinal,
        contentHash,
      });

      chunks.push({
        id,
        sourceId: input.sourceId,
        path: input.path,
        basename,
        headingPath: section.headingPath.length > 0 ? section.headingPath : ['(preamble)'],
        startLine: section.startLine + subChunk.startOffset,
        endLine: section.startLine + subChunk.endOffset,
        text: displayText,
        normalizedText,
        tags,
        outboundLinks: links,
        contentHash,
        modifiedTime: input.modifiedTime,
      });
      ordinal++;
    }
  }

  return chunks;
}

function parseFrontmatter(content: string): ParsedFrontmatter {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { body: content, tags: [] };
  }

  const endMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!endMatch) {
    return { body: content, tags: [] };
  }

  const frontmatter = endMatch[1];
  const body = content.slice(endMatch[0].length);
  const tags = parseTagsFromFrontmatter(frontmatter);
  return { body, tags };
}

function parseTagsFromFrontmatter(frontmatter: string): string[] {
  const tags: string[] = [];
  const tagsLine = frontmatter.match(/^tags:\s*(.+)$/m);
  if (!tagsLine) {
    return tags;
  }

  const raw = tagsLine[1].trim();
  if (raw.startsWith('[')) {
    const matches = raw.match(/['"]?([^'"\],]+)['"]?/g);
    if (matches) {
      for (const match of matches) {
        const cleaned = match.replace(/[\[\],'"]/g, '').trim();
        if (cleaned) {
          tags.push(cleaned);
        }
      }
    }
    return tags;
  }

  raw.split(/[,\s]+/).forEach((tag) => {
    const cleaned = tag.replace(/^#/, '').trim();
    if (cleaned) {
      tags.push(cleaned);
    }
  });
  return tags;
}

function splitIntoSections(lines: string[]): SectionDraft[] {
  const sections: SectionDraft[] = [];
  let headingStack: string[] = [];
  let currentLines: string[] = [];
  let currentStartLine = 1;
  let inFence = false;

  const flush = (nextLineNumber: number) => {
    if (currentLines.length === 0) {
      return;
    }
    // Trim leading blank lines so startLine points at the first real content
    // and trailing blank lines so endLine points at the last real content.
    let startIdx = 0;
    while (startIdx < currentLines.length && currentLines[startIdx].trim() === '') {
      startIdx++;
    }
    let endIdx = currentLines.length - 1;
    while (endIdx >= startIdx && currentLines[endIdx].trim() === '') {
      endIdx--;
    }
    if (endIdx < startIdx) {
      currentLines = [];
      currentStartLine = nextLineNumber;
      return;
    }
    const trimmedLines = currentLines.slice(startIdx, endIdx + 1);
    sections.push({
      headingPath: [...headingStack],
      lines: trimmedLines,
      startLine: currentStartLine + startIdx,
    });
    currentLines = [];
    currentStartLine = nextLineNumber;
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line = lines[i];
    const fenceMatch = line.match(/^```/);
    if (fenceMatch) {
      inFence = !inFence;
      currentLines.push(line);
      continue;
    }

    if (!inFence) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (headingMatch) {
        flush(lineNumber);
        const level = headingMatch[1].length;
        const title = headingMatch[2].trim();
        headingStack = headingStack.slice(0, level - 1);
        headingStack[level - 1] = title;
        continue;
      }
    }

    if (currentLines.length === 0) {
      currentStartLine = lineNumber;
    }
    currentLines.push(line);
  }

  flush(lines.length + 1);
  return sections;
}

interface SubChunkSlice {
  text: string;
  startOffset: number;
  endOffset: number;
}

function splitLongSection(text: string, maxChars: number): SubChunkSlice[] {
  if (text.length <= maxChars) {
    const lineCount = text.split('\n').length;
    return [{ text, startOffset: 0, endOffset: Math.max(lineCount - 1, 0) }];
  }

  const paragraphs = text.split(/\n{2,}/);
  const slices: SubChunkSlice[] = [];
  let buffer: string[] = [];
  let bufferChars = 0;
  let consumedParagraphs = 0;

  const flushBuffer = () => {
    if (buffer.length === 0) {
      return;
    }
    const chunkText = buffer.join('\n\n');
    const prefixLines = text.slice(0, text.indexOf(chunkText)).split('\n').length - 1;
    const chunkLines = chunkText.split('\n').length;
    slices.push({
      text: chunkText,
      startOffset: Math.max(prefixLines, 0),
      endOffset: Math.max(prefixLines + chunkLines - 1, 0),
    });
  };

  for (const paragraph of paragraphs) {
    const nextLength = bufferChars + paragraph.length + (buffer.length > 0 ? 2 : 0);
    if (nextLength > maxChars && buffer.length > 0) {
      flushBuffer();
      const overlap = buffer.slice(-DEFAULT_OVERLAP_PARAGRAPHS);
      buffer = [...overlap, paragraph];
      bufferChars = buffer.join('\n\n').length;
      consumedParagraphs++;
      continue;
    }
    buffer.push(paragraph);
    bufferChars = nextLength;
    consumedParagraphs++;
  }

  flushBuffer();
  return slices.length > 0 ? slices : [{ text, startOffset: 0, endOffset: text.split('\n').length - 1 }];
}

function extractLinks(text: string): string[] {
  const links = new Set<string>();
  const wikiMatches = text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g);
  for (const match of wikiMatches) {
    links.add(match[1].trim());
  }
  const mdMatches = text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
  for (const match of mdMatches) {
    links.add(match[2].trim());
  }
  return [...links];
}
