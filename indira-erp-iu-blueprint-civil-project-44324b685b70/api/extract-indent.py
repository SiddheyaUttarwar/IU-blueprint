"""Vercel Python serverless entry point.

Vercel auto-mounts the FastAPI `app` object at the file's URL:
  POST https://<vercel-domain>/api/extract-indent  (multipart field: file, PDF only)

The real implementation lives in scripts/indent_scan/ocr_server.py so the same
code powers local dev (uvicorn on :8765) and this serverless deploy — no
duplication.

Notes about Vercel:
  * Vercel Python runtime does not permit binary installs (apt-get, brew).
  * pdfplumber (pure Python) works fine, so text-based PDFs extract cleanly.
  * Tesseract / poppler / Ghostscript are NOT available, so scanned or
    handwritten PDFs return an empty item list with a warning. The frontend
    still renders the editable indent grid so the user can transcribe rows
    from the source file preview.
  * If you need OCR of scans on the server, deploy to a host that supports
    binaries — Render, Railway, Fly.io, or Google Cloud Run. Same Python
    code, add a Dockerfile that `apt-get install`s tesseract-ocr,
    poppler-utils, and ghostscript.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Make scripts/indent_scan importable when Vercel bundles this module.
_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT / "scripts" / "indent_scan"))

from ocr_server import app  # noqa: E402,F401  — re-exported for Vercel Python runtime