"""Tree-sitter code chunker.

Parses source code with tree-sitter and produces ``ChunkDraft`` objects for
each function, method, class, and file-level overview. Supports Python, C#,
TypeScript, and JavaScript.

Each code chunk has:
  - headingPath: [symbol_kind, symbol_name] (e.g. ["function", "hello"])
  - text: a display string with file name, symbol kind/name, signature, and body
  - normalizedText: the body text normalized for FTS indexing
  - tags: [language, symbol_kind] (e.g. ["python", "function"])
  - outboundLinks: imported module names

The chunk shape matches the plugin's ``RetrievalChunkDraft`` interface so
chunks can be inserted directly into the existing FTS5 + vector store.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from tree_sitter import Language, Node, Parser

import tree_sitter_python as tspython
import tree_sitter_c_sharp as tscsharp
import tree_sitter_typescript as tsts
import tree_sitter_javascript as tsjs

from .chunker import (
    ChunkDraft,
    build_chunk_id,
    fnv1a_hash,
    normalize_retrieval_text,
)

# ---------------------------------------------------------------------------
# Language registry
# ---------------------------------------------------------------------------

_PY_LANG = Language(tspython.language())
_CS_LANG = Language(tscsharp.language())
_TS_LANG = Language(tsts.language_typescript())
_JS_LANG = Language(tsjs.language())

_LANGUAGE_MAP: dict[str, Language] = {
    ".py": _PY_LANG,
    ".cs": _CS_LANG,
    ".ts": _TS_LANG,
    ".tsx": _TS_LANG,
    ".js": _JS_LANG,
    ".jsx": _JS_LANG,
}

_LANGUAGE_NAME: dict[str, str] = {
    ".py": "python",
    ".cs": "csharp",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
}

# Node types that represent definable symbols
_SYMBOL_KINDS = {
    # Python
    "function_definition": "function",
    "class_definition": "class",
    # C#
    "method_declaration": "method",
    "class_declaration": "class",
    "constructor_declaration": "constructor",
    "property_declaration": "property",
    "interface_declaration": "interface",
    "struct_declaration": "struct",
    "enum_declaration": "enum",
    # TypeScript/JavaScript
    "function_declaration": "function",
    "class_declaration": "class",
    "method_definition": "method",
    "class_declaration": "class",
    "interface_declaration": "interface",
    "type_alias_declaration": "type",
    "enum_declaration": "enum",
    # TypeScript-specific (already covered above but explicit)
    "export_statement": None,  # wrapper, not a symbol itself
}

# Maximum body size in characters. Larger bodies are truncated with a note.
_MAX_BODY_CHARS = 4000


@dataclass
class CodeChunk:
    """Intermediate representation before converting to ChunkDraft."""
    symbol_kind: str
    symbol_name: str
    signature: str
    body: str
    start_line: int
    end_line: int
    doc_comment: str | None
    is_file_overview: bool = False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def chunk_code(
    source_id: str,
    path: str,
    content: str,
    modified_time: float,
    extension: str,
) -> list[ChunkDraft]:
    """Parse source code and produce ``ChunkDraft`` objects.

    Falls back to ``chunk_plain_text`` if the language is not supported or
    parsing fails.
    """
    lang = _LANGUAGE_MAP.get(extension.lower())
    if lang is None:
        from .chunker import chunk_plain_text
        return chunk_plain_text(source_id, path, content, modified_time)

    lang_name = _LANGUAGE_NAME[extension.lower()]
    basename = path.rsplit("/", 1)[-1] if "/" in path else path

    try:
        parser = Parser(lang)
        tree = parser.parse(content.encode("utf-8"))
    except Exception:
        from .chunker import chunk_plain_text
        return chunk_plain_text(source_id, path, content, modified_time)

    root = tree.root_node
    source_text = content

    # Extract imports
    imports = _extract_imports(root, source_text, lang_name)

    # Extract symbol chunks
    code_chunks = _extract_symbols(root, source_text, lang_name)

    # Build a file overview chunk (imports + top-level comments)
    file_overview = _build_file_overview(root, source_text, imports, basename, lang_name)
    if file_overview:
        code_chunks.insert(0, file_overview)

    # Convert to ChunkDraft
    chunks: list[ChunkDraft] = []
    ordinal = 0
    for cc in code_chunks:
        heading_path = ["(file)" if cc.is_file_overview else f"({cc.symbol_kind})", cc.symbol_name]

        # Build display text
        parts = [f"File: {basename}"]
        parts.append(f"Language: {lang_name}")
        parts.append(f"Symbol: {cc.symbol_kind} {cc.symbol_name}")
        if cc.signature:
            parts.append(f"Signature: {cc.signature}")
        if cc.doc_comment:
            parts.append(f"Doc: {cc.doc_comment}")
        parts.append("")
        body = cc.body[:_MAX_BODY_CHARS]
        if len(cc.body) > _MAX_BODY_CHARS:
            body += "\n... (truncated)"
        parts.append(body)
        display_text = "\n".join(parts)

        # Normalized text for FTS — include symbol name + signature + body
        fts_text = f"{cc.symbol_name} {cc.signature or ''} {cc.body}"
        normalized_text = normalize_retrieval_text(fts_text)
        content_hash = fnv1a_hash(normalized_text)
        chunk_id = build_chunk_id(source_id, path, heading_path, ordinal, content_hash)

        tags = [lang_name, cc.symbol_kind]
        if cc.is_file_overview:
            tags = [lang_name, "file-overview"]

        chunks.append(ChunkDraft(
            id=chunk_id,
            sourceId=source_id,
            path=path,
            basename=basename,
            headingPath=heading_path,
            startLine=cc.start_line,
            endLine=cc.end_line,
            text=display_text,
            normalizedText=normalized_text,
            tags=tags,
            outboundLinks=imports,
            contentHash=content_hash,
            modifiedTime=modified_time,
        ))
        ordinal += 1

    # If no symbols found at all, fall back to plain text
    if not chunks:
        from .chunker import chunk_plain_text
        return chunk_plain_text(source_id, path, content, modified_time)

    return chunks


def supported_extensions() -> list[str]:
    """Return file extensions supported by the code chunker."""
    return list(_LANGUAGE_MAP.keys())


# ---------------------------------------------------------------------------
# Symbol extraction
# ---------------------------------------------------------------------------

def _extract_symbols(root: Node, source: str, lang_name: str) -> list[CodeChunk]:
    """Walk the tree and extract function/class/method definitions."""
    chunks: list[CodeChunk] = []

    for node in _walk(root):
        kind = _SYMBOL_KINDS.get(node.type)
        if kind is None or kind is None:
            continue

        # Python: function_definition inside a class block is a method
        if lang_name == "python" and node.type == "function_definition":
            parent = node.parent
            if parent is not None and parent.type == "block":
                grandparent = parent.parent
                if grandparent is not None and grandparent.type == "class_definition":
                    kind = "method"

        name = _get_symbol_name(node, source)
        if not name:
            continue

        signature = _get_signature(node, source)
        body = _get_body(node, source)
        doc = _get_doc_comment(node, source, lang_name)
        start_line = node.start_point[0] + 1
        end_line = node.end_point[0] + 1

        chunks.append(CodeChunk(
            symbol_kind=kind,
            symbol_name=name,
            signature=signature,
            body=body,
            start_line=start_line,
            end_line=end_line,
            doc_comment=doc,
        ))

    return chunks


def _walk(node: Node):
    """Recursively yield all descendants of ``node`` (including itself)."""
    yield node
    for child in node.children:
        yield from _walk(child)


def _node_text(node: Node, source: str) -> str:
    """Extract the text span of ``node`` from ``source``."""
    return source[node.start_byte:node.end_byte]


def _get_symbol_name(node: Node, source: str) -> str | None:
    """Extract the name of a symbol node."""
    # Python: function_definition has a "name" child (identifier)
    # C#: method_declaration has an "identifier" child
    # TS: function_declaration has "name" (identifier), method_definition has "property_identifier"
    for child in node.children:
        if child.type in ("identifier", "name", "type_identifier", "property_identifier"):
            return _node_text(child, source)
    return None


def _get_signature(node: Node, source: str) -> str:
    """Extract the signature (first line / declaration line) of a symbol."""
    # Get the first line of the node (up to the body block)
    # For most languages, the signature is the text before the body block
    first_line_end = node.start_byte
    # Find the body block (typically the last child with type "block", "suite", "statement_block")
    body_types = {"block", "suite", "statement_block", "declaration_list", "class_body"}
    for child in node.children:
        if child.type in body_types:
            first_line_end = child.start_byte
            break

    if first_line_end == node.start_byte:
        # No body block found — use first line
        line_end = source.find("\n", node.start_byte)
        if line_end == -1:
            line_end = node.end_byte
        return source[node.start_byte:line_end].strip()

    signature = source[node.start_byte:first_line_end].strip()
    # Collapse whitespace
    signature = re.sub(r"\s+", " ", signature)
    return signature


def _get_body(node: Node, source: str) -> str:
    """Extract the body text of a symbol (including signature)."""
    return _node_text(node, source)


def _get_doc_comment(node: Node, source: str, lang_name: str) -> str | None:
    """Extract the doc comment preceding a symbol.

    - Python: string expression after the def (docstring)
    - C#: XML doc comments (/// <summary>...)
    - TS/JS: JSDoc comments (/** ... */)
    """
    if lang_name == "python":
        return _get_python_docstring(node, source)
    else:
        return _get_preceding_doc_comment(node, source)


def _get_python_docstring(node: Node, source: str) -> str | None:
    """Extract a Python docstring (first string expression in the body)."""
    body_types = {"block", "suite", "statement_block"}
    body_node = None
    for child in node.children:
        if child.type in body_types:
            body_node = child
            break

    if body_node is None:
        return None

    # First child should be an expression_statement containing a string
    for child in body_node.children:
        if child.type == "expression_statement":
            for expr in child.children:
                if expr.type == "string":
                    text = _node_text(expr, source)
                    # Remove quotes and f-prefix
                    text = re.sub(r'^[fbruFBRU]*["\']+', "", text)
                    text = re.sub(r'["\']+$', "", text)
                    return text.strip() or None
    return None


def _get_preceding_doc_comment(node: Node, source: str) -> str | None:
    """Extract C# XML doc or TS/JS JSDoc comments preceding a node."""
    # Look at siblings before this node
    parent = node.parent
    if parent is None:
        return None

    # Find this node's index among siblings
    siblings = [c for c in parent.children]
    idx = siblings.index(node)
    if idx == 0:
        return None

    # Walk backwards collecting comment nodes
    comments: list[str] = []
    for i in range(idx - 1, -1, -1):
        sibling = siblings[i]
        if sibling.type in ("comment", "documentation_comment"):
            text = _node_text(sibling, source)
            comments.insert(0, text)
        elif sibling.type in ("decorator", "attribute", "attribute_list"):
            # Skip decorators/attributes
            continue
        else:
            break

    if not comments:
        return None

    # Clean up comment markers
    raw = "\n".join(comments)
    # Remove /// and /** */ and * prefixes
    cleaned = re.sub(r"^\s*///\s?", "", raw, flags=re.MULTILINE)
    cleaned = re.sub(r"^\s*\*\s?", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"/\*\*", "", cleaned)
    cleaned = re.sub(r"\*/", "", cleaned)
    return cleaned.strip() or None


