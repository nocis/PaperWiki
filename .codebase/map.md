<!-- Priority: critical | Updated: 2026-08-14 -->
# Map

Next.js 14 (App Router) + TypeScript (strict) + Tailwind. Path alias `@/*` →
`./src/*`. Package manager: yarn.

## Commands (the maintainer runs these — agents must not, per AGENTS.md; no test suite — verification = `yarn build` + manual browser smoke)

| Command | Does |
|---|---|
| `yarn dev` | Start the web app |
| `yarn build` | Typecheck + production build — the verification gate |
| `yarn compile` | Ingest PDFs from `papers/new/` (`tsx scripts/compile.ts`) |
| `yarn citations [--slug s] [--provider p] [--model m]` | Rebuild citation matches from persisted reference lists (never re-reads PDFs) |
| `yarn lint:wiki` | Wiki invariant linter: mechanical auto-fixes + structural proposals |
| `yarn figures` | Figure extraction helper (`bash scripts/figures.sh` → Python/PyMuPDF vendored at `.pymupdf/`) |

## Entry points

- Web app: `src/app/` — routes `/` (compile dashboard), `/wiki`, `/paper/<slug>`,
  `/citations`, `/knowledge`, `/chat`, `/health`, `/figures`, `/pdfs`,
  `/diagrams/<slug>/<id>` (lazy diagram brief rendering); API routes under
  `src/app/api/` (chat, citations, comments, compile, health, knowledge,
  llm, paper-knowledge).
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
  PdfViewer, ChatPanel, KnowledgeDashboard, PendingCompilePanel, DiagramSlot,
  PaperKnowledgeStatus, FigureLightbox, …) plus feature folders `compile/`, `knowledge/`,
  `graph/`, `health/` (incl. health/PaperKnowledgePanel,
  health/DiagramLogsPanel).

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
| `templates.ts` | Deterministic page renderers (PAPER_KNOWLEDGE_SECTIONS as const; never-throw normalizeKeyProperties/normalizeSubtopicNotes). |
| `wiki-ids.ts` | Pure id patterns (SLUG_RE, DIAGRAM_ID_RE, DIAGRAM_ID_IN_BODY_RE) — single source for slug/diagram-id validation across paper-knowledge, the paper-knowledge API route, diagrams/figures routes, WikiMarkdown. |
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

## Paper Knowledge (post-compile amend pipeline)

Dual-phase pipeline under `scripts/paper-knowledge/` (amend.ts, plan.ts,
pipeline.ts) driven by `scripts/paper-knowledge-runner.ts` (invoked at the end
of `scripts/compile.ts` and via `POST /api/paper-knowledge`). Amend: one deep
LLM pass per new paper, inserting a "## Paper Knowledge" block between
`## Contributions` and `## Critical Analysis`
(`patchPaperKnowledgeBlock` in templates.ts — anchor regex, append fallback;
section stripping via `stripH2Section` preserves content before AND after the
stripped section, so amend retries never truncate the paper).
Ready state is TERMINAL (no regeneration except reset-to-zero + recompile);
retry flips failed→pending + force-spawn (bypasses the alive guard, always 202).
Plan: a second pass (`plan.ts`) generates diagram briefs post-amend, writing
`diagramPlan` fences into the Paper Knowledge block (one per H3 section, at
section END; patchDiagramFences idempotent); claims diagramPlan:pending via
the same lock file and reads the knowledge store
(`.log/paper-knowledge/<slug>.json` — {knowledge, textExcerpt ≤12K}, atomic),
NO PDF re-extraction. Both phases share ONE `.log/paper-knowledge-status.json`
entry; retry-diagrams re-runs ONLY the plan. Runner drains amend then plan in
one worker pool (claim amend else claim plan); compile drains both
in-process with separate try/catch so plan failure never fails compile.

- Concurrency: `claimNextPaperKnowledge()` atomically flips the next
  pending→running paper under `.log/paper-knowledge-claim.lock` (fs.open "wx",
  stale-lock steal after 10s, 10x50ms contention retry); amend.ts is a
  claim-drain loop — concurrent runners never double-process a slug; the reset
  route's regex also clears the claim lock.
- Figures: `scripts/extract_figures.py` writes
  `papers/compiled/<slug>_figures/manifest.json` (file/page/caption/context/
  kind); the amend LLM curates inline figures under Paper Knowledge H3s only
  (empty curation is valid); `validatePaperKnowledge` enforces ≤6 figures,
  manifest membership, section validity; the legacy `## Figures` pile is
  dropped from the paper page (Figures tab is the gallery).
