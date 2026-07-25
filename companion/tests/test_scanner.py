"""Tests for the file scanner."""

from __future__ import annotations

from app.scanner import scan_source_root


class TestScanner:
    def test_scan_finds_markdown_and_code(self, allowlisted_root):
        result = scan_source_root(allowlisted_root)
        paths = {f.relativePath for f in result.includedFiles}
        assert "README.md" in paths
        assert "docs/guide.md" in paths
        assert "src/main.py" in paths

    def test_scan_excludes_node_modules(self, allowlisted_root):
        result = scan_source_root(allowlisted_root)
        paths = {f.relativePath for f in result.includedFiles}
        assert "node_modules/pkg.py" not in paths

    def test_scan_respects_include_globs(self, allowlisted_root):
        result = scan_source_root(
            allowlisted_root,
            include_globs=["**/*.py"],
        )
        paths = {f.relativePath for f in result.includedFiles}
        assert "src/main.py" in paths
        assert "README.md" not in paths

    def test_scan_respects_custom_exclude_globs(self, allowlisted_root):
        result = scan_source_root(
            allowlisted_root,
            exclude_globs=["**/*.py", "**/node_modules/**"],
        )
        paths = {f.relativePath for f in result.includedFiles}
        assert "src/main.py" not in paths
        assert "README.md" in paths

    def test_scan_returns_metadata(self, allowlisted_root):
        result = scan_source_root(allowlisted_root)
        readme = next(f for f in result.includedFiles if f.relativePath == "README.md")
        assert readme.sizeBytes > 0
        assert readme.modifiedTime > 0
        assert readme.extension == ".md"
        assert not readme.tooLarge
        assert readme.absolutePath.endswith("README.md")

    def test_scan_too_large_flag(self, allowlisted_root):
        result = scan_source_root(allowlisted_root, max_file_bytes=5)
        readme = next(f for f in result.includedFiles if f.relativePath == "README.md")
        assert readme.tooLarge

    def test_scan_nonexistent_root(self):
        result = scan_source_root("C:/nonexistent/path/xyz")
        assert result.totalFiles == 0
        assert len(result.includedFiles) == 0
