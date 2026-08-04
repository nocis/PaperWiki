#!/usr/bin/env python3
"""Extract visual figures from a PDF using PyMuPDF (fitz).

Usage:
  scripts/extract_figures.py <input.pdf> <outdir> [--min-dim 80]
      [--max-images 12] [--max-pixels 40000000] [--max-dim 1600]
      [--render-page1] [--page-scale 2.0]

Behavior:
  - Embedded raster images: walks every page in reading order (page, then
    bbox top-to-bottom, left-to-right), extracts Image XObjects, converts
    CMYK/alpha to PNG, dedupes by content hash, and filters tiny decorations.
  - Downscaling: images whose longer side exceeds --max-dim are shrunk
    (integer factor) so the archive stays web-friendly.
  - Key page render: with --render-page1, additionally renders page 1 (the
    teaser/architecture page) at the given scale.
  - Deterministic naming: figure_1.png, figure_2.png, ... then page_1.png.
  - Writes PNG files into <outdir> (created if needed) and prints the saved
    filenames, one per line, to stdout. Diagnostics go to stderr.

Exit codes: 0 = success (the figure set may legitimately be empty); 1 = hard
error (unreadable PDF, missing output dir). This script never fails over
individual image decode problems — those are skipped with a stderr note.
"""
import argparse
import hashlib
import math
import os
import sys

try:  # PyMuPDF >= 1.24 exposes the canonical name; fitz remains an alias.
    import pymupdf as fitz
except ImportError:  # pragma: no cover - older PyMuPDF installs
    import fitz


def extract_images(doc: fitz.Document, outdir: str, min_dim: int, max_images: int, max_pixels: int, max_dim: int) -> list:
    seen_xrefs: set[int] = set()
    seen_hashes: set[str] = set()
    saved: list[str] = []
    count = 0

    for page in doc:
        infos = page.get_image_info(xrefs=True)
        infos.sort(key=lambda i: (i["bbox"][1], i["bbox"][0]))
        for info in infos:
            if count >= max_images:
                return saved
            xref = info.get("xref") or 0
            if not xref or xref in seen_xrefs:
                continue
            seen_xrefs.add(xref)
            width, height = info.get("width") or 0, info.get("height") or 0
            if width < min_dim or height < min_dim or width * height > max_pixels:
                continue
            try:
                pix = fitz.Pixmap(doc, xref)
                if pix.colorspace is not None and pix.colorspace.n > 3:
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                if max_dim and max(pix.width, pix.height) > max_dim:
                    # shrink(n) divides both dimensions by 2**n: pick the
                    # smallest exponent that brings the longer side <= max_dim.
                    exponent = math.ceil(math.log2(max(pix.width, pix.height) / max_dim))
                    if exponent >= 1:
                        pix.shrink(exponent)
                digest = hashlib.md5(bytes(pix.samples)).hexdigest()
                if digest in seen_hashes:
                    continue
                seen_hashes.add(digest)
                name = f"figure_{count + 1}.png"
                with open(os.path.join(outdir, name), "wb") as fh:
                    fh.write(pix.tobytes("png"))
                saved.append(name)
                count += 1
            except Exception as exc:  # noqa: BLE001 - best-effort per image
                print(f"[figures] skip xref {xref}: {exc}", file=sys.stderr)
    return saved


def render_page(doc: fitz.Document, page_number: int, outdir: str, scale: float) -> str | None:
    try:
        page = doc.load_page(page_number)
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        name = f"page_{page_number + 1}.png"
        with open(os.path.join(outdir, name), "wb") as fh:
            fh.write(pix.tobytes("png"))
        return name
    except Exception as exc:  # noqa: BLE001 - best-effort
        print(f"[figures] render page {page_number + 1} failed: {exc}", file=sys.stderr)
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract figures from a PDF with PyMuPDF")
    parser.add_argument("input", help="path to the input PDF")
    parser.add_argument("outdir", help="output directory for extracted PNGs")
    parser.add_argument("--min-dim", type=int, default=80, help="skip images with either dimension below this (px)")
    parser.add_argument("--max-images", type=int, default=12, help="stop after this many embedded images")
    parser.add_argument("--max-pixels", type=int, default=40_000_000, help="skip images above this pixel count")
    parser.add_argument("--max-dim", type=int, default=1600, help="downscale images whose longer side exceeds this (0 = keep native)")
    parser.add_argument("--render-page1", action="store_true", help="also render page 1 as a teaser PNG")
    parser.add_argument("--page-scale", type=float, default=2.0, help="render scale for page 1")
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        print(f"[figures] input PDF not found: {args.input}", file=sys.stderr)
        return 1

    try:
        doc = fitz.open(args.input)
    except Exception as exc:  # noqa: BLE001
        print(f"[figures] cannot open PDF: {exc}", file=sys.stderr)
        return 1

    try:
        os.makedirs(args.outdir, exist_ok=True)
        saved = extract_images(doc, args.outdir, args.min_dim, args.max_images, args.max_pixels, args.max_dim)
        if args.render_page1 and doc.page_count > 0:
            teaser = render_page(doc, 0, args.outdir, args.page_scale)
            if teaser:
                saved.append(teaser)
        for name in saved:
            print(name)
        print(f"[figures] saved {len(saved)} figure(s) to {args.outdir}", file=sys.stderr)
        return 0
    finally:
        doc.close()


if __name__ == "__main__":
    sys.exit(main())
