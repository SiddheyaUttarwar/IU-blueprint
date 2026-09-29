"""
Indent-cum-Budget scanner — extracts structured items from a PDF (only) of an
indent sheet WITHOUT any LLM. Two paths, tried in order:

  1. Text-based PDFs → pdfplumber + camelot (fast, deterministic, free).
  2. Scanned / handwritten PDFs → pdf2image rasterises each page, OpenCV
     cleans it up, pytesseract OCRs it. Whatever Tesseract can read is
     returned; the frontend shows every field as an editable input so the
     user can correct anything unclear in place. No LLM is ever called.

Images (JPG/PNG etc.) are intentionally NOT supported — indent uploads are
restricted to PDF at the UI level.

Output: JSON on stdout, matching the shape our client expects for bulk indent import:
  {
    "header": {
      "indentNumber": str | null,
      "indentDate":   "YYYY-MM-DD" | null,
      "activity":     str | null
    },
    "items": [
      {
        "sr_no":       int  | null,
        "item_name":   str,
        "item_description": str | null,
        "unit":        str  | null,
        "have_qty":    float | null,
        "buy_qty":     float | null,
        "unit_price":  float | null,
        "amount":      float | null,
        "remark":      str  | null
      },
      ...
    ],
    "warnings": [ str, ... ]
  }

Usage:
  python scripts/indent_scan/scan_indent.py path/to/indent.pdf > parsed.json

Runtime Python deps (install once):
  pip install -r scripts/indent_scan/requirements.txt

System binaries (needed by the pip packages above — will not fit on Vercel):
  - Tesseract OCR       Windows installer: https://github.com/UB-Mannheim/tesseract/wiki
  - poppler-utils       Windows: https://github.com/oschwartz10612/poppler-windows/releases
  - Ghostscript         Windows: https://ghostscript.com/releases/gsdnld.html

Deploy target: any host that can install the three binaries above — Render,
Railway, Fly.io, Google Cloud Run, or your own server. Vercel's serverless
Python runtime does NOT allow apt-get / binary installs, so the OCR branch
will silently return an empty result there.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, asdict, field
from datetime import datetime
from pathlib import Path
from typing import Any


# ---------- utility ---------------------------------------------------------

DATE_PATTERNS = [
    (r"(\d{4})-(\d{2})-(\d{2})",                 "%Y-%m-%d"),
    (r"(\d{2})[-/](\d{2})[-/](\d{4})",           "%d-%m-%Y"),
    (r"(\d{1,2})[-/](\d{1,2})[-/](\d{2})",       "%d-%m-%y"),
    (r"(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.? (\d{4})", "%d %b %Y"),
]

# Common indent column labels we try to match — order matters (longer first).
# Aliases include the customer-facing labels the UI renders so PDFs printed from our own
# templates round-trip cleanly, plus older variants seen in supplier / legacy indent forms.
COLUMN_ALIASES = {
    "sr_no":            ["s.no", "sr no", "sr.no", "sl no", "slno", "sr", "s no", "no.", "#"],
    "item_name":        ["item name", "description", "particulars", "material", "item"],
    "item_description": ["item detailed description", "detailed description", "specification", "specs", "make", "brand"],
    "unit":             ["unit", "uom", "measure"],
    "have_qty":         ["quantity in stock", "qty in stock", "available qty", "have qty", "in stock", "stock"],
    "buy_qty":          ["quantity indented", "qty indented", "indented qty", "required qty", "buy qty", "qty required", "qty to buy", "qty", "quantity"],
    "unit_price":       ["amount per item", "amount per unit", "rate per item", "rate per unit", "rate", "unit rate", "unit price", "price"],
    "amount":           ["total amount", "amount", "total", "value", "sub total", "subtotal"],
    "remark":           ["remarks", "remark", "note", "notes"],
}


def try_parse_date(text: str) -> str | None:
    """Return an ISO YYYY-MM-DD date if any known pattern matches, else None."""
    for pat, fmt in DATE_PATTERNS:
        m = re.search(pat, text, flags=re.IGNORECASE)
        if not m:
            continue
        try:
            return datetime.strptime(m.group(0), fmt).date().isoformat()
        except ValueError:
            continue
    return None


def normalize(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip().lower()


def match_column(header_cell: str) -> str | None:
    n = normalize(header_cell)
    for canonical, aliases in COLUMN_ALIASES.items():
        for a in aliases:
            if a == n or a in n:
                return canonical
    return None


def to_number(x: Any) -> float | None:
    if x is None:
        return None
    s = str(x).strip().replace(",", "").replace("₹", "").replace("Rs.", "").replace("rs", "")
    s = re.sub(r"[^0-9.\-]", "", s)
    if not s or s in ("-", "."):
        return None
    try:
        return float(s)
    except ValueError:
        return None


# ---------- header extraction ----------------------------------------------

INDENT_NO_PATTERNS = [
    r"indent\s*(?:no|number|#)?\s*[:\-]?\s*([A-Z0-9\-/]{3,})",
    r"i\.?n\.?\s*[:\-]?\s*([A-Z0-9\-/]{3,})",
]
ACTIVITY_PATTERNS = [
    r"activity\s*[:\-]\s*(.+?)(?:\n|$)",
    r"project\s*[:\-]\s*(.+?)(?:\n|$)",
    r"work\s*[:\-]\s*(.+?)(?:\n|$)",
]


def extract_header(text: str) -> dict[str, str | None]:
    header: dict[str, str | None] = {"indentNumber": None, "indentDate": None, "activity": None}
    header["indentDate"] = try_parse_date(text)
    for pat in INDENT_NO_PATTERNS:
        m = re.search(pat, text, flags=re.IGNORECASE)
        if m:
            header["indentNumber"] = m.group(1).strip()
            break
    for pat in ACTIVITY_PATTERNS:
        m = re.search(pat, text, flags=re.IGNORECASE)
        if m:
            header["activity"] = m.group(1).strip()
            break
    return header


# ---------- table extraction from PDFs -------------------------------------

def parse_table_rows(table: list[list[str]]) -> list[dict[str, Any]]:
    """Given a raw table (list of rows, first row is header), map columns and return items."""
    if not table or len(table) < 2:
        return []
    header, *body = table
    mapping: dict[int, str] = {}
    for i, cell in enumerate(header):
        col = match_column(cell or "")
        if col:
            mapping[i] = col
    items: list[dict[str, Any]] = []
    for raw_row in body:
        if not any((c or "").strip() for c in raw_row):
            continue
        row = {"sr_no": None, "item_name": "", "item_description": None, "unit": None,
               "have_qty": None, "buy_qty": None, "unit_price": None, "amount": None, "remark": None}
        for i, cell in enumerate(raw_row):
            col = mapping.get(i)
            if not col:
                continue
            v = (cell or "").strip()
            if not v:
                continue
            if col == "sr_no":
                n = to_number(v)
                row["sr_no"] = int(n) if n is not None else None
            elif col in ("have_qty", "buy_qty", "unit_price", "amount"):
                row[col] = to_number(v)
            else:
                row[col] = v
        if row["item_name"] or row["buy_qty"] or row["amount"]:
            items.append(row)
    return items


def extract_from_pdf(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    header: dict[str, Any] = {"indentNumber": None, "indentDate": None, "activity": None}
    items: list[dict[str, Any]] = []

    # 1) Try text extraction + camelot for tables.
    try:
        import pdfplumber
        with pdfplumber.open(path) as pdf:
            full_text = "\n".join((p.extract_text() or "") for p in pdf.pages)
        if full_text.strip():
            header.update({k: v for k, v in extract_header(full_text).items() if v})
    except Exception as e:
        warnings.append(f"pdfplumber failed: {e}")

    try:
        import camelot
        tables = camelot.read_pdf(str(path), pages="all", flavor="lattice")
        if not len(tables):
            tables = camelot.read_pdf(str(path), pages="all", flavor="stream")
        for t in tables:
            rows = t.df.values.tolist()
            items.extend(parse_table_rows(rows))
    except Exception as e:
        warnings.append(f"camelot failed: {e}")

    # 2) Fallback to OCR (rasterize + Tesseract) if the text/table path gave us nothing —
    #    this is the scanned/handwritten branch. Whatever Tesseract can read gets returned;
    #    the frontend renders every field as editable so the user can correct unclear values.
    if not items:
        ocr_items, ocr_warns = extract_via_ocr(path)
        items.extend(ocr_items)
        warnings.extend(ocr_warns)

    return header, items, warnings


# ---------- OCR fallback ---------------------------------------------------

def extract_via_ocr(path: Path, lang: str = "eng") -> tuple[list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    try:
        import cv2
        import numpy as np
        from PIL import Image
        import pytesseract
    except ImportError as e:
        # No LLM fallback by design. If Tesseract isn't installed, return an empty result
        # with a clear message — the frontend will show an empty grid with editable rows so
        # the user can transcribe what they see manually.
        return [], [f"OCR unavailable on this host ({e}). Install Tesseract + OpenCV, or upload a text-based PDF instead."]

    images: list[Any] = []
    if path.suffix.lower() == ".pdf":
        try:
            from pdf2image import convert_from_path
            images = convert_from_path(str(path), dpi=300)
        except Exception as e:
            return [], [f"pdf2image failed: {e}"]
    else:
        try:
            images = [Image.open(path)]
        except Exception as e:
            return [], [f"PIL open failed: {e}"]

    all_items: list[dict[str, Any]] = []
    for idx, img in enumerate(images):
        try:
            arr = np.array(img.convert("RGB"))
            gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
            # Adaptive threshold cleans up mixed lighting on photos.
            th = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                       cv2.THRESH_BINARY, 31, 15)
            # OCR with layout preservation — tsv output gives us bounding boxes.
            data = pytesseract.image_to_data(th, lang=lang, output_type=pytesseract.Output.DICT)
            rows = group_ocr_words_into_rows(data)
            page_items = parse_ocr_rows(rows)
            all_items.extend(page_items)
        except Exception as e:
            warnings.append(f"OCR page {idx + 1} failed: {e}")

    return all_items, warnings


def group_ocr_words_into_rows(data: dict) -> list[list[str]]:
    """Bucket OCR words by their line index and sort left-to-right."""
    lines: dict[tuple[int, int, int, int], list[tuple[int, str]]] = {}
    for i, txt in enumerate(data.get("text", [])):
        if not txt or not txt.strip():
            continue
        key = (data["page_num"][i], data["block_num"][i], data["par_num"][i], data["line_num"][i])
        lines.setdefault(key, []).append((data["left"][i], txt))
    out: list[list[str]] = []
    for key in sorted(lines.keys()):
        words = sorted(lines[key], key=lambda x: x[0])
        out.append([w for _, w in words])
    return out


def parse_ocr_rows(rows: list[list[str]]) -> list[dict[str, Any]]:
    """Look for a header row (contains 'qty' or 'amount') then parse subsequent rows into items."""
    header_idx = None
    for i, row in enumerate(rows):
        joined = " ".join(row).lower()
        if any(k in joined for k in ("qty", "quantity", "amount", "rate", "unit")):
            header_idx = i
            break
    if header_idx is None:
        return []
    header = rows[header_idx]
    mapping: dict[int, str] = {}
    for i, cell in enumerate(header):
        col = match_column(cell)
        if col:
            mapping[i] = col
    items: list[dict[str, Any]] = []
    for row in rows[header_idx + 1:]:
        # Pad/truncate to header width
        if len(row) < len(header):
            row = row + [""] * (len(header) - len(row))
        item = {"sr_no": None, "item_name": "", "item_description": None, "unit": None,
                "have_qty": None, "buy_qty": None, "unit_price": None, "amount": None, "remark": None}
        for i, cell in enumerate(row):
            col = mapping.get(i)
            if not col:
                continue
            if col == "sr_no":
                n = to_number(cell)
                item["sr_no"] = int(n) if n is not None else None
            elif col in ("have_qty", "buy_qty", "unit_price", "amount"):
                item[col] = to_number(cell)
            else:
                item[col] = cell.strip() or None
        if item["item_name"] or item["buy_qty"] or item["amount"]:
            items.append(item)
    return items


# ---------- CLI -------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description="Extract indent items from a PDF or photo (no LLM).")
    ap.add_argument("input", help="Path to indent PDF or image (JPG/PNG).")
    ap.add_argument("--lang", default="eng", help="Tesseract language code (default: eng).")
    args = ap.parse_args()

    path = Path(args.input)
    if not path.exists():
        print(json.dumps({"error": f"File not found: {path}"}), file=sys.stderr)
        return 2

    warnings: list[str] = []
    header: dict[str, Any] = {"indentNumber": None, "indentDate": None, "activity": None}
    items: list[dict[str, Any]] = []

    if path.suffix.lower() == ".pdf":
        header, items, warnings = extract_from_pdf(path)
    else:
        ocr_items, ocr_warns = extract_via_ocr(path, lang=args.lang)
        items.extend(ocr_items)
        warnings.extend(ocr_warns)

    # Sanity: if amount is missing but qty × rate exists, backfill.
    for it in items:
        if it["amount"] is None and it["buy_qty"] and it["unit_price"]:
            it["amount"] = round(it["buy_qty"] * it["unit_price"], 2)

    print(json.dumps({"header": header, "items": items, "warnings": warnings}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
