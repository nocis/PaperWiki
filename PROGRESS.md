# PaperWiki — Progress Log

> Session handoff document. Read this first when resuming in a new session.
> Last updated: 2026-08-04.

## Current Status

**All phases code-COMPLETE (A compiler/API, B UI, C figures + health lint, D knowledge layer).**
**State: 3 papers compiled; citation map is match-only (0/2/1 resolved entries); knowledge layer live: 3 pieces, 2 articles, compile verified end-to-end.**
**Verification: PARTIAL — `yarn build` + browser smoke tests are manual (user runs them).**

Latest fixes shipped:

- ✅ **API spam fix** — `/knowledge` no longer loops `GET /api/knowledge` (terminal-status effect now keys on status string, not object identity); stale "running" knowledge snapshots surface as failed via `readEffectiveKnowledgeStatus` in both the page and the API.
- ✅ **Favorites / compile wipe** — `favorite: true` in `knowledge/articles/` frontmatter; compile wipes previously compiled articles except favorites; star toggles on `/knowledge` and article pages (`PATCH /api/knowledge/articles`); SCHEMA.md updated.
- ✅ **SCHEMA.md = LLM operating manual** — role preamble, workflows (ingest / answer / maintain / knowledge), co-evolution revision log.
- ✅ **Reset to zero** — `/health` Danger zone, double-confirm + server token (`{ confirm: "RESET" }`): moves `papers/compiled/*.pdf` + `papers/duplicates/` back to `papers/new/`, deletes wiki pages/index/log/proposals, derived dbs, figures, `.log/`, knowledge articles/index/log; keeps SCHEMA.md, journal, pieces, comments. Journal entry per reset.
- ✅ **AutoWiki-inspired features** — contrastive Novel Insight (`prior → update`, new compiles; legacy pages render as-is); typed relations persisted as `relations[]` frontmatter (compile writes, lint syncs from `## Relations` body + verifies slugs); citation graph renders 3 relation edge classes (temporal blue / contradicts red / impacts dashed) with legend; compile runs + failures auto-append `wiki/journal/` entries.
- ✅ **README + docs** — AutoWiki-style README (as-shipped posture, text-only showcase); GRILL.md glossary; ADR 0003 (relations in frontmatter).
- ✅ **Bug round 2** — reset preserves favorited knowledge articles (selective wipe); citation graph: category filter (one edge type at a time) + counts, node labels, neighborhood highlight on hover, edge tooltips with notes/references, click-to-open info panel (title/topic/year/essence/relations/cites); relations accuracy: end-of-run finalize pass re-maps typed relations against the full final index (one slim call per compiled paper, code-side validation, body patched in place).

## Quick Resume

```bash
yarn build          # 1. typecheck — fix errors first (user runs; agents must not)
yarn dev            # 2. browser smoke
bash scripts/figures.sh papers/compiled/<slug>.pdf /tmp/figs --render-page1   # figures standalone
```

## Environment Notes

- `/app` symlinks to `/home/nocis/Projects/Research/PaperWiki` — same directory.
- `node_modules` installed; `node_modules/.bin/tsx` works. **No yarn/tsc/install runs by agents — user runs them.**
- Python 3.11, **no ensurepip** → `figures.sh` falls back to `--without-pip` venv + `--target` site dir; PyMuPDF 1.28.0 at `.pymupdf/`.
- Gateway models: deepseek-v4-flash/pro, glm-5.1/5.2, gpt-5.6-luna, grok-4.5, kimi-k2.6/k2.7-code/k3, minimax-m2.7/m3, qwen3.6/3.7, hy3, mimo-v2.5(-pro).
- API keys: `OPENCODE_API_KEY` (Go gateway) + `DEEPSEEK_API_KEY` (DeepSeek official, models `deepseek-chat`/`deepseek-reasoner`) in `.env.local`; optional `WIKI_LLM_PROVIDER` / `WIKI_LLM_MODEL` defaults.
- Citation rebuild: `yarn citations [--provider X] [--model Y] [--slug <slug>]`; progress at `.log/citations-status.json` (+ jsonl).

## Pointers

- Wiki conventions/invariants/workflows: `wiki/SCHEMA.md` (the LLM operating manual — co-evolve it).
- Architectural decisions: `docs/adr/0001-citation-map.md`, `docs/adr/0002-knowledge-layer.md`.
- No git operations allowed (project rule).
