# PaperWiki — Progress Log

> Session handoff. Read `.codebase/` first (map.md = structure, notes.md = gotchas,
> purpose.md = why). This file is the quick-resume + environment sheet.
> Last updated: 2026-08-13.

## Status

Feature-complete (compiler/API, UI, figures + health lint, knowledge layer).
3 papers compiled (diffusion) under one milestone topic; knowledge layer live
(3 pieces, 2 articles). Post-stabilization refactor (2026-08-13) DONE and
user-verified — see `docs/adr/0005-post-stabilization-refactor.md`.

## Quick Resume

```bash
yarn build          # 1. typecheck — fix errors first (user runs; agents must not)
yarn dev            # 2. browser smoke
bash scripts/figures.sh papers/compiled/<slug>.pdf /tmp/figs --render-page1   # figures standalone
```

**Caveat:** `next build` does NOT compile `scripts/` — after any script change,
smoke manually: `yarn compile`, `yarn citations`, `yarn lint:wiki`.

## Environment Notes

- `/app` symlinks to `/home/nocis/Projects/Research/PaperWiki` — same directory.
- `node_modules` installed; `node_modules/.bin/tsx` works. **No yarn/tsc/install runs by agents — user runs them.**
- Python 3.11, **no ensurepip** → `figures.sh` falls back to `--without-pip` venv + `--target` site dir; PyMuPDF 1.28.0 at `.pymupdf/`.
- Gateway models: deepseek-v4-flash/pro, glm-5.1/5.2, gpt-5.6-luna, grok-4.5, kimi-k2.6/k2.7-code/k3, minimax-m2.7/m3, qwen3.6/3.7, hy3, mimo-v2.5(-pro).
- API keys: `OPENCODE_API_KEY` (Go gateway) + `DEEPSEEK_API_KEY` (DeepSeek official, models `deepseek-chat`/`deepseek-reasoner`) in `.env.local`; optional `WIKI_LLM_PROVIDER` / `WIKI_LLM_MODEL` defaults.
- Citation rebuild: `yarn citations [--provider X] [--model Y] [--slug <slug>]`; progress at `.log/citations-status.json` (+ jsonl).

## Pointers

- Structure/gotchas/why: `.codebase/` (map.md, notes.md, purpose.md) — authoritative.
- LLM operating manual (conventions/invariants/workflows): `wiki/SCHEMA.md`.
- Architecture: `README.md` §3–4; decisions: `docs/adr/` (0001–0005).
- No git operations allowed (project rule).
