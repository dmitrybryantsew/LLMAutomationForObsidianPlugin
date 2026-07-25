"""Indexer: reads files from a scan result and produces ``ChunkDraft`` objects.

For each scanned file:
  - reads the content (respecting max_file_bytes)
  - dispatches to the appropriate chunker (Markdown vs plain text)
  - catches per-file errors so one bad file does not abort the whole batch

Returns an ``IndexResult`` with the chunks and per-file error counts.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .chunker import ChunkDraft, chunk_markdown, chunk_plain_text
from .config import DEFAULT_MAX_FILE_BYTES
from .scanner import ScannedFile


@dataclass
class IndexResult:
    sourceId: str
    root: str
    chunkCount: int
    fileCount: int
    errors: dict[str, int]
    chunks: list[ChunkDraft]

    def to_dict(self) -> dict:
        return {
            "sourceId": self.sourceId,
            "root": self.root,
            "chunkCount": self.chunkCount,
            "fileCount": self.fileCount,
            "errors": self.errors,
            "chunks": [c.to_dict() for c in self.chunks],
        }


def index_files(
    source_id: str,
    root_path: str,
    files: list[ScannedFile],
    max_file_bytes: int = DEFAULT_MAX_FILE_BYTES,
) -> IndexResult:
    """Read and chunk ``files`` under ``root_path``.

    Each file is dispatched to ``chunk_markdown`` for .md/.markdown files and
    ``chunk_plain_text`` for everything else. Files larger than
    ``max_file_bytes`` are skipped with a "too_large" error.
    """
    all_chunks: list[ChunkDraft] = []
    errors: dict[str, int] = {"too_large": 0, "read_error": 0, "empty": 0}
    file_count = 0

    for f in files:
        if f.tooLarge:
            errors["too_large"] += 1
            continue

        try:
            with open(f.absolutePath, "r", encoding="utf-8", errors="replace") as fh:
                content = fh.read(max_file_bytes + 1)
            if len(content) > max_file_bytes:
                errors["too_large"] += 1
                continue
        except OSError:
            errors["read_error"] += 1
            continue

        if not content.strip():
            errors["empty"] += 1
            continue

        ext = f.extension.lower()
        if ext in (".md", ".markdown"):
            chunks = chunk_markdown(
                source_id=source_id,
                path=f.relativePath,
                content=content,
                modified_time=f.modifiedTime,
            )
        elif ext in (".py", ".cs", ".ts", ".tsx", ".js", ".jsx"):
            from .code_chunker import chunk_code
            chunks = chunk_code(
                source_id=source_id,
                path=f.relativePath,
                content=content,
                modified_time=f.modifiedTime,
                extension=ext,
            )
        else:
            chunks = chunk_plain_text(
                source_id=source_id,
                path=f.relativePath,
                content=content,
                modified_time=f.modifiedTime,
            )

        all_chunks.extend(chunks)
        file_count += 1

    return IndexResult(
        sourceId=source_id,
        root=root_path,
        chunkCount=len(all_chunks),
        fileCount=file_count,
        errors=errors,
        chunks=all_chunks,
    )
