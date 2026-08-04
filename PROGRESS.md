# PaperWiki — Progress Log

> Session handoff document. Read this first when resuming in a new session.
> Last updated: 2026-08-04.

## Current Status

**All phases code-COMPLETE (A compiler/API, B UI, C figures + health lint, D knowledge layer).**
**State: 3 papers compiled; citation map is match-only (0/2/1 resolved entries); paper pages show the raw bibliography verbatim with link markers.**
**Verification: PARTIAL — `yarn build` + browser smoke tests are manual.**

- ✅ Citation pipeline minimized: raw lists displayed verbatim on paper pages; the map holds only `{entry, matchedSlug}` matches; the relation call is match-only (tiny output); matching is LLM-only. Verified: DDIM → {Sohl-Dickstein, DDPM}, DDPM → {Sohl-Dickstein}, reciprocity ok.
- ✅ De-over-engineering pass: one generic progress factory (`src/lib/progress.ts` + `runs.ts`, replacing 3 copied modules, 784 → 446 lines); `data/knowledge-db.json` dropped (live derivation); stale-run guard shared; dead exports removed (`pieceProvenance`, `addCitedBy`, `setCites`, `resolveReferences`, `normalizeTitle`, citation batching); prompts trimmed (match-only citation prompt, generic retry budget, tidy numbering).
- ✅ `tsx` typecheck clean (full project).
- ✅ lint: 0 errors; 3 orphan-piece warnings expected (chat pieces await first knowledge compile).
- ⏳ Knowledge compile on the 3 chat pieces — run from `/knowledge` once you're ready.
- ⏳ `yarn build` typecheck — run manually.
- ⏳ `yarn dev` smoke: `/knowledge` page (edit/topics/provenance), citation graph tooltip, paper page citations display.

## Quick Resume

```bash
yarn build          # 1. typecheck — fix errors first
yarn dev            # 2. browser smoke
bash scripts/figures.sh papers/compiled/<slug>.pdf /tmp/figs --render-page1   # figures standalone
```

## Architecture (locked)

| Decision | Choice |
|---|---|
| Stack | Next.js 14.2 + React 18.3 + TS + Tailwind v3; PDF annotate: `react-pdf-highlighter@6.1.0` + `pdfjs-dist@3.11.174` |
| Wiki storage | **`wiki/*.md` = source of truth**; `data/wiki-db.json` = derived index (atomic per-paper rebuild) |
| LLM | Providers registry `src/lib/llm-providers.ts`: **OpenCode Go** gateway (`OPENCODE_API_KEY`, `https://opencode.ai/zen/go/v1`) + **DeepSeek** official (`DEEPSEEK_API_KEY`, `https://api.deepseek.com/v1`); provider/model configured **site-wide in the nav bar**; model lists are **not bundled** — `GET /api/llm` fetches them live from each provider's `/models` endpoint (5-min server cache, per-provider failures isolated, `keySet`/`modelsError` exposed); env defaults `WIKI_LLM_PROVIDER` / `WIKI_LLM_MODEL`. Prefs are hydration-safe: the client never defaults provider/model before the server catalog loads |
| LLM availability | `GET /api/llm/availability` (cached 60s ok / 20s bad, `missing-key` short-circuits); site-wide banner + nav status dot; compile/rebuild buttons blocked while unavailable (`checking`/`unavailable`), re-check on click; `yarn citations` + `yarn compile` run their own LLM pre-flight; POST routes 503 on missing key |
| Compile | `papers/new/` = work queue; pre-flight LLM check; **fail-hard on LLM errors**; slug from real title; duplicates → `papers/duplicates/` (non-fatal); **2 LLM calls per paper** — merged analyze+cite-map+classify over the raw text (classify reads the text directly, 16k output budget), then topic synthesis after code-side topic selection |
| Citations | **Citation Map** `data/citations/map.json` = derived truth: per-paper the **reference list extracted by the analyze LLM at compile time** + LLM-normalized records pinned to slugs; `## Citations` on paper pages; rebuilt via `yarn citations` from `/health` (per-paper or all) — rebuild **only re-maps the persisted extracted list**, never re-reads the PDF; lint auto-fixes `cites[]` drift from the map; `/citations` = SVG force graph |
| Figures | **PyMuPDF** in `.pymupdf/` venv; best-effort during compile → `papers/compiled/<slug>_figures/`, `figures[]` fm + `## Figures` embeds, served at `/figures/<slug>/<file>` |
| Topics | autowiki modes standalone/merged(<5)/split(≥5); depth ≤3; consolidation → `wiki/proposals.md` queue, NEVER auto-applied |
| Lint | `yarn lint:wiki` + `/health`: mechanical invariants auto-fixed + logged; structural → proposals |
| Comments | `comments/<slug>/*.json` — quarantined, never fed to LLM |
| Knowledge | `knowledge/` = human's own knowledge: `pieces/` (Add-to-knowledge only, note + chat kinds), `articles/` (DERIVED — from-zero per compile, LLM-discovered overlapping topics + Academic Review vs wiki truth), `index.md` (Wikipedia-style nav), `log.md`; `scripts/compile-knowledge.ts` + `/api/knowledge(/compile)` + `/knowledge` UI + AddToKnowledgeButton on notes/chat selection; lint checks pieces/articles/staleness |
| Reorgs | Confirm-tier only; flat `papers/compiled/` (stable URLs, no three-tree mirroring) |
| Chat | two-call pipeline (retrieve over index → answer with `[[slug]]` citations); not an agent |
| Git | **no git operations allowed** (project rule) |

