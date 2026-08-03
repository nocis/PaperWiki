# PaperWiki — Progress Log

> Session handoff document. Read this first when resuming in a new session.
> Last updated: 2026-08-03.

## Current Status

**Phase A (compiler + API + scaffold): code COMPLETE. Verification: PARTIAL.**

- ✅ LLM pre-flight health check verified working (`tsx` one-shot test passed).
- ⏳ `yarn build` (typecheck) — NOT yet run.
- ⏳ End-to-end `yarn compile` — NOT yet run. **3 real arXiv PDFs are already
  sitting in `papers/new/` waiting**: `1503.03585v8.pdf`, `2006.11239v2.pdf`,
  `2010.02502v4.pdf`.
- ⏳ Comment API curl smoke test — NOT yet run.
- 🔜 Phase B (all UI) — NOT started.

## Quick Resume

```bash
yarn build          # 1. typecheck — fix any errors first
yarn compile        # 2. e2e test with the 3 PDFs already in papers/new/
```

Then verify: `papers/new/` empty · `papers/compiled/` has 3 PDFs named by REAL
title slug (e.g. `2006.11239v2.pdf` → `<real-title>.pdf`) · `/pdfs/<slug>.pdf`
serves from the compiled archive · `wiki/papers/*.md` + `wiki/topics/*.md` · `comments/<slug>/` dirs ·
`wiki/log.md` entries · `data/wiki-db.json` cites/citedBy cross-links.

Optional isolated fixtures (3 fake papers with citation chain, 2 with arXiv-style names):
```bash
python3 -m pip install --target=/tmp/pylibs fpdf2   # NOTE: no ensurepip in this env
PYTHONPATH=/tmp/pylibs python3 scripts/make_fixtures.py
```

Comment API smoke test: `yarn dev`, then curl `GET/POST /api/comments/<slug>`
and `DELETE /api/comments/<slug>/<id>` (see earlier checklist in conversation).

## Architecture (locked decisions)

| Decision | Choice |
|---|---|
| Stack | Next.js 14.2 + React 18.3 + TS + Tailwind v3 |
| PDF annotate | `react-pdf-highlighter@6.1.0` + `pdfjs-dist@3.11.174` (pinned) |
| Wiki storage | **Markdown files in `wiki/` = source of truth**; `data/wiki-db.json` = derived index (rebuilt from frontmatter, atomic per-paper) |
| LLM | OpenCode Go gateway `https://opencode.ai/zen/go/v1`, `OPENCODE_API_KEY` env; default model `deepseek-v4-flash`; override `--model` / `WIKI_LLM_MODEL` |
| Compile semantics | `papers/new/` = work queue; pre-flight LLM check; **fail-hard** on LLM errors (unprocessed PDFs stay in inbox); per-paper atomic db write |
| Naming | slug from **real title** (LLM → PDF metadata → filename); arXiv names like `2006.11239.pdf` get renamed; duplicates → `papers/duplicates/` (non-fatal skip) |
| Topics | autowiki modes: standalone / merged (<5, inline H3 subtopics) / split (≥5); max depth 3; fitness check; consolidation detected → `wiki/proposals.md` queue, NEVER auto-applied |
| Comments | private reading notes in `comments/<slug>/*.json` — **quarantined**, never fed to LLM |
| Reorgs | Confirm-tier only; flat `papers/compiled/` (stable URLs, no three-tree mirroring) |
| Chat | two-call pipeline (retrieve over index → answer with `[[slug]]` citations); not an agent |
| Git | **no git operations allowed** (project rule) |

## File Map (what exists)

```
scripts/compile.ts          # incremental LLM compiler (4 phases/PDF, 3 LLM calls)
scripts/make_fixtures.py    # fixture generator (fpdf2)
src/lib/llm.ts              # OpenCode Go client (health check, llmJson, llmChat)
src/lib/extract.ts          # pdfjs Node text extraction (first 12 + last 4 pages, 60k cap)
src/lib/prompts.ts          # 5 prompt wrappers (analyze/classify/synthesize/retrieve/answer)
src/lib/wiki.ts             # paths, frontmatter I/O, deriveDb w/ invariant checks, index/log/proposals
src/lib/templates.ts        # deterministic paper/topic page renderers
src/app/api/comments/[slug]/route.ts        # GET, POST
src/app/api/comments/[slug]/[id]/route.ts   # DELETE
src/app/{layout,page}.tsx + globals.css     # minimal shell (real UI = Phase B)
wiki/SCHEMA.md              # the schema layer — conventions + invariants
wiki/{index,log,proposals}.md · wiki/{papers,topics,concepts}/
data/wiki-db.json           # derived index (seeded empty)
```

## Bugs Fixed This Session

1. **Pre-flight "LLM returned an empty response"**: health check used
   `max_tokens: 1`; reasoning models (deepseek-v4-flash) spend it on
   `reasoning_content` and return empty `content`. Fix: health check is now
   transport-level only (2xx + choices array), `max_tokens: 32`.
2. **pdfjs "Cannot polyfill DOMMatrix/Path2D" warnings** (Node, missing canvas
   module): harmless for text extraction; silenced via `verbosity: 0` in
   `getDocument`.

## Environment Notes

- `/app` is symlinked to the real project path (`/home/nocis/Projects/Research/PaperWiki`) — same directory.
- `node_modules` installed (264 pkgs); `node_modules/.bin/tsx` works.
- Python 3.11 + pip 23.0.1; **no ensurepip** → use `pip install --target=...`.
- Gateway models available: deepseek-v4-flash/pro, glm-5.1/5.2, gpt-5.6-luna,
  grok-4.5, kimi-k2.6/k2.7-code/k3, minimax-m2.7/m3, qwen3.6/3.7, hy3, mimo-v2.5(-pro).

## Phase B Scope (remaining)

1. `src/components/WikiMarkdown.tsx` — react-markdown + remark-gfm + `[[slug]]` → route links (paper slugs → `/paper/[slug]`, else `/wiki/...`).
2. `/` dashboard — topic tree (mode-aware) w/ synthesis blurbs, recent-ingest timeline from `log.md`, proposals badge.
3. `/wiki/[[...path]]/page.tsx` — renders any `wiki/*.md`.
4. `/paper/[slug]/page.tsx` — tabs **Annotate** (70/30 `PdfViewer` + `CommentSidebar`, highlight→popup→POST, click→jump, delete) and **Wiki** (paper md page; references as links). Viewer must be `next/dynamic` ssr:false; configure pdfjs worker (`pdfjs-dist@3.11.174`).
5. `/chat` + `POST /api/chat` — retrieval call (`queryRetrievePrompt` over `SCHEMA.md`+`index.md`) → answer call (`buildAnswerMessages`); model dropdown; ephemeral localStorage state; non-streaming.
6. `yarn build` + full smoke test.
