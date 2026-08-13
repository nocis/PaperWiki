<!-- Priority: critical | Updated: 2026-08-13 -->
# Map

Next.js 14 (App Router) + TypeScript (strict) + Tailwind. Path alias `@/*` →
`./src/*`. Package manager: yarn.

## Commands (the maintainer runs these — agents must not, per AGENTS.md)

| Command | Does |
|---|---|
| `yarn dev` | Start the web app |
| `yarn build` | Typecheck + production build — the verification gate |
| `yarn compile` | Ingest PDFs from `papers/new/` (`tsx scripts/compile.ts`) |
| `yarn citations [--slug s] [--provider p] [--model m]` | Rebuild citation matches from persisted reference lists (never re-reads PDFs) |
| `yarn lint:wiki` | Wiki invariant linter: mechanical auto-fixes + structural proposals |
| `yarn figures` | Figure extraction helper (`bash scripts/figures.sh` → Python/PyMuPDF vendored at `.pymupdf/`) |

No test suite. Verification = `yarn build` + browser smoke tests, run manually.

## Entry points

- Web app: `src/app/` — routes `/` (compile dashboard), `/wiki`, `/paper/<slug>`,
  `/citations`, `/knowledge`, `/chat`, `/health`, `/figures`, `/pdfs`; API
  routes under `src/app/api/` (chat, citations, comments, compile, health,
  knowledge, llm).
- CLI pipelines (post-R4/R13 shape — the old single-file scripts are now thin
  drivers over module dirs):
  - `scripts/compile.ts` — ingest driver over `scripts/compile/`:
    `context.ts` (PaperCompileContext), `budgets.ts` (token budgets),
    `helpers.ts` (pure helpers), `finalize.ts` (end-of-run citation/relation
    finalize + consolidation checks), `steps/{screen,analyze,persist}.ts`
    (step functions, ids matched to COMPILE_STEP_CATALOG).
  - `scripts/compile-knowledge.ts` — CLI driver over `scripts/knowledge/`
    (`context.ts`, `helpers.ts`, `steps.ts`).
  - `scripts/rebuild-citations.ts` — CLI driver over `scripts/citations/pipeline.ts`.
  - `scripts/lint.ts` — CLI driver over `src/lib/lint-wiki.ts`.
  - `scripts/figures.sh` + `extract_figures.py`; fixtures via `make_fixtures.py`.
  - Shared CLI plumbing: `scripts/lib/cli-utils.ts` (parseFlags/parseArgs/
    parseCitationsArgs/truncate; re-exports `errorMessage` from `src/lib/errors.ts`).
- React components: `src/components/` — top-level panels (CitationGraph,
  PdfViewer, ChatPanel, KnowledgeDashboard, PendingCompilePanel, …) plus
  feature folders `compile/`, `knowledge/`, `graph/`, `health/`.

## src/lib — domain core

| File | Role |
|---|---|
| `wiki.ts` | Wiki storage layer: paths, frontmatter I/O (gray-matter), db derivation, index/log/proposals. Source of truth = markdown under `wiki/`. |
| `llm.ts`, `llm-providers.ts` | Shared OpenAI-compatible multi-provider LLM client. Env: `OPENCODE_API_KEY`, `DEEPSEEK_API_KEY`; optional `WIKI_LLM_PROVIDER` / `WIKI_LLM_MODEL` / `WIKI_LLM_BASE_URL`. Model catalog cache bypassable via `publicCatalog(force)` or `?refresh=1`. |
| `llm-http.ts` | family-4-pinned node:https transport + hard 30s timeout — undici global fetch hangs in this env; all LLM HTTP goes through here. |
| `citations.ts` | Citation map (`data/citations/map.json`): verbatim reference lists + exact-match resolutions only. |
| `relations.ts` | Typed relations; end-of-run finalize pass re-maps against the full final index, validated code-side. |
| `knowledge.ts` | Knowledge layer: pieces (human-owned, Add-to-knowledge only) and derived articles (regenerated from zero; favorites survive the wipe). Owns the API payload contract (`KnowledgeApiPayload`) + staleness computation — pages/UI import, never re-declare. |
| `lint-wiki.ts` | Invariant linter driver — orchestrates the `LintRule`s in `lint/`. |
| `lint/` | Per-rule lint modules (links, citations, relations, topics, archive, knowledge, state, types) — read by `lint-wiki.ts`, which is the only caller. |
| `errors.ts` | Single `errorMessage(err)` implementation — re-exported by `scripts/lib/cli-utils.ts`; no duplicate formatters anywhere. |
| `jobs.ts` | Shared machinery for the three long-running background jobs (compile/citations/knowledge API routes): child spawn, output capture, optimistic "running" snapshot, provider guard. |
| `extract.ts`, `extract-figures.ts` | PDF text extraction; best-effort figure extraction (never aborts a run). |
| `templates.ts` | Deterministic page renderers. |
| `prompts.ts`, `prompts/types.ts` | Structured prompt wrappers: title+essence, dedup screen (`DEDUP_SAME_SCORE` = 0.9 exported here), merged deep analyze+classify (title/essence as fixed facts), citation match, relation finalize, topic synthesis/merge, chat, knowledge. Shared prompt types in `prompts/types.ts`. |
| `wiki-journal.ts`, `runs.ts`, `progress.ts`, `llm-availability.ts` | Journal append, run status/events + `COMPILE_STEP_CATALOG` (panel step list), progress files, LLM health checks. |

