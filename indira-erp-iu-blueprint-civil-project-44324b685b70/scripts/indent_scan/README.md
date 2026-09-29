# Indent-cum-Budget Scanner (no-LLM)

Extracts structured items from a PDF or photo of an indent form using deterministic Python tools — no LLM, no external API calls, no per-request cost.

## Install

System binaries (Windows):
- Tesseract OCR — https://github.com/UB-Mannheim/tesseract/wiki (add to PATH).
- poppler-utils — https://github.com/oschwartz10612/poppler-windows/releases (add `bin` to PATH).
- Ghostscript — https://ghostscript.com/releases/gsdnld.html (needed by Camelot).

Python packages:

```bash
pip install -r scripts/indent_scan/requirements.txt
```

## Usage

```bash
python scripts/indent_scan/scan_indent.py path/to/indent.pdf > parsed.json
python scripts/indent_scan/scan_indent.py path/to/photo.jpg --lang eng > parsed.json
```

The script prints a JSON object to stdout:

```json
{
  "header": { "indentNumber": "IN-2026-014", "indentDate": "2026-08-27", "activity": "Site Survey" },
  "items": [
    { "sr_no": 1, "item_name": "Cement OPC 53", "unit": "bags",
      "have_qty": 0, "buy_qty": 200, "unit_price": 420, "amount": 84000, "remark": null }
  ],
  "warnings": [ ]
}
```

The shape matches what the indent bulk-import client (`src/services/indents.js`) consumes.

## How it's wired in this repo

Single path, no Supabase Edge Function, no LLM:

- **Production** — Vercel Python serverless function at `api/extract-indent.py`, which re-exports the FastAPI `app` from `ocr_server.py`. Client hits `VITE_OCR_ENDPOINT` (see `.env`).
- **Local dev** — `python scripts/indent_scan/ocr_server.py` runs the same FastAPI app on `http://127.0.0.1:8765`. Point `VITE_OCR_ENDPOINT` at `http://127.0.0.1:8765/extract` in `.env.local` to bypass the deployed function.
- **CLI** — `python scripts/indent_scan/scan_indent.py file.pdf` still works for one-off extraction.

Vercel's Python runtime cannot install `tesseract` / `poppler` / `ghostscript` binaries, so scanned/handwritten PDFs return an empty item list with a warning; text-layer PDFs (pdfplumber) work fine. For full OCR of scans on the server, deploy `ocr_server.py` to Render / Railway / Fly.io / Cloud Run with a Dockerfile that `apt-get install`s those binaries.

## What it does

1. **PDFs with a text layer** — uses `pdfplumber` for header text + `camelot-py` (lattice, then stream) for table extraction. Fastest and most accurate for digitally-generated PDFs.
2. **Scanned PDFs and photos** — falls back to `pdf2image` → OpenCV pre-processing (grayscale, adaptive threshold to handle mixed lighting) → `pytesseract` with `image_to_data` to get positioned words → line grouping → column mapping via alias dictionary.
3. **Column mapping** — a header-alias dictionary tolerates common variants (`Sr No / Sl No / #`, `Qty / Quantity / Required Qty`, `Rate / Unit Price`, etc.). Add more aliases in `COLUMN_ALIASES` for your specific template.
4. **Backfill** — if `amount` is missing but `qty × rate` exists, it's computed.

## Limitations vs LLM extraction

- Handwritten text: Tesseract struggles. Consider `PaddleOCR` or a specialist handwriting model — still no LLM required.
- Highly variable layouts: the header-mapping approach assumes one header row per table. For multi-header or nested tables you'll want a template-specific override.
- Merged cells and rotated text: Camelot's `lattice` mode handles ruled tables well; `stream` mode is a fallback for tables without lines.

## Extend

- Tune Tesseract config for your fonts: pass `config="--oem 1 --psm 6"` to `image_to_data` for uniform blocks of text.
- Add per-template overrides: keep a JSON in `scripts/indent_scan/templates/*.json` with fixed column indices for a known indent layout — skip the mapping heuristic entirely for that template.
