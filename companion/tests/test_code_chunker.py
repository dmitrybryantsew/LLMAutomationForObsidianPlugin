"""Tests for the tree-sitter code chunker."""

from __future__ import annotations

from app.code_chunker import chunk_code, supported_extensions


class TestSupportedExtensions:
    def test_includes_python_csharp_typescript_javascript(self):
        exts = supported_extensions()
        assert ".py" in exts
        assert ".cs" in exts
        assert ".ts" in exts
        assert ".tsx" in exts
        assert ".js" in exts
        assert ".jsx" in exts


class TestPythonChunker:
    def test_function_extraction(self):
        code = '''def hello(name):
    """Greet someone."""
    print(f"Hello {name}")


def world():
    return 42
'''
        chunks = chunk_code("src-1", "main.py", code, modified_time=0.0, extension=".py")
        # Should have: file-overview + 2 functions
        assert len(chunks) == 3
        assert chunks[0].tags == ["python", "file-overview"]
        assert chunks[1].tags == ["python", "function"]
        assert chunks[2].tags == ["python", "function"]

        # Check function names in headingPath
        assert chunks[1].headingPath == ["(function)", "hello"]
        assert chunks[2].headingPath == ["(function)", "world"]

        # Check docstring is captured
        assert "Greet someone" in chunks[1].text

        # Check line numbers
        assert chunks[1].startLine == 1
        assert chunks[2].startLine == 6

    def test_class_extraction(self):
        code = '''class Foo:
    """A foo class."""

    def bar(self):
        return 1


class Baz:
    pass
'''
        chunks = chunk_code("src-1", "foo.py", code, modified_time=0.0, extension=".py")
        # file-overview + class Foo + method bar + class Baz
        assert len(chunks) == 4
        assert chunks[1].headingPath == ["(class)", "Foo"]
        assert chunks[2].headingPath == ["(method)", "bar"]
        assert chunks[3].headingPath == ["(class)", "Baz"]

    def test_imports_extracted(self):
        code = """import os
from typing import List

def main():
    pass
"""
        chunks = chunk_code("src-1", "main.py", code, modified_time=0.0, extension=".py")
        # Imports should be in outboundLinks of the file-overview chunk
        overview = chunks[0]
        assert "os" in overview.outboundLinks
        assert "typing" in overview.outboundLinks

    def test_imports_in_all_chunks(self):
        code = """import os

def main():
    pass
"""
        chunks = chunk_code("src-1", "main.py", code, modified_time=0.0, extension=".py")
        # Imports should be in outboundLinks of all chunks
        for chunk in chunks:
            assert "os" in chunk.outboundLinks

    def test_normalized_text_contains_symbol(self):
        code = """def calculate_sum(a, b):
    return a + b
"""
        chunks = chunk_code("src-1", "calc.py", code, modified_time=0.0, extension=".py")
        func_chunk = chunks[1]
        assert "calculate_sum" in func_chunk.normalizedText


class TestCSharpChunker:
    def test_method_extraction(self):
        code = """public class Calculator
{
    public int Add(int a, int b)
    {
        return a + b;
    }

    public void Print()
    {
        System.Console.WriteLine("hi");
    }
}
"""
        chunks = chunk_code("src-1", "Calculator.cs", code, modified_time=0.0, extension=".cs")
        # file-overview + class + 2 methods
        assert len(chunks) == 4
        assert chunks[0].tags == ["csharp", "file-overview"]
        assert chunks[1].headingPath == ["(class)", "Calculator"]
        assert chunks[2].headingPath == ["(method)", "Add"]
        assert chunks[3].headingPath == ["(method)", "Print"]

    def test_property_extraction(self):
        code = """public class Person
{
    public string Name { get; set; }
}
"""
        chunks = chunk_code("src-1", "Person.cs", code, modified_time=0.0, extension=".cs")
        # Should have file-overview + class + property
        property_chunks = [c for c in chunks if c.tags == ["csharp", "property"]]
        assert len(property_chunks) == 1

    def test_using_directives_extracted(self):
        code = """using System;
using System.Collections.Generic;

public class Foo
{
}
"""
        chunks = chunk_code("src-1", "Foo.cs", code, modified_time=0.0, extension=".cs")
        overview = chunks[0]
        assert "System" in overview.outboundLinks
        assert "System.Collections.Generic" in overview.outboundLinks


