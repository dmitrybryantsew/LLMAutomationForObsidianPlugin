"""Chunking for companion-side indexing.

Produces ``ChunkDraft`` dictionaries that match the plugin's
``RetrievalChunkDraft`` interface so the plugin can insert them directly into
its existing FTS5 + vector store without conversion.

The MVP supports Markdown chunking (ported from the plugin's
``MarkdownChunker.ts``) and a simple line-window chunker for plain text files.
Code AST chunking (tree-sitter) is deferred to P4-3.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# FNV-1a hash — must match the plugin's ``hashUtils.ts`` exactly so that
# content IDs and content hashes are stable across the TypeScript/Python
# boundary.
# ---------------------------------------------------------------------------

FNV_OFFSET = 0x811C9DC5
FNV_PRIME = 0x01000193
MASK32 = 0xFFFFFFFF


def fnv1a_hash(input_str: str) -> str:
    """FNV-1a 32-bit hash. Returns 8-char hex string.

    Must match ``src/retrieval/hashUtils.ts`` ``fnv1aHash``.
    """
    h = FNV_OFFSET
    for ch in input_str:
        h ^= ord(ch)
        h = (h * FNV_PRIME) & MASK32
    return format(h, "08x")


def normalize_retrieval_text(text: str) -> str:
    """Normalize text for FTS indexing. Must match plugin's ``normalizeRetrievalText``."""
    import unicodedata
    normalized = unicodedata.normalize("NFKC", text)
    normalized = normalized.replace("\r\n", "\n").replace("\r", "\n")
    normalized = re.sub(r"[ \t]+", " ", normalized)
    return normalized.strip().lower()


def build_chunk_id(source_id: str, path: str, heading_path: list[str], ordinal: int, content_hash: str) -> str:
    """Build a deterministic chunk ID. Must match plugin's ``buildChunkId``."""
    heading = ">".join(heading_path)
    return fnv1a_hash(f"{source_id}|{path}|{heading}|{ordinal}|{content_hash}")


# ---------------------------------------------------------------------------
# ChunkDraft — matches the plugin's ``RetrievalChunkDraft`` interface.
# ---------------------------------------------------------------------------

@dataclass
class ChunkDraft:
    id: str
    sourceId: str
    path: str
    basename: str
    headingPath: list[str]
    startLine: int
    endLine: int
    text: str
    normalizedText: str
    tags: list[str]
    outboundLinks: list[str]
    contentHash: str
    modifiedTime: float

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "sourceId": self.sourceId,
            "path": self.path,
            "basename": self.basename,
            "headingPath": self.headingPath,
            "startLine": self.startLine,
            "endLine": self.endLine,
            "text": self.text,
            "normalizedText": self.normalizedText,
            "tags": self.tags,
            "outboundLinks": self.outboundLinks,
            "contentHash": self.contentHash,
            "modifiedTime": self.modifiedTime,
        }


# ---------------------------------------------------------------------------
# Markdown chunking — ported from ``MarkdownChunker.ts``.
# ---------------------------------------------------------------------------

DEFAULT_MAX_SECTION_CHARS = 3000
DEFAULT_OVERLAP_PARAGRAPHS = 1


def chunk_markdown(
    source_id: str,
    path: str,
    content: str,
    modified_time: float,
    max_section_chars: int = DEFAULT_MAX_SECTION_CHARS,
) -> list[ChunkDraft]:
    """Chunk a Markdown file. Ported from ``src/retrieval/MarkdownChunker.ts``."""
    tags, body = _parse_frontmatter(content)
    lines = body.split("\n")
    sections = _split_into_sections(lines)
    basename = re.sub(r"\.md$", "", path.rsplit("/", 1)[-1]) if "/" in path else re.sub(r"\.md$", "", path, flags=re.IGNORECASE)
    if not basename:
        basename = path

    chunks: list[ChunkDraft] = []
    ordinal = 0

    for section in sections:
        section_text = "\n".join(section["lines"]).strip()
        if not section_text:
            continue

        heading_label = " > ".join(section["headingPath"]) if section["headingPath"] else basename
        sub_chunks = _split_long_section(section_text, max_section_chars)

        for sub in sub_chunks:
            normalized_text = normalize_retrieval_text(sub["text"])
            links = _extract_links(sub["text"])
            content_hash = fnv1a_hash(normalized_text)
            display_text = f"Note: {basename}\nHeading: {heading_label}\n\n{sub['text']}"
            chunk_id = build_chunk_id(source_id, path, section["headingPath"], ordinal, content_hash)

            heading_path = section["headingPath"] if section["headingPath"] else ["(preamble)"]
            chunks.append(ChunkDraft(
                id=chunk_id,
                sourceId=source_id,
                path=path,
                basename=basename,
                headingPath=heading_path,
                startLine=section["startLine"] + sub["startOffset"],
                endLine=section["startLine"] + sub["endOffset"],
                text=display_text,
                normalizedText=normalized_text,
                tags=tags,
                outboundLinks=links,
                contentHash=content_hash,
                modifiedTime=modified_time,
            ))
            ordinal += 1

    return chunks


