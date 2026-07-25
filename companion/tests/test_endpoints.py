"""Tests for the FastAPI endpoints using TestClient."""

from __future__ import annotations

import shutil
import subprocess

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


class TestStatusEndpoint:
    def test_status(self):
        resp = client.get("/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["running"] is True
        assert "version" in data
        assert "scan" in data["capabilities"]
        assert "index" in data["capabilities"]
        assert "allowlist" in data["capabilities"]
        assert data["allowlistSize"] == 0


class TestSourcesEndpoint:
    def test_empty_sources(self):
        resp = client.get("/sources")
        assert resp.status_code == 200
        assert resp.json()["roots"] == []

    def test_add_and_list(self, tmp_source_root):
        resp = client.post("/allowlist/add", json={"id": "src-1", "path": tmp_source_root})
        assert resp.status_code == 200
        roots = resp.json()["roots"]
        assert len(roots) == 1
        assert roots[0]["id"] == "src-1"

        resp = client.get("/sources")
        assert len(resp.json()["roots"]) == 1

    def test_add_nonexistent_path_rejected(self):
        resp = client.post("/allowlist/add", json={"id": "src-1", "path": "C:/nonexistent/xyz"})
        assert resp.status_code == 400

    def test_remove(self, tmp_source_root):
        client.post("/allowlist/add", json={"id": "src-1", "path": tmp_source_root})
        resp = client.post("/allowlist/remove", json={"id": "src-1"})
        assert resp.status_code == 200
        assert len(resp.json()["roots"]) == 0


class TestScanEndpoint:
    def test_scan_blocked_without_allowlist(self, tmp_source_root):
        resp = client.post("/source/scan", json={"rootPath": tmp_source_root})
        assert resp.status_code == 403

    def test_scan_allowed(self, allowlisted_root):
        resp = client.post("/source/scan", json={"rootPath": allowlisted_root})
        assert resp.status_code == 200
        data = resp.json()
        paths = {f["relativePath"] for f in data["includedFiles"]}
        assert "README.md" in paths
        assert "docs/guide.md" in paths
        assert "src/main.py" in paths

    def test_scan_custom_globs(self, allowlisted_root):
        resp = client.post("/source/scan", json={
            "rootPath": allowlisted_root,
            "includeGlobs": ["**/*.py"],
        })
        assert resp.status_code == 200
        paths = {f["relativePath"] for f in resp.json()["includedFiles"]}
        assert "src/main.py" in paths
        assert "README.md" not in paths


class TestGitInfoEndpoint:
    def test_git_info_blocked_without_allowlist(self, tmp_source_root):
        resp = client.post("/source/git-info", json={"rootPath": tmp_source_root})
        assert resp.status_code == 403

    def test_git_info_not_a_repo(self, allowlisted_root):
        resp = client.post("/source/git-info", json={"rootPath": allowlisted_root})
        assert resp.status_code == 200
        data = resp.json()
        assert data["available"] is False


class TestIndexEndpoint:
    def test_index_blocked_without_allowlist(self, tmp_source_root):
        resp = client.post("/source/index", json={"sourceId": "src-1", "rootPath": tmp_source_root})
        assert resp.status_code == 403

    def test_index_allowed(self, allowlisted_root):
        resp = client.post("/source/index", json={
            "sourceId": "src-1",
            "rootPath": allowlisted_root,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["sourceId"] == "src-1"
        assert data["chunkCount"] > 0
        assert data["fileCount"] >= 2
        # Verify chunk shape matches RetrievalChunkDraft
        chunk = data["chunks"][0]
        assert "id" in chunk
        assert "sourceId" in chunk
        assert "path" in chunk
        assert "basename" in chunk
        assert "headingPath" in chunk
        assert "startLine" in chunk
        assert "endLine" in chunk
        assert "text" in chunk
        assert "normalizedText" in chunk
        assert "tags" in chunk
        assert "outboundLinks" in chunk
        assert "contentHash" in chunk
        assert "modifiedTime" in chunk

    def test_index_with_explicit_files(self, allowlisted_root):
        # First scan
        scan = client.post("/source/scan", json={"rootPath": allowlisted_root}).json()
        files = scan["includedFiles"]
        # Then index with explicit file list
        resp = client.post("/source/index", json={
            "sourceId": "src-1",
            "rootPath": allowlisted_root,
            "files": files,
        })
        assert resp.status_code == 200
        assert resp.json()["chunkCount"] > 0
