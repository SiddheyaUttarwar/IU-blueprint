"""
Local HTTP OCR server for the Indent Cum Budget "Upload PDF / Image" flow.
Wraps the existing scan_indent.py extractor so the React app can POST a file and
get back the same JSON shape the Supabase extract-indent Edge Function returns —
but for free, running on your machine, with no LLM.

Run:
  cd scripts/indent_scan
  pip install -r requirements.txt
  pip install fastapi uvicorn python-multipart
  python ocr_server.py           # listens on http://127.0.0.1:8765

Point the app at it: create/edit .env.local at the repo root and add
  VITE_OCR_ENDPOINT=http://127.0.0.1:8765/extract
then restart `npm run dev`. Uploading an indent PDF/image will POST here.

Response shape (matches Edge Function):
  { "header": { "indentNumber", "indentDate", "activity" },
    "items":  [ { sr_no, item_name, item_description, unit,
                  have_qty, buy_qty, unit_price, remark } ],
    "warnings": [ ... ] }
"""
from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from scan_indent import extract_from_pdf

app = FastAPI(title="Indent OCR (local)", version="1.0.0")

# Dev-only CORS — the Vite server is on :5173/:5176; loosen for any local origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/")
def root() -> dict[str, str]:
    return {"status": "ok", "endpoint": "POST /extract or /api/extract-indent (multipart file field)"}


async def _extract_impl(file: UploadFile) -> dict[str, Any]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing file.")
    suffix = Path(file.filename).suffix.lower() or ".bin"
    # PDF only — images are blocked by design. Handwritten / scanned PDFs go through the
    # Tesseract OCR branch inside extract_from_pdf and the user edits any unclear fields inline.
    if suffix != ".pdf":
        raise HTTPException(status_code=400, detail="Only PDF uploads are supported. Convert images to PDF first.")
    # Write to a temp file — scan_indent.py works off filesystem paths.
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = Path(tmp.name)
    try:
        header, items, warnings = extract_from_pdf(tmp_path)

        # Same backfill as the CLI so the caller sees amounts even when the source
        # doesn't spell them out.
        for it in items:
            if it.get("amount") is None and it.get("buy_qty") and it.get("unit_price"):
                it["amount"] = round(it["buy_qty"] * it["unit_price"], 2)

        return {"header": header, "items": items, "warnings": warnings}
    except HTTPException:
        raise
    except Exception as exc:
        # Bubble the exact message so the app can display it inline.
        raise HTTPException(status_code=500, detail=f"OCR failed: {exc}") from exc
    finally:
        try: tmp_path.unlink()
        except OSError: pass


@app.post("/extract")
async def extract_local(file: UploadFile = File(...)) -> dict[str, Any]:
    return await _extract_impl(file)


# Vercel serves this file at /api/extract-indent — same handler, same JSON shape.
@app.post("/api/extract-indent")
async def extract_vercel(file: UploadFile = File(...)) -> dict[str, Any]:
    return await _extract_impl(file)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
