"""Tests for the chunker. Verifies FNV-1a hash and Markdown parsing match
the plugin's TypeScript implementation."""

from __future__ import annotations

from app.chunker import (
    build_chunk_id,
    chunk_markdown,
    chunk_plain_text,
    fnv1a_hash,
    normalize_retrieval_text,
)


class TestHashCompatibility:
    """These test values must match the TypeScript ``hashUtils.ts`` so that
    chunk IDs and content hashes are identical across the Python/TS boundary."""

    def test_fnv1a_empty(self):
        assert fnv1a_hash("") == "811c9dc5"

    def test_fnv1a_a(self):
        # Known FNV-1a 32-bit value for "a"
        assert fnv1a_hash("a") == "e40c292c"

    def test_fnv1a_hello(self):
        assert fnv1a_hash("hello") == "4f9f2cab"

    def test_normalize_lowercase(self):
        assert normalize_retrieval_text("Hello World") == "hello world"

    def test_normalize_collapses_spaces(self):
        assert normalize_retrieval_text("hello   world\ttab") == "hello world tab"

    def test_normalize_collapses_newlines(self):
        assert normalize_retrieval_text("hello\r\nworld\r") == "hello\nworld"

    def test_build_chunk_id_deterministic(self):
        id1 = build_chunk_id("src-1", "README.md", ["Intro"], 0, "abc12345")
        id2 = build_chunk_id("src-1", "README.md", ["Intro"], 0, "abc12345")
        assert id1 == id2

    def test_build_chunk_id_different_inputs(self):
        id1 = build_chunk_id("src-1", "README.md", ["Intro"], 0, "abc12345")
        id2 = build_chunk_id("src-2", "README.md", ["Intro"], 0, "abc12345")
        assert id1 != id2


class TestMarkdownChunker:
    def test_simple_markdown(self):
        content = "# Title\n\nSome content here.\n"
        chunks = chunk_markdown("src-1", "README.md", content, modified_time=1000.0)
        assert len(chunks) == 1
        c = chunks[0]
        assert c.sourceId == "src-1"
        assert c.path == "README.md"
        assert c.basename == "README"
        assert c.headingPath == ["Title"]
        assert c.startLine == 3  # content after heading+blank
        assert "Some content here" in c.text
        assert c.modifiedTime == 1000.0
        assert c.contentHash

    def test_frontmatter_tags(self):
        content = "---\ntags: [python, test]\n---\n\n# Body\n\nText.\n"
        chunks = chunk_markdown("src-1", "doc.md", content, modified_time=0.0)
        assert len(chunks) == 1
        assert "python" in chunks[0].tags
        assert "test" in chunks[0].tags

    def test_multiple_sections(self):
        content = "# A\n\nContent A.\n\n## B\n\nContent B.\n"
        chunks = chunk_markdown("src-1", "doc.md", content, modified_time=0.0)
        assert len(chunks) == 2
        assert chunks[0].headingPath == ["A"]
        assert chunks[1].headingPath == ["A", "B"]

    def test_no_heading(self):
        content = "Just some text without headings.\n"
        chunks = chunk_markdown("src-1", "note.md", content, modified_time=0.0)
        assert len(chunks) == 1
        assert chunks[0].headingPath == ["(preamble)"]

    def test_long_section_splits(self):
        paragraph = "Word " * 200  # ~1000 chars
        content = f"# Big\n\n{paragraph}\n\n{paragraph}\n\n{paragraph}\n"
        chunks = chunk_markdown("src-1", "big.md", content, modified_time=0.0, max_section_chars=500)
        assert len(chunks) > 1

    def test_wiki_links_extracted(self):
        content = "# Note\n\nSee [[Target Note]] and [[Other|alias]].\n"
        chunks = chunk_markdown("src-1", "note.md", content, modified_time=0.0)
        assert "Target Note" in chunks[0].outboundLinks
        assert "Other" in chunks[0].outboundLinks

    def test_code_fence_not_split_as_heading(self):
        content = "# Title\n\n```python\n# Not a heading\nx = 1\n```\n\nMore.\n"
        chunks = chunk_markdown("src-1", "doc.md", content, modified_time=0.0)
        # The code block and trailing text stay with the Title heading
        assert len(chunks) == 1
        assert chunks[0].headingPath == ["Title"]


class TestPlainTextChunker:
    def test_small_file_single_chunk(self):
        content = "def hello():\n    print('hi')\n"
        chunks = chunk_plain_text("src-1", "src/main.py", content, modified_time=0.0)
        assert len(chunks) == 1
        assert chunks[0].headingPath == ["(file)"]
        assert chunks[0].startLine == 1
        assert chunks[0].endLine == 2

    def test_large_file_splits(self):
        content = "\n".join(f"line {i}" for i in range(500))
        chunks = chunk_plain_text("src-1", "big.txt", content, modified_time=0.0, max_chars=1000)
        assert len(chunks) > 1