class TestTypeScriptChunker:
    def test_function_extraction(self):
        code = """function greet(name: string): string {
    return `Hello ${name}`;
}

export function farewell(name: string): string {
    return `Bye ${name}`;
}
"""
        chunks = chunk_code("src-1", "greet.ts", code, modified_time=0.0, extension=".ts")
        # file-overview + 2 functions
        assert len(chunks) == 3
        assert chunks[1].headingPath == ["(function)", "greet"]
        assert chunks[2].headingPath == ["(function)", "farewell"]

    def test_class_method_extraction(self):
        code = """class Foo {
    bar(): void {
        console.log("bar");
    }

    baz(x: number): number {
        return x * 2;
    }
}
"""
        chunks = chunk_code("src-1", "Foo.ts", code, modified_time=0.0, extension=".ts")
        # file-overview + class + 2 methods
        assert len(chunks) == 4
        assert chunks[1].headingPath == ["(class)", "Foo"]
        assert chunks[2].headingPath == ["(method)", "bar"]
        assert chunks[3].headingPath == ["(method)", "baz"]

    def test_interface_extraction(self):
        code = """interface Person {
    name: string;
    age: number;
}
"""
        chunks = chunk_code("src-1", "Person.ts", code, modified_time=0.0, extension=".ts")
        interface_chunks = [c for c in chunks if c.tags == ["typescript", "interface"]]
        assert len(interface_chunks) == 1

    def test_import_extraction(self):
        code = """import { foo } from './foo';
import bar from './bar';

export function main() {}
"""
        chunks = chunk_code("src-1", "main.ts", code, modified_time=0.0, extension=".ts")
        overview = chunks[0]
        assert "./foo" in overview.outboundLinks
        assert "./bar" in overview.outboundLinks


class TestJavaScriptChunker:
    def test_function_extraction(self):
        code = """function hello(name) {
    console.log(`Hello ${name}`);
}

const world = () => 42;
"""
        chunks = chunk_code("src-1", "hello.js", code, modified_time=0.0, extension=".js")
        # file-overview + function hello
        # (arrow function "world" may or may not be detected depending on tree-sitter)
        func_chunks = [c for c in chunks if c.headingPath == ["(function)", "hello"]]
        assert len(func_chunks) == 1


class TestFallback:
    def test_unsupported_extension_falls_back_to_plain_text(self):
        code = "some random text\n"
        chunks = chunk_code("src-1", "readme.txt", code, modified_time=0.0, extension=".txt")
        # Should fall back to plain text — single chunk
        assert len(chunks) == 1
        assert chunks[0].headingPath == ["(file)"]

    def test_parse_error_falls_back(self):
        # Valid extension but broken content should not crash
        code = "def \n\n\n"
        chunks = chunk_code("src-1", "broken.py", code, modified_time=0.0, extension=".py")
        # Should produce at least one chunk (file overview or plain text fallback)
        assert len(chunks) >= 1

    def test_empty_file(self):
        chunks = chunk_code("src-1", "empty.py", "", modified_time=0.0, extension=".py")
        # Empty file should fall back to plain text which produces a single chunk
        # or no chunks
        assert len(chunks) <= 1


class TestChunkShape:
    def test_chunk_has_all_required_fields(self):
        code = "def foo():\n    pass\n"
        chunks = chunk_code("src-1", "foo.py", code, modified_time=1000.0, extension=".py")
        c = chunks[1]  # the function chunk
        assert c.id
        assert c.sourceId == "src-1"
        assert c.path == "foo.py"
        assert c.basename == "foo.py"
        assert c.headingPath
        assert c.startLine >= 1
        assert c.endLine >= c.startLine
        assert c.text
        assert c.normalizedText
        assert c.tags
        assert isinstance(c.outboundLinks, list)
        assert c.contentHash
        assert c.modifiedTime == 1000.0
