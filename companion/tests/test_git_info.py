"""Tests for the Git metadata extractor."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from app.git_info import get_git_info


def _git_available() -> bool:
    return shutil.which("git") is not None


class TestGitInfo:
    def test_not_a_repo(self, allowlisted_root):
        info = get_git_info(allowlisted_root)
        assert not info.available
        assert info.error is not None

    def test_real_repo(self, allowlisted_root):
        if not _git_available():
            return  # skip if git not installed
        # Initialize a git repo in the temp root
        subprocess.run(["git", "init"], cwd=allowlisted_root, capture_output=True, check=True)
        subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=allowlisted_root, capture_output=True)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=allowlisted_root, capture_output=True)
        subprocess.run(["git", "add", "."], cwd=allowlisted_root, capture_output=True)
        subprocess.run(["git", "commit", "-m", "init"], cwd=allowlisted_root, capture_output=True)

        info = get_git_info(allowlisted_root)
        assert info.available
        assert info.commitSha is not None
        assert len(info.commitSha) == 40
        assert info.dirty is False
