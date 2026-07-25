"""Tests for the indexer."""

from __future__ import annotations

from app.indexer import index_files
from app.scanner import ScannedFile, scan_source_root


class TestIndexer:
    def test_index_markdown(self, allowlisted_root):
        scan = scan_source_root(allowlisted_root)
        result = index_files("src-1", allowlisted_root, scan.includedFiles)
        assert result.sourceId == "src-1"
        assert result.chunkCount > 0
        assert result.fileCount >= 2  # README.md + docs/guide.md
        # All chunks should have the right sourceId
        for chunk in result.chunks:
            assert chunk.sourceId == "src-1"

    def test_index_skips_too_large(self, allowlisted_root):
        scan = scan_source_root(allowlisted_root, max_file_bytes=5)
        result = index_files("src-1", allowlisted_root, scan.includedFiles, max_file_bytes=5)
        assert result.errors["too_large"] > 0
        assert result.chunkCount == 0

    def test_index_markdown_has_headings(self, allowlisted_root):
        scan = scan_source_root(allowlisted_root)
        result = index_files("src-1", allowlisted_root, scan.includedFiles)
        md_chunks = [c for c in result.chunks if c.path.endswith(".md")]
        assert len(md_chunks) > 0
        # README.md should have heading "Test Repo"
        readme_chunks = [c for c in md_chunks if c.path == "README.md"]
        assert len(readme_chunks) == 1
        assert "Test Repo" in readme_chunks[0].headingPath

    def test_index_python_with_code_chunker(self, allowlisted_root):
        scan = scan_source_root(allowlisted_root)
        result = index_files("src-1", allowlisted_root, scan.includedFiles)
        py_chunks = [c for c in result.chunks if c.path.endswith(".py")]
        # Code chunker should produce file-overview + function chunks
        assert len(py_chunks) >= 1
        # Should have tags indicating python code chunks
        assert any("python" in c.tags for c in py_chunks)
        # Should have a function chunk for hello
        hello_chunks = [c for c in py_chunks if "hello" in c.headingPath]
        assert len(hello_chunks) == 1

    def test_index_frontmatter_tags_preserved(self, allowlisted_root):
        scan = scan_source_root(allowlisted_root)
        result = index_files("src-1", allowlisted_root, scan.includedFiles)
        guide_chunks = [c for c in result.chunks if c.path == "docs/guide.md"]
        assert len(guide_chunks) == 1
        assert "guide" in guide_chunks[0].tags
        assert "test" in guide_chunks[0].tags

    def test_index_empty_files_skipped(self, tmp_source_root):
        from pathlib import Path
        # Add an empty file
        (Path(tmp_source_root) / "empty.md").write_text("", encoding="utf-8")
        scan = scan_source_root(tmp_source_root)
        result = index_files("src-1", tmp_source_root, scan.includedFiles)
        assert result.errors["empty"] >= 1
        # Should not have chunks from the empty file
        assert not any(c.path == "empty.md" for c in result.chunks)
