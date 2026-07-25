"""Pytest configuration and shared fixtures."""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import pytest

# Force a temp state dir BEFORE importing app modules so the allowlist
# file does not clobber the real one.
_TMP_STATE = tempfile.mkdtemp(prefix="companion-test-")
os.environ["COMPANION_STATE_DIR"] = _TMP_STATE


@pytest.fixture(autouse=True)
def _clean_allowlist():
    """Reset the allowlist before each test."""
    from app.allowlist import reset_allowlist_for_tests
    reset_allowlist_for_tests()
    yield
    reset_allowlist_for_tests()


@pytest.fixture
def tmp_source_root():
    """Create a temporary directory tree for scan/index tests."""
    root = Path(tempfile.mkdtemp(prefix="companion-src-"))
    (root / "README.md").write_text("# Test Repo\n\nHello world.\n", encoding="utf-8")
    (root / "docs").mkdir()
    (root / "docs" / "guide.md").write_text(
        "---\ntags: [guide, test]\n---\n\n# Guide\n\nContent here.\n",
        encoding="utf-8",
    )
    (root / "src").mkdir()
    (root / "src" / "main.py").write_text("def hello():\n    print('hi')\n", encoding="utf-8")
    (root / "node_modules").mkdir()
    (root / "node_modules" / "pkg.py").write_text("should be excluded\n", encoding="utf-8")
    yield str(root)
    shutil.rmtree(root, ignore_errors=True)


@pytest.fixture
def allowlisted_root(tmp_source_root):
    """A tmp_source_root that has been added to the allowlist."""
    from app.allowlist import add_root
    add_root("test-src", tmp_source_root)
    yield tmp_source_root
