"""Git metadata extraction via ``git`` subprocess.

Returns branch, commit SHA, origin URL, and dirty state for a repository root.
Fails gracefully (returns ``GitInfo`` with ``available=False``) if Git is not
installed or the path is not a repository.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass


@dataclass
class GitInfo:
    available: bool
    branch: str | None
    commitSha: str | None
    originUrl: str | None
    dirty: bool | None
    error: str | None = None

    def to_dict(self) -> dict:
        return {
            "available": self.available,
            "branch": self.branch,
            "commitSha": self.commitSha,
            "originUrl": self.originUrl,
            "dirty": self.dirty,
            "error": self.error,
        }


def _run_git(args: list[str], cwd: str, timeout: float = 10.0) -> str | None:
    """Run ``git`` with ``args`` in ``cwd``. Returns stdout or None on failure."""
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        if result.returncode != 0:
            return None
        return result.stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None


def get_git_info(root_path: str) -> GitInfo:
    """Return Git metadata for ``root_path``.

    Fails gracefully if Git is not installed or the path is not a repo.
    """
    branch = _run_git(["rev-parse", "--abbrev-ref", "HEAD"], root_path)
    if branch is None:
        return GitInfo(
            available=False,
            branch=None,
            commitSha=None,
            originUrl=None,
            dirty=None,
            error="git not available or not a repository",
        )

    commit_sha = _run_git(["rev-parse", "HEAD"], root_path)
    origin_url = _run_git(["config", "--get", "remote.origin.url"], root_path)
    status = _run_git(["status", "--porcelain"], root_path)

    return GitInfo(
        available=True,
        branch=branch,
        commitSha=commit_sha,
        originUrl=origin_url,
        dirty=bool(status),
    )