def _parse_frontmatter(content: str) -> tuple[list[str], str]:
    """Parse YAML frontmatter. Returns (tags, body)."""
    if not content.startswith("---\n") and not content.startswith("---\r\n"):
        return [], content

    match = re.match(r"^---\r?\n([\s\S]*?)\r?\n---\r?\n?", content)
    if not match:
        return [], content

    frontmatter = match.group(1)
    body = content[match.end():]
    tags = _parse_tags_from_frontmatter(frontmatter)
    return tags, body


def _parse_tags_from_frontmatter(frontmatter: str) -> list[str]:
    tags: list[str] = []
    match = re.search(r"^tags:\s*(.+)$", frontmatter, re.MULTILINE)
    if not match:
        return tags

    raw = match.group(1).strip()
    if raw.startswith("["):
        for m in re.finditer(r"['\"]?([^'\"\],]+)['\"]?", raw):
            cleaned = re.sub(r"[\[\],'\" ]", "", m.group(1)).strip()
            if cleaned:
                tags.append(cleaned)
        return tags

    for tag in re.split(r"[,\s]+", raw):
        cleaned = re.sub(r"^#", "", tag).strip()
        if cleaned:
            tags.append(cleaned)
    return tags


def _split_into_sections(lines: list[str]) -> list[dict]:
    sections: list[dict] = []
    heading_stack: list[str] = []
    current_lines: list[str] = []
    current_start_line = 1
    in_fence = False

    def flush(next_line_number: int) -> None:
        nonlocal current_lines, current_start_line
        if not current_lines:
            return
        start_idx = 0
        while start_idx < len(current_lines) and current_lines[start_idx].strip() == "":
            start_idx += 1
        end_idx = len(current_lines) - 1
        while end_idx >= start_idx and current_lines[end_idx].strip() == "":
            end_idx -= 1
        if end_idx < start_idx:
            current_lines = []
            current_start_line = next_line_number
            return
        trimmed = current_lines[start_idx:end_idx + 1]
        sections.append({
            "headingPath": list(heading_stack),
            "lines": trimmed,
            "startLine": current_start_line + start_idx,
        })
        current_lines = []
        current_start_line = next_line_number

    for i, line in enumerate(lines):
        line_number = i + 1
        if re.match(r"^```", line):
            in_fence = not in_fence
            current_lines.append(line)
            continue

        if not in_fence:
            heading_match = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
            if heading_match:
                flush(line_number)
                level = len(heading_match.group(1))
                title = heading_match.group(2).strip()
                heading_stack = heading_stack[:level - 1]
                while len(heading_stack) < level:
                    heading_stack.append("")
                heading_stack[level - 1] = title
                continue

        if not current_lines:
            current_start_line = line_number
        current_lines.append(line)

    flush(len(lines) + 1)
    return sections