# ---------------------------------------------------------------------------
# Import extraction
# ---------------------------------------------------------------------------

def _extract_imports(root: Node, source: str, lang_name: str) -> list[str]:
    """Extract imported module names at the file level."""
    imports: list[str] = []

    if lang_name == "python":
        for node in _walk(root):
            if node.type in ("import_statement", "import_from_statement"):
                text = _node_text(node, source)
                # "import foo.bar" or "from foo import bar"
                m = re.match(r"from\s+([\w.]+)\s+import", text)
                if m:
                    imports.append(m.group(1))
                else:
                    m = re.match(r"import\s+([\w.]+)", text)
                    if m:
                        imports.append(m.group(1))
    elif lang_name == "csharp":
        for node in _walk(root):
            if node.type == "using_directive":
                text = _node_text(node, source)
                m = re.match(r"using\s+([\w.]+)", text)
                if m:
                    imports.append(m.group(1))
    elif lang_name in ("typescript", "javascript"):
        for node in _walk(root):
            if node.type in ("import_statement", "import_alias"):
                text = _node_text(node, source)
                # "import foo from 'bar'" or "import { x } from 'bar'"
                m = re.search(r"from\s+['\"]([^'\"]+)['\"]", text)
                if m:
                    imports.append(m.group(1))
                else:
                    m = re.search(r"import\s+['\"]([^'\"]+)['\"]", text)
                    if m:
                        imports.append(m.group(1))

    return imports


