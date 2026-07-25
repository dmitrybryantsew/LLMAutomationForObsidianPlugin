"""Companion service configuration.

Fixed constants for the MVP. Loopback-only, fixed port, no auth.
"""

from __future__ import annotations

import os
from pathlib import Path

# Loopback-only binding. Never bind to 0.0.0.0 in production.
HOST = "127.0.0.1"
PORT = 43110

# Companion protocol version. Bump when the HTTP contract changes in a way
# the plugin cannot handle. The plugin checks this against its known versions.
PROTOCOL_VERSION = "0.1.0"

# Default include/exclude globs for code repositories. These are deliberately
# conservative; users can override per-source in the plugin settings.
DEFAULT_INCLUDE_GLOBS = [
    "**/*.md",
    "**/*.markdown",
    "**/*.cs",
    "**/*.ts",
    "**/*.tsx",
    "**/*.js",
    "**/*.jsx",
    "**/*.py",
    "**/*.go",
    "**/*.rs",
    "**/*.java",
    "**/*.cpp",
    "**/*.h",
    "**/*.hpp",
]

DEFAULT_EXCLUDE_GLOBS = [
    "**/.git/**",
    "**/node_modules/**",
    "**/bin/**",
    "**/obj/**",
    "**/.vs/**",
    "**/.idea/**",
    "**/dist/**",
    "**/build/**",
    "**/target/**",
    "**/__pycache__/**",
    "**/.venv/**",
    "**/venv/**",
    "**/*.min.js",
    "**/*.map",
    "**/package-lock.json",
    "**/yarn.lock",
    "**/.env",
    "**/.env.*",
]

# Hard cap on file size we will read and chunk. Larger files are skipped with
# a "too_large" reason in the scan result.
DEFAULT_MAX_FILE_BYTES = 1_000_000

# Companion state directory (allowlist file). Defaults to a file next to the
# companion package. Override with COMPANION_STATE_DIR env var.
STATE_DIR = Path(os.environ.get("COMPANION_STATE_DIR", Path(__file__).resolve().parent.parent / ".companion-state"))