def _split_long_section(text: str, max_chars: int) -> list[dict]:
    """Split a long section into sub-chunks. Returns list of {text, startOffset, endOffset}."""
    if len(text) <= max_chars:
        line_count = text.count("\n") + 1
        return [{"text": text, "startOffset": 0, "endOffset": max(line_count - 1, 0)}]

    paragraphs = re.split(r"\n{2,}", text)
    slices: list[dict] = []
    buffer: list[str] = []
    buffer_chars = 0

    def flush_buffer() -> None:
        nonlocal buffer
        if not buffer:
            return
        chunk_text = "\n\n".join(buffer)
        prefix_text = text[:text.find(chunk_text)]
        prefix_lines = prefix_text.count("\n")
        chunk_lines = chunk_text.count("\n") + 1
        slices.append({
            "text": chunk_text,
            "startOffset": max(prefix_lines, 0),
            "endOffset": max(prefix_lines + chunk_lines - 1, 0),
        })

    for paragraph in paragraphs:
        next_length = buffer_chars + len(paragraph) + (2 if buffer else 0)
        if next_length > max_chars and buffer:
            flush_buffer()
            overlap = buffer[-DEFAULT_OVERLAP_PARAGRAPHS:]
            buffer = overlap + [paragraph]
            buffer_chars = len("\n\n".join(buffer))
            continue
        buffer.append(paragraph)
        buffer_chars = next_length

    flush_buffer()
    return slices if slices else [{"text": text, "startOffset": 0, "endOffset": text.count("\n")}]


def _extract_links(text: str) -> list[str]:
    links: set[str] = set()
    for m in re.finditer(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]", text):
        links.add(m.group(1).strip())
    for m in re.finditer(r"\[([^\]]+)\]\(([^)]+)\)", text):
        links.add(m.group(2).strip())
    return list(links)


# ---------------------------------------------------------------------------
# Plain-text chunking — for non-Markdown files (code stubs, READMEs, etc.)
# ---------------------------------------------------------------------------

def chunk_plain_text(
    source_id: str,
    path: str,
    content: str,
    modified_time: float,
    max_chars: int = DEFAULT_MAX_SECTION_CHARS,
) -> list[ChunkDraft]:
    """Chunk a plain-text file by line windows.

    Used for non-Markdown files in the MVP. P4-3 will add tree-sitter chunking
    for code. This produces a single chunk per file (or multiple if very long).
    """
    basename = path.rsplit("/", 1)[-1] if "/" in path else path
    if not basename:
        basename = path

    chunks: list[ChunkDraft] = []
    lines = content.split("\n")
    ordinal = 0

    # If the file is small enough, emit a single chunk
    if len(content) <= max_chars:
        normalized_text = normalize_retrieval_text(content)
        content_hash = fnv1a_hash(normalized_text)
        display_text = f"File: {basename}\n\n{content}"
        chunk_id = build_chunk_id(source_id, path, ["(file)"], ordinal, content_hash)
        line_count = len(content.split("\n"))
        if content.endswith("\n"):
            line_count -= 1
        chunks.append(ChunkDraft(
            id=chunk_id,
            sourceId=source_id,
            path=path,
            basename=basename,
            headingPath=["(file)"],
            startLine=1,
            endLine=max(line_count, 1),
            text=display_text,
            normalizedText=normalized_text,
            tags=[],
            outboundLinks=[],
            contentHash=content_hash,
            modifiedTime=modified_time,
        ))
        return chunks

    # Split by line windows with overlap
    lines_per_chunk = max_chars // 80  # rough estimate: 80 chars/line
    if lines_per_chunk < 10:
        lines_per_chunk = 10

    offset = 0
    while offset < len(lines):
        window = lines[offset:offset + lines_per_chunk]
        window_text = "\n".join(window)
        if not window_text.strip():
            offset += lines_per_chunk
            continue

        normalized_text = normalize_retrieval_text(window_text)
        content_hash = fnv1a_hash(normalized_text)
        start_line = offset + 1
        end_line = min(offset + len(window), len(lines))
        display_text = f"File: {basename}\nLines: {start_line}-{end_line}\n\n{window_text}"
        chunk_id = build_chunk_id(source_id, path, ["(file)"], ordinal, content_hash)

        chunks.append(ChunkDraft(
            id=chunk_id,
            sourceId=source_id,
            path=path,
            basename=basename,
            headingPath=["(file)"],
            startLine=start_line,
            endLine=end_line,
            text=display_text,
            normalizedText=normalized_text,
            tags=[],
            outboundLinks=[],
            contentHash=content_hash,
            modifiedTime=modified_time,
        ))
        ordinal += 1
        offset += lines_per_chunk

    return chunks