# ---------------------------------------------------------------------------
# File overview
# ---------------------------------------------------------------------------

def _build_file_overview(
    root: Node,
    source: str,
    imports: list[str],
    basename: str,
    lang_name: str,
) -> CodeChunk | None:
    """Build a file-level overview chunk with imports and top-level comments."""
    lines: list[str] = []

    if imports:
        lines.append(f"Imports: {', '.join(imports)}")
        lines.append("")

    # Collect top-level comments (not inside functions/classes)
    for child in root.children:
        if child.type in ("comment", "documentation_comment"):
            text = _node_text(child, source)
            # Only include file-level comments (first few)
            if len(lines) < 20:
                lines.append(text)

    # Collect top-level declarations (names only)
    decls: list[str] = []
    for child in root.children:
        kind = _SYMBOL_KINDS.get(child.type)
        if kind and kind is not None:
            name = _get_symbol_name(child, source)
            if name:
                decls.append(f"{kind} {name}")

    if decls:
        lines.append("Declarations:")
        for d in decls:
            lines.append(f"  - {d}")

    if not lines:
        return None

    body = "\n".join(lines)
    return CodeChunk(
        symbol_kind="file-overview",
        symbol_name=basename,
        signature="",
        body=body,
        start_line=1,
        end_line=root.end_point[0] + 1,
        doc_comment=None,
        is_file_overview=True,
    )
