"""Tests for the source-root allowlist."""

from __future__ import annotations

from app.allowlist import (
    add_root,
    is_allowed,
    list_roots,
    load_allowlist,
    remove_root,
)


class TestAllowlist:
    def test_empty_allowlist_blocks_everything(self):
        assert not is_allowed("C:/arbitrary/path")

    def test_add_and_check(self, tmp_source_root):
        add_root("src-1", tmp_source_root)
        assert is_allowed(tmp_source_root)
        # Subdirectory is allowed
        assert is_allowed(f"{tmp_source_root}/src")
        # Sibling is not
        assert not is_allowed(f"{tmp_source_root}-sibling")

    def test_idempotent_add(self, tmp_source_root):
        add_root("src-1", tmp_source_root)
        add_root("src-1", tmp_source_root)
        roots = list_roots()
        assert len(roots) == 1

    def test_remove(self, tmp_source_root):
        add_root("src-1", tmp_source_root)
        assert is_allowed(tmp_source_root)
        remove_root("src-1")
        assert not is_allowed(tmp_source_root)

    def test_persistence(self, tmp_source_root):
        add_root("src-1", tmp_source_root)
        loaded = load_allowlist()
        assert len(loaded.roots) == 1
        assert loaded.roots[0].id == "src-1"
