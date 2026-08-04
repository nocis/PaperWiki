#!/usr/bin/env bash
# Bootstrap a local PyMuPDF venv (once) and run figure extraction.
#
# The venv lives at .pymupdf/ (git-ignored). On first run it is created and
# PyMuPDF is installed into it; subsequent runs reuse it. If the environment
# has no ensurepip, falls back to a --without-pip venv plus a --target site
# packages dir on PYTHONPATH.
#
# Usage: scripts/figures.sh <input.pdf> <outdir> [extract_figures.py args...]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$ROOT/.pymupdf"
SITE_DIR="$VENV_DIR/site"
PY="$VENV_DIR/bin/python"

if [ ! -x "$PY" ]; then
  echo "[figures] bootstrapping venv at .pymupdf/ ..." >&2
  python3 -m venv "$VENV_DIR" 2>/dev/null \
    || python3 -m venv --without-pip "$VENV_DIR"
  if "$PY" -m pip --version >/dev/null 2>&1; then
    "$PY" -m pip install --quiet --upgrade pip
    "$PY" -m pip install --quiet "PyMuPDF"
  else
    echo "[figures] no ensurepip — installing PyMuPDF to $SITE_DIR (PYTHONPATH)" >&2
    python3 -m pip install --quiet --target="$SITE_DIR" "PyMuPDF"
  fi
fi

if [ ! -d "$SITE_DIR" ]; then
  exec "$PY" "$ROOT/scripts/extract_figures.py" "$@"
fi

PYTHONPATH="$SITE_DIR${PYTHONPATH:+:$PYTHONPATH}" \
  exec "$PY" "$ROOT/scripts/extract_figures.py" "$@"
