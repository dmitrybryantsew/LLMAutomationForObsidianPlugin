"""FastAPI companion service for the Obsidian retrieval plugin.

Run with::

    cd companion
    pip install -r requirements.txt
    python -m uvicorn app.main:app --host 127.0.0.1 --port 43110

Or::

    python -m app.main
"""

from __future__ import annotations

import sys

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .allowlist import (
    add_root,
    assert_allowed,
    list_roots,
    load_allowlist,
    remove_root,
)
from .config import (
    DEFAULT_EXCLUDE_GLOBS,
    DEFAULT_INCLUDE_GLOBS,
    DEFAULT_MAX_FILE_BYTES,
    HOST,
    PORT,
    PROTOCOL_VERSION,
)
from .git_info import get_git_info
from .indexer import index_files
from .scanner import scan_source_root

app = FastAPI(
    title="Obsidian Retrieval Companion",
    version=PROTOCOL_VERSION,
    description="Local companion service for external source indexing. Loopback only.",
)


# ---------------------------------------------------------------------------
# Pydantic request/response models
# ---------------------------------------------------------------------------

class ScanRequest(BaseModel):
    rootPath: str
    includeGlobs: list[str] | None = None
    excludeGlobs: list[str] | None = None
    maxFileBytes: int = DEFAULT_MAX_FILE_BYTES


class GitInfoRequest(BaseModel):
    rootPath: str


class IndexRequest(BaseModel):
    sourceId: str
    rootPath: str
    files: list[dict] | None = None  # ScannedFile dicts; if None, scan rootPath
    includeGlobs: list[str] | None = None
    excludeGlobs: list[str] | None = None
    maxFileBytes: int = DEFAULT_MAX_FILE_BYTES


class AllowlistAddRequest(BaseModel):
    id: str
    path: str


class AllowlistRemoveRequest(BaseModel):
    id: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/status")
async def status() -> dict:
    """Health check. Returns version, capabilities, and allowlist size."""
    roots = list_roots()
    return {
        "running": True,
        "version": PROTOCOL_VERSION,
        "capabilities": ["scan", "git-info", "index", "allowlist"],
        "allowlistSize": len(roots),
        "defaultIncludeGlobs": DEFAULT_INCLUDE_GLOBS,
        "defaultExcludeGlobs": DEFAULT_EXCLUDE_GLOBS,
    }


@app.get("/sources")
async def get_sources() -> dict:
    """List allowlisted source roots."""
    roots = list_roots()
    return {
        "roots": [r.model_dump() for r in roots],
    }


@app.post("/allowlist/add")
async def allowlist_add(req: AllowlistAddRequest) -> dict:
    """Add a root path to the source allowlist."""
    import os
    if not os.path.isdir(req.path):
        raise HTTPException(status_code=400, detail=f"Path does not exist or is not a directory: {req.path}")
    allowlist = add_root(req.id, req.path)
    return {"roots": [r.model_dump() for r in allowlist.roots]}


@app.post("/allowlist/remove")
async def allowlist_remove(req: AllowlistRemoveRequest) -> dict:
    """Remove a root from the allowlist by ID."""
    allowlist = remove_root(req.id)
    return {"roots": [r.model_dump() for r in allowlist.roots]}


@app.post("/source/scan")
async def source_scan(req: ScanRequest) -> dict:
    """Scan a source root and return matching files with metadata.

    The root must be allowlisted. If not, returns 403.
    """
    try:
        assert_allowed(req.rootPath)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))

    result = scan_source_root(
        root_path=req.rootPath,
        include_globs=req.includeGlobs,
        exclude_globs=req.excludeGlobs,
        max_file_bytes=req.maxFileBytes,
    )
    return result.to_dict()


@app.post("/source/git-info")
async def source_git_info(req: GitInfoRequest) -> dict:
    """Return Git metadata for a source root.

    The root must be allowlisted. If not, returns 403.
    """
    try:
        assert_allowed(req.rootPath)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))

    info = get_git_info(req.rootPath)
    return info.to_dict()


@app.post("/source/index")
async def source_index(req: IndexRequest) -> dict:
    """Read and chunk files from a source root.

    If ``files`` is provided, those ScannedFile dicts are used directly.
    Otherwise, the root is scanned first (using include/exclude globs).

    The root must be allowlisted. Returns ``ChunkDraft[]`` matching the
    plugin's ``RetrievalChunkDraft`` interface.
    """
    try:
        assert_allowed(req.rootPath)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))

    if req.files is not None:
        from .scanner import ScannedFile
        scanned = [
            ScannedFile(
                relativePath=f["relativePath"],
                absolutePath=f["absolutePath"],
                sizeBytes=f["sizeBytes"],
                modifiedTime=f["modifiedTime"],
                extension=f["extension"],
                tooLarge=f["tooLarge"],
            )
            for f in req.files
        ]
    else:
        scan_result = scan_source_root(
            root_path=req.rootPath,
            include_globs=req.includeGlobs,
            exclude_globs=req.excludeGlobs,
            max_file_bytes=req.maxFileBytes,
        )
        scanned = scan_result.includedFiles

    result = index_files(
        source_id=req.sourceId,
        root_path=req.rootPath,
        files=scanned,
        max_file_bytes=req.maxFileBytes,
    )
    return result.to_dict()


def main() -> None:
    """Entry point for ``python -m app.main``."""
    import uvicorn
    print(f"Starting Obsidian Retrieval Companion on http://{HOST}:{PORT}")
    print(f"Protocol version: {PROTOCOL_VERSION}")
    print(f"State directory: {load_allowlist().__class__.__name__}")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    main()