## File Map

```
scripts/compile.ts          # incremental LLM compiler (merged analyze+cite-map+classify → synthesize, 2 LLM calls)
scripts/compile-knowledge.ts# from-zero knowledge compiler (cluster → per-article synthesize+review, 2-phase)
scripts/rebuild-citations.ts# citation map rebuild (yarn citations; per-paper LLM calls, PDF fallback for legacy)
scripts/extract_figures.py  # PyMuPDF figure extractor (+ page-1 render, downscale)
scripts/figures.sh          # venv bootstrap + run (idempotent, ensurepip fallback)
scripts/lint.ts             # wiki health linter CLI
scripts/make_fixtures.py    # fixture generator (fpdf2)
src/lib/llm-providers.ts    # provider registry (opencode + deepseek) — server-only, publicCatalog() + keySet
src/lib/llm.ts, llm-availability.ts, extract.ts, extract-figures.ts, prompts.ts, wiki.ts,
         templates.ts, lint-wiki.ts, compile-progress.ts, knowledge.ts, knowledge-progress.ts,
         citations.ts, citations-progress.ts
src/app/figures/[slug]/[file]/route.ts     # figure file server
src/app/api/{llm,llm/availability,health,chat,comments...,compile,citations,knowledge,knowledge/compile}/route.ts
src/app/{layout,page}.tsx · health/page.tsx · paper/[slug]/page.tsx · wiki/[[...path]]/page.tsx · chat/page.tsx ·
        citations/page.tsx · knowledge/page.tsx · knowledge/articles/[[...slug]]/page.tsx ·
        knowledge/pieces/[[...slug]]/page.tsx
src/components/ FigureGallery, AnnotatePanel, ChatPanel, CitationGraph, CommentSidebar,
              AddToKnowledgeButton, KnowledgeDashboard,
              LlmPrefsProvider, LlmStatusBanner, NavLlmSelect, PaperTabs, PdfViewer,
              PendingCompilePanel, ProviderModelSelect, WikiMarkdown
wiki/SCHEMA.md              # schema layer — conventions + invariants (read before writing wiki/)
wiki/{index,log,proposals}.md · wiki/{papers,topics,concepts,journal}/ · knowledge/{pieces,articles} ·
    data/wiki-db.json · data/citations/map.json
docs/adr/0001-citation-map.md · docs/adr/0002-knowledge-layer.md
```

## Bugs Fixed

1. **PyMuPDF `shrink(n)` is power-of-2** (divides by `2**n`). Fix: `exponent = ceil(log2(longer/max_dim))`.
2. **Lint stale-citedBy logic inverted** — pruned real reciprocal entries. Fix: stale ⇔ citing paper's `cites[]` lacks this paper.
3. *(Earlier)* LLM health check `max_tokens: 1` → empty content on reasoning models; now transport-level only.
4. **Citation rebuild skipped every paper** — the citation step extracted the bibliography from PDF text itself (window missed sections, heading detection was fragile). Corrected to the intended design: the citation source is the **reference list the analyze LLM already extracts** (`analysis.references`), persisted in the map entry; compile's build-citations parses+matches that list, and rebuild re-maps only the persisted list — no PDF re-extraction anywhere. Rebuild also counts skipped papers correctly and UI-spawned runs no longer record a duplicate `run-started` (`resumeCitationsRun`/`resumeCompileRun`).

## Environment Notes

- `/app` symlinks to `/home/nocis/Projects/Research/PaperWiki` — same directory.
- `node_modules` installed; `node_modules/.bin/tsx` works. **No yarn/tsc/install runs by agents — user runs them.**
- Python 3.11, **no ensurepip** → `figures.sh` falls back to `--without-pip` venv + `--target` site dir; PyMuPDF 1.28.0 at `.pymupdf/`.
- Gateway models: deepseek-v4-flash/pro, glm-5.1/5.2, gpt-5.6-luna, grok-4.5, kimi-k2.6/k2.7-code/k3, minimax-m2.7/m3, qwen3.6/3.7, hy3, mimo-v2.5(-pro).
- API keys: `OPENCODE_API_KEY` (Go gateway) + `DEEPSEEK_API_KEY` (DeepSeek official, models `deepseek-chat`/`deepseek-reasoner`) in `.env.local`; optional `WIKI_LLM_PROVIDER` / `WIKI_LLM_MODEL` defaults. Key presence is exposed as `keySet` via `GET /api/llm`; missing keys block LLM work with a banner (server restart needed after editing `.env.local`).
- Citation rebuild: `yarn citations [--provider X] [--model Y] [--slug <slug>]`; progress at `.log/citations-status.json` (+ jsonl).