## Storage layers (repo root)

| Location | Owner | Role |
|---|---|---|
| `papers/new/` → `papers/compiled/` / `papers/duplicates/` | compiler | Work queue → immutable archive |
| `wiki/` (papers/, topics/, concepts/, index.md, log.md, journal/) | LLM | The compiled literature; conventions in `wiki/SCHEMA.md` |
| `data/wiki-db.json`, `data/citations/map.json` | compiler | Derived — never hand-edit |
| `comments/<slug>/` | researcher | Private notes — quarantined, never read by any prompt |
| `knowledge/pieces/` (human) vs `knowledge/articles/` (derived) | split | Personal layer |

## Compile pipeline (per paper, in order)

Sequential, fail-hard, incremental (`scripts/compile.ts` driving the
`scripts/compile/` modules): each paper compiles against the FULL state left by
the previous one; the first LLM failure aborts the run, processed papers
persist, the rest stay in the inbox.

load-state → duplicate-check (free filename guard) → extract-pdf (all pages) →
extract-title-essence (slim LLM; garbage-title retry) → resolve-title-slug
(code-only fallback chain) → dedup-screen (slim LLM: title+essence vs
relevance-bounded history record, colliding slugs force-included, invalid
response → proceed + note) → analyze-classify (deep call, full text;
title+essence are fixed facts, bibliography extracted) → write-citation-map →
extract-figures (never aborts) → apply-topic-classification (topic skeleton
written under the run lock) → write-paper-page → synthesize-topic (newest-first
≤11 + new paper) → write-topic-page → move-pdf → create-comments-dir →
rebuild-derived-files.

Dedup is ONE LLM decision: screen score ≥ `DEDUP_SAME_SCORE` (0.9, exported
from prompts.ts) ⇒ duplicate → restore a matched paper's missing compiled PDF
or move to `papers/duplicates/` with audit "duplicate of X (screen score …)".
Below the threshold the paper compiles; a slug collision then means a DISTINCT
paper — disambiguated code-side via `uniqueSlug`, never overwriting the
colliding paper. The duplicate-compare confirm step was removed (title+essence
is the decisive duplicate signal).

End-of-run: finalize-citations (one slim call per paper vs the FULL final
index; self-heals interrupted runs) → finalize-relations (re-map vs full
index) → consolidation-checks (Confirm-tier proposals only: split-topic,
promote-subtopic, tag-to-parent, merge-topic — never auto-applied).

## Docs (authoritative, not duplicated here)

- `README.md` — full architecture (§3) and operational workflows (§4).
- `wiki/SCHEMA.md` — the LLM operating manual (conventions, invariants, workflows).
- `GRILL.md` — canonical domain glossary.
- `docs/adr/` — ADRs 0001 (citation map), 0002 (knowledge layer), 0003 (relations in frontmatter), 0004 (dedup-first pipeline), 0005 (post-stabilization refactor).
- `PROGRESS.md` — compressed lean handoff (quick resume + environment sheet, scripts/-not-compiled caveat). `.codebase/` is the primary knowledge store; PROGRESS.md is only a quick-resume pointer. Note: `next build` does NOT typecheck `scripts/` — see notes.md.