- Rendering: Key Properties are titled cards {headline, detail, sources}
  (normalized via never-throw normalizeKeyProperties — accepts legacy string
  bullets and partial objects);
  Boundaries & Technical Debt render as `#### Evidence chain` / `####
  Technical debt` / `#### Boundaries`.   Diagram slots: lazy render via `src/app/diagrams/[slug]/[id]/route.ts`
  (strips a trailing `.svg` from the segment before id validation, then reads
  `${id}.svg`; serves `.mmd` too), cache key
  `hash(brief + '::' + format + '::' + RENDERER_VERSION)` — format switches
  and RENDERER_VERSION bumps invalidate (currently svgjs-v3); hash-verified vs
  meta.briefHash (mismatch → 404), immutable 1y cache; hasSvg only when the
  cached briefHash matches the current body brief (stale SVG after retry amend
  fixed); retry never touches diagrams. `DiagramSlot.tsx` derives the slug
  client-side from `window.location.pathname` (prop fallback, disabled-hint
  placeholder). Render pipeline details: "Diagram rendering" below.
- WikiMarkdown (src/components/WikiMarkdown.tsx): diagram fence id comes from
  the fence INFO STRING via `node.data?.meta` (```diagram overview →
  lang="diagram", meta="overview"), falling back to the content's first line,
  else a placeholder box — a diagram fence never renders as bare text.
  figureMarkdown emits ALT-ONLY embeds — `![caption](/figures/<slug>/<file>)`,
  caption in the image alt, no caption line (SCHEMA.md workflow 1b item 6
  matches); the p override wraps a single-image paragraph in `<figure>` +
  `<figcaption>`, rendering the alt through nested ReactMarkdown
  (remark-math/rehype-katex) so `$...$` math typesets, with wrapBareMath
  (`src/lib/math.ts`) pre-wrapping undelimited LaTeX runs (app-safe, shared
  server+client); legacy `*Figure: ...*` caption lines (pre-R6 bodies) render
  as plain italic text — no special centering. Clicking a rendered figure
  opens a fullscreen lightbox (src/components/FigureLightbox.tsx — createPortal
  modal, scroll lock, Esc/backdrop/✕ close; payload alt-only, LightboxPayload.caption removed; FigureGallery untouched).

### Diagram rendering (svg + mermaid)

- Fence contract: ```diagram <id> <Section> <format> (default svg), first
  content line `**Title**: <title>`, blank, then the brief; fences patched at
  the END of the section's H3 (level-aware heading search, idempotent).
- SVG path (`src/lib/diagram-exec.ts`): the model's single `render(SVG, draw)`
  fn runs headless (svgdom + node:vm). TWO-PHASE runInContext (compile, then
  invoke) — the vm timeout only guards the in-context script. After
  createContext, VM realm intrinsics are bridged to host
  (`vm.runInContext('Object'/'Array', ctx).prototype.constructor = host
  Object/Array`) or `.attr({...})` silently no-ops (cross-realm constructor
  check — see notes.md). xmlns removed pre-serialize; tspan x stripped (dy
  kept); `data-svgjs` scrubbed from the final string. LaTeX `$...$` labels →
  foreignObject + katex MathML (`src/lib/svg-math.ts`), painted only via
  `<object>`, never `<img>`; autofitViewBox grows down/right only. Render
  loop: continuation/rewrite retries (MAX_RENDER_ATTEMPTS=3, full context
  echoed, 600s transport timeout); provenance `.raw.log` + `.code.js` under
  `papers/compiled/<slug>_diagrams/` (served via
  `GET /api/paper-knowledge?diagram-logs=1`, capped 16K).
- Mermaid path: `.mmd` rendered browser-side in DiagramSlot (lazy mermaid
  import); `.svg` served via `<object>`. diagram-jobs-client.tsx refreshes PER
  completion (Set of non-terminal keys); DiagramSlot done-state self-limits
  (DONE_WAIT_MS = 4s) then falls back to the button with an 'render may have
  been interrupted' hint.

## Docs (authoritative, not duplicated here)

- `README.md` — full architecture (§3) and operational workflows (§4).
- `wiki/SCHEMA.md` — the LLM operating manual (conventions, invariants, workflows).
- `GRILL.md` — canonical domain glossary.
- `docs/adr/` — ADRs 0001 (citation map), 0002 (knowledge layer), 0003 (relations in frontmatter), 0004 (dedup-first pipeline), 0005 (post-stabilization refactor), 0006 (paper-knowledge-amend).
- `PROGRESS.md` — compressed lean handoff (quick resume + environment sheet, scripts/-not-compiled caveat). `.codebase/` is the primary knowledge store; PROGRESS.md is only a quick-resume pointer. Note: `next build` does NOT typecheck `scripts/` — see notes.md.
