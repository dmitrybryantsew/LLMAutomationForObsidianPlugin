"""Recursive file scanner with glob filtering.

Walks a source root, applies include/exclude globs, and returns file metadata.
Respects the allowlist — callers must call ``assert_allowed`` before scanning.
"""

from __future__ import annotations

import fnmatch
import os
from dataclasses import dataclass
from pathlib import Path

from .config import (
    DEFAULT_EXCLUDE_GLOBS,
    DEFAULT_INCLUDE_GLOBS,
    DEFAULT_MAX_FILE_BYTES,
)


@dataclass
class ScannedFile:
    relativePath: str
    absolutePath: str
    sizeBytes: int
    modifiedTime: float
    extension: str
    tooLarge: bool

    def to_dict(self) -> dict:
        return {
            "relativePath": self.relativePath,
            "absolutePath": self.absolutePath,
            "sizeBytes": self.sizeBytes,
            "modifiedTime": self.modifiedTime,
            "extension": self.extension,
            "tooLarge": self.tooLarge,
        }


@dataclass
class ScanResult:
    root: str
    totalFiles: int
    includedFiles: list[ScannedFile]
    skippedReasons: dict[str, int]

    def to_dict(self) -> dict:
        return {
            "root": self.root,
            "totalFiles": self.totalFiles,
            "includedFiles": [f.to_dict() for f in self.includedFiles],
            "skippedReasons": self.skippedReasons,
        }


def _match_any(path_str: str, patterns: list[str]) -> bool:
    """True if ``path_str`` matches any of the glob ``patterns``.

    Supports ``**`` recursive globs (e.g. ``**/*.md`` matches root-level
    ``README.md`` and nested ``docs/guide.md``). Also falls back to basename
    matching for simple patterns like ``*.md``.
    """
    from pathlib import PurePosixPath
    rel = PurePosixPath(path_str)

    for pattern in patterns:
        # Try pathlib's glob-style matching (handles ** correctly)
        if _glob_match(rel, pattern):
            return True
        # Also try basename for simple patterns like "*.md"
        basename = os.path.basename(path_str)
        if fnmatch.fnmatch(basename, pattern):
            return True
    return False


def _glob_match(path: "PurePosixPath", pattern: str) -> bool:
    """Match a path against a glob pattern supporting ``**``.

    ``**`` matches any number of path segments (including zero).
    ``*`` matches within a single path segment.
    """
    # Normalize pattern parts
    # Replace ** with a sentinel that matches any number of segments
    pattern_parts = pattern.split("/")
    path_parts = path.parts

    return _glob_match_parts(path_parts, pattern_parts)


def _glob_match_parts(path_parts: tuple[str, ...], pattern_parts: list[str]) -> bool:
    """Recursive glob matcher with ``**`` support."""
    if not pattern_parts:
        return not path_parts

    pat = pattern_parts[0]

    if pat == "**":
        # ** matches zero or more path segments
        # Try matching with 0, 1, 2, ... segments consumed
        for i in range(len(path_parts) + 1):
            if _glob_match_parts(path_parts[i:], pattern_parts[1:]):
                return True
        return False

    if not path_parts:
        return False

    # Match single segment with fnmatch
    if fnmatch.fnmatch(path_parts[0], pat):
        return _glob_match_parts(path_parts[1:], pattern_parts[1:])

    return False


def scan_source_root(
    root_path: str,
    include_globs: list[str] | None = None,
    exclude_globs: list[str] | None = None,
    max_file_bytes: int = DEFAULT_MAX_FILE_BYTES,
) -> ScanResult:
    """Scan ``root_path`` and return matching files with metadata.

    Args:
        root_path: Absolute path to scan. Must be allowlisted by the caller.
        include_globs: Glob patterns to include. Defaults to
            ``DEFAULT_INCLUDE_GLOBS``.
        exclude_globs: Glob patterns to exclude. Defaults to
            ``DEFAULT_EXCLUDE_GLOBS``.
        max_file_bytes: Files larger than this are returned with
            ``tooLarge=True`` (still listed so the plugin can show a warning).
    """
    includes = include_globs if include_globs is not None else DEFAULT_INCLUDE_GLOBS
    excludes = exclude_globs if exclude_globs is not None else DEFAULT_EXCLUDE_GLOBS

    root = Path(root_path).resolve()
    included: list[ScannedFile] = []
    skipped: dict[str, int] = {"excluded_by_glob": 0, "not_included": 0}
    total = 0

    if not root.exists() or not root.is_dir():
        return ScanResult(
            root=str(root),
            totalFiles=0,
            includedFiles=[],
            skippedReasons={"not_a_directory": 1},
        )

    for dirpath, dirnames, filenames in os.walk(root):
        # Prune excluded directories in-place so os.walk does not descend
        rel_dir = os.path.relpath(dirpath, root).replace(os.sep, "/")
        # Keep root itself
        if rel_dir == ".":
            # Prune dirnames for excluded dirs at the root level
            pruned = []
            for d in dirnames:
                rel = f"{rel_dir}/{d}".replace("./", "") if rel_dir != "." else d
                if _match_any(rel, excludes):
                    skipped["excluded_by_glob"] += 1
                else:
                    pruned.append(d)
            dirnames[:] = pruned
        else:
            if _match_any(rel_dir, excludes):
                skipped["excluded_by_glob"] += 1
                dirnames[:] = []
                continue

        for filename in filenames:
            total += 1
            rel = os.path.relpath(os.path.join(dirpath, filename), root).replace(os.sep, "/")

            if _match_any(rel, excludes):
                skipped["excluded_by_glob"] += 1
                continue

            if not _match_any(rel, includes):
                skipped["not_included"] += 1
                continue

            full = os.path.join(dirpath, filename)
            try:
                stat = os.stat(full)
            except OSError:
                skipped["stat_error"] = skipped.get("stat_error", 0) + 1
                continue

            included.append(ScannedFile(
                relativePath=rel,
                absolutePath=full,
                sizeBytes=stat.st_size,
                modifiedTime=stat.st_mtime,
                extension=Path(filename).suffix,
                tooLarge=stat.st_size > max_file_bytes,
            ))

    return ScanResult(
        root=str(root),
        totalFiles=total,
        includedFiles=included,
        skippedReasons=skipped,
    )
