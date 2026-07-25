"""Source-root allowlist enforcement.

The companion must never operate on arbitrary filesystem paths. Only paths
registered in the allowlist (managed by the plugin) can be scanned, indexed,
or queried for Git metadata. The allowlist is persisted to disk so the user
can audit it and so restarts do not lose state silently.

The allowlist file is JSON at ``STATE_DIR/allowlist.json`` and has the shape::

    {
      "version": 1,
      "roots": [
        { "id": "src-1", "path": "C:/code/my-repo", "addedAt": 1721769600 }
      ]
    }
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from .config import STATE_DIR


class AllowlistEntry(BaseModel):
    id: str
    path: str
    addedAt: int


class AllowlistFile(BaseModel):
    version: int = 1
    roots: list[AllowlistEntry] = []


def _allowlist_path() -> Path:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    return STATE_DIR / "allowlist.json"


def load_allowlist() -> AllowlistFile:
    """Load the allowlist from disk. Returns an empty allowlist if missing."""
    path = _allowlist_path()
    if not path.exists():
        return AllowlistFile()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return AllowlistFile.model_validate(data)
    except (json.JSONDecodeError, ValueError):
        return AllowlistFile()


def save_allowlist(allowlist: AllowlistFile) -> None:
    path = _allowlist_path()
    path.write_text(allowlist.model_dump_json(indent=2), encoding="utf-8")


def add_root(root_id: str, root_path: str) -> AllowlistFile:
    """Add a root to the allowlist. Idempotent on path."""
    allowlist = load_allowlist()
    resolved = str(Path(root_path).resolve())
    for entry in allowlist.roots:
        if entry.id == root_id or entry.path == resolved:
            return allowlist
    allowlist.roots.append(AllowlistEntry(id=root_id, path=resolved, addedAt=int(time.time())))
    save_allowlist(allowlist)
    return allowlist


def remove_root(root_id: str) -> AllowlistFile:
    allowlist = load_allowlist()
    allowlist.roots = [r for r in allowlist.roots if r.id != root_id]
    save_allowlist(allowlist)
    return allowlist


def list_roots() -> list[AllowlistEntry]:
    return load_allowlist().roots


def is_allowed(candidate_path: str) -> bool:
    """Return True if ``candidate_path`` is inside an allowlisted root.

    Resolves to an absolute path and checks that it is equal to or a child of
    a registered root. Symlinks are not followed for the comparison.
    """
    try:
        resolved = Path(candidate_path).resolve()
    except (OSError, ValueError):
        return False
    for entry in list_roots():
        root = Path(entry.path)
        if resolved == root:
            return True
        try:
            resolved.relative_to(root)
            return True
        except ValueError:
            continue
    return False


def assert_allowed(candidate_path: str) -> None:
    """Raise ``PermissionError`` if ``candidate_path`` is not allowlisted."""
    if not is_allowed(candidate_path):
        raise PermissionError(
            f"Path is not in the source-root allowlist: {candidate_path}"
        )


def reset_allowlist_for_tests() -> None:
    """Test helper: delete the allowlist file."""
    path = _allowlist_path()
    if path.exists():
        path.unlink()
