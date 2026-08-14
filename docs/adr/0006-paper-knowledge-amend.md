# Paper Knowledge: two-pass structured extraction with lazy diagrams

The Paper page previously carried a single-pass deep analysis (essence,
contributions, prior→update novel insight, limitations, frontier) rendered as
prose. Researchers reading a compiled paper had to piece the details together
from mixed sentences. This ADR adds a **Paper Knowledge amend**: a second,
parallel deep LLM pass over the full paper text that extracts a strictly
structured block (`## Paper Knowledge` — Research Purpose, Key Actions, Core
Concepts, Mechanism, Core Formulas, Deep Dive, Boundaries & Technical Debt)
appended to the Paper page, with **terminology** and **core formulas** as the
crown jewels.

## Context

- Compile already extracts title+essence (dedup key), the deep analysis, and
  the bibliography. The new pass must not destabilize that pipeline.
- The whole paper text is already available at compile time; the extraction is
  stateless per paper (no cross-paper dependency), so it parallelizes cleanly.
- The reference format ("Analysis Chain" + JSON schema) demands raw SVG
  (`overview_svg`, `mechanism_svg`); the operator chose **text briefs + lazy
  on-demand SVG rendering** instead (cost control, cache reuse, controllability).

## Decisions

1. **Two-pass extraction.** Compile's merged analyze+classify call is
   untouched. A separate Paper Knowledge pass runs AFTER the run, over the
   full paper text **seeded by the compile facts** (title, essence,
   contributions, novel insight, limitations, frontier as fixed,
   non-contradictable context).
2. **Post-run parallel amend, this-run papers only.** New papers are enqueued
   at persist time (`pending` in `.log/paper-knowledge-status.json`); the
   amend runs in parallel (default concurrency 3, `PAPERWIKI_KNOWLEDGE_CONCURRENCY`),
   one slug per unit of work, per-slug fail. Previously compiled papers are
   never touched.
3. **Terminal-ready.** A body containing `## Paper Knowledge` is never
   regenerated. Retry is available ONLY for `failed` papers (paper page +
   `/health`); retry re-extracts the JSON block only and cleans the old block
   before writing. Regenerating a ready block requires reset-to-zero +
   recompile — the price paid for "no regeneration without recompile from
   start".
4. **UI-only amend.** No operator CLI (`package.json` script). The CLI
   `yarn compile` runs the amend in-process at the end; the web compile path
   spawns it as a separate background job after the compiler child succeeds
   (`PAPERWIKI_DEFER_AMEND=1`). Browsing is never blocked.
5. **Text-brief diagrams, rendered lazily and cached.** The amend writes
   ```diagram fences (briefs only). A "Render diagram" click calls a separate
   LLM that produces the raw SVG, cached under
   `papers/compiled/<slug>_diagrams/<id>.svg` + `<id>.meta.json` (brief hash).
   The same brief reuses the cache; retry never touches diagram caches.
6. **Evidence chain: paper vs inference only.** No per-paper repo exists in
   this product, so the reference's repo axis is dropped.
7. **Concepts stay page-local.** Core Concepts are `####` subsections on the
   Paper page; they do not become `wiki/concepts/` nodes (that promotion is a
   later pass).
8. **Reset-to-zero clears everything.** The reset refuses while any amend
   entry is `running`; it deletes the status file (extended `.log/` regex) and
   the diagram caches ride along with the `papers/compiled/` wipe; the blocks
   die with the wiki wipe.

## Considered options

- **Raw SVG inline from the amend** (the reference schema) — rejected: a
  cached on-demand render is cheaper, reusable across sessions, and keeps LLM
  SVG errors out of the extraction path.
- **Extend the deep compile call** with the structured fields — rejected:
  bloats the already-large call, couples the two concerns, and makes a failed
  structured extraction fail the whole compile.
- **End-of-run batch + CLI command** — rejected: operator chose background +
  UI-only retry, with the CLI compile path running it in-process.
- **Always-rewrite knowledge** (refresh on prompt bumps) — rejected:
  terminal-ready stability beats freshness without an explicit recompile.
- **KaTeX math** — accepted: `remark-math` + `rehype-katex` render `$…$` /
  `$$…$$` in the paper body (with `throwOnError: false` so malformed LLM LaTeX
  never breaks a page).

## Consequences

- The Paper page gains the structured block (extend alongside — classic
  sections are untouched); pages without the block render as before.
- Papers compiled before this feature ship never get Paper Knowledge unless
  the operator resets-to-zero and recompiles.
- `.log/paper-knowledge-status.json` is the per-slug state; the global slot
  `__paperwikiPaperKnowledge` prevents concurrent amend jobs per server
  process; `spawnPaperKnowledgeAmend` returns `null` (not throws) when a job
  is already active, and the runner drains pending entries in a loop so
  interrupted-run leftovers self-heal.
- Diagram caches follow the figures convention (`papers/compiled/<slug>_diagrams/`),
  served at `/diagrams/<slug>/<id>`.
- Lint: Paper Knowledge adds no new lint rules in v1 (the block introduces no
  frontmatter or wikilinks; the prompt forbids `[[…]]` markers).

## Follow-up (2026-08-13)

- **Figure curation.** `extract_figures.py` now writes a per-figure context
  manifest (`papers/compiled/<slug>_figures/manifest.json`: file, page,
  caption from the nearest text block below the image, context from the
  overlapping paragraph, kind figure|page-render). The amend passes it to the
  knowledge LLM, which returns a curated `figures` plan (file / Paper
  Knowledge section / grounded caption). The wiki body no longer has a
  `## Figures` pile — `renderPaperBody` dropped it; figures surface via the
  paper route's Figures tab (`frontmatter.figures[]`) and, when the LLM judges
  them useful, inline under a Paper Knowledge section. The amend strips legacy
  piles on write. An empty curation is valid.
- **Topic titled cards.** `keyProperties` changed from `string[]` to
  `{headline, detail, sources}[]`; topic pages render each as a `###` card
  with source links instead of a dense bullet stack.
- **Amend runner crash fix.** `parseFlags` in `scripts/lib/cli-utils.ts` is now
  exported — the spawned amend runner previously crashed on startup
  (`import { parseFlags }` resolved to undefined), leaving every entry stuck
  `pending`.
- **`/wiki` reader parity.** The wiki source route renders papers with
  `paperSlug`/`diagramCache` and the Paper Knowledge status surface, matching
  `/paper/[slug]`.

## Follow-up (2026-08-13, display round)

- **Diagram slots are prop-independent.** Diagram fences render a placeholder
  + clickable SVG slot unconditionally; the slot derives the paper slug from
  the page URL (`/paper/<slug>` or `/wiki/papers/<slug>`) instead of relying
  on a threaded prop (a missing prop previously degraded the brief to bare
  inline text).
- **Block placement.** The Paper Knowledge block is inserted between
  `## Contributions` and `## Critical Analysis` (was: appended after `## Feeds`).
- **Math-in-prose rule.** All math in every prose field must be `$…$`-wrapped
  LaTeX (no bare LaTeX, no ASCII-math like `sqrt(alpha_t)`); display formulas
  keep raw LaTeX wrapped by the template.
- **Curated figure display.** Inline figures render centered with the caption
  as a figcaption (from alt text) instead of a left-aligned image + italic
  line.
- **Boundaries layout.** Evidence chain / Technical debt / Boundaries render
  as `####` subheadings instead of bold-labeled wall-of-text paragraphs.

## Follow-up (2026-08-14, svg.js render backend round)

- **LLM-decided diagram placement.** The fixed `overview_diagram` /
  `mechanism_chain.diagram` slots are replaced by a `diagrams[]` array
  (`{ id, section, brief }`, 1-6 entries). The amend LLM decides WHERE a
  diagram is needed from explicit complexity triggers (more than 3 steps/
  roles/modules/variables; chronological order/preconditions/failure chains/
  trade-offs/budget allocation/scheduling; multi-object comparisons; formulas
  with numerator/denominator/constraints; text-only explanations beyond 2
  paragraphs). Fences render under their declared Paper Knowledge H3, and the
  section token travels in the fence INFO STRING (` ```diagram <id> <Section>`)
  so the frontend label and the render-time prose lookup need no extra state.
  Legacy JSON from pre-array amends is normalized onto `diagrams[]` by
  `normalizeLegacyDiagrams` in validatePaperKnowledge; legacy fences (no
  section token) stay parseable and label themselves from the id.
- **svg.js render backend.** The on-demand render no longer asks the LLM for
  raw SVG markup — it asks for a single `render(SVG, draw)` svg.js function
  (cheat sheet in SVG_RENDER_SYSTEM), executed headlessly by
  `src/lib/diagram-exec.ts`: a fresh svgdom window per call
  (`registerWindow`), the code runs in a `node:vm` sandbox exposing only the
  svg.js factory, and BOTH the compile and the invocation steps go through
  `vm.Script.runInContext` with a 2s timeout (a timeout only guards the script
  that contains the code, so calling `render()` from host code would let an
  infinite loop hang the process). svgdom's serializer rejects the root's
  namespace-unaware `xmlns` attribute (Invalid State Error) — it is removed
  before serialization, and svg.js-injected `data-svgjs` attributes are
  stripped. Output is validated (root `<svg>`, viewBox, ≤30KB). Per-call LLM
  output drops from ~1-2.5K markup tokens to a few hundred code tokens; the
  `maxTokens` budget stays 32,768 (reasoning models spend the budget on
  `reasoning_content` — a smaller cap regresses the empty-content crash fixed
  in the earlier display round).
- **Renderer-versioned cache key.** `RENDERER_VERSION` ("svgjs-v1") is baked
  into the cache key (`hash(brief + "::" + RENDERER_VERSION)`), so a prompt or
  library bump auto-invalidates every previously cached diagram (their hash
  stops matching and they re-render on next click). Every successful render is
  cached unconditionally to `papers/compiled/<slug>_diagrams/<id>.svg` +
  `.meta.json`, whatever the trigger.
- **Content-addressed diagram URLs.** Cached SVGs are served at
  `/diagrams/<slug>/<id>-<briefHash>.svg`. The route strips the `.svg`
  extension, splits the `-<12hex>` suffix, validates the base id, and
  VERIFIES the suffix against the current meta `briefHash` — a stale URL
  (diagram re-rendered after a brief change or renderer bump) 404s instead of
  serving old content. Verified URLs are served with
  `Cache-Control: public, max-age=31536000, immutable` (the URL changes
  whenever the content changes, so browser/proxy caches can never show an old
  SVG); legacy un-hashed URLs serve with `max-age=60` so clients converge.
  `readCachedDiagrams` now returns `{ id, svgUrl? }` and DiagramSlot builds no
  URL client-side — the server's content-addressed URL is authoritative.
- **Render input widened.** The render LLM now receives the brief PLUS the
  owning section's prose (extracted from the paper body via the fence's
  section token, fences stripped, capped ~1200 chars) so diagram labels stay
  faithful to the surrounding text.
- **Verification.** Requires `yarn build` + restart + smoke (compile a paper →
  knowledge block → Render diagram → cached SVG at the hashed URL; recompile
  with a changed brief → new URL, old URL 404s).

## Follow-up (2026-08-14, render hardening round)

- **Real math in SVG labels.** Text elements whose labels contain `$...$` /
  `\(...\)` LaTeX are post-processed by `src/lib/svg-math.ts`: the serialized
  SVG's `<text>` block is replaced with a `<foreignObject>` wrapping the
  MathML produced by `katex.renderToString(tex, {output:"mathml"})` (plain
  runs stay as escaped text beside the inline `<math>` elements; the text's
  `fill` color is copied to the div). Because foreignObject is not painted for
  SVGs shown through `<img>`, `DiagramSlot` now renders cached diagrams via
  `<object type="image/svg+xml">`. MathML-Core painting inside foreignObject
  is solid in Firefox and supported in current Chromium; the fallback
  (`mathToUnicode` in svg-math.ts) converts LaTeX to Unicode glyphs instead.
  MAX_SVG_LENGTH raised 30KB → 64KB for MathML expansion.
- **ViewBox autofit.** svgdom has no text layout, so text cannot be measured.
  `diagram-exec.ts` `autofitViewBox` grows the viewBox from element attributes
  (rect/line/text extents; text height estimated from font-size × line count +
  descender allowance) — down/right only, never shrinks, so a diagram whose
  lowest label sits below the viewBox bottom renders fully without the LLM
  getting the layout right.
- **Full-context continuation loop.** The single diagram-render LLM call is
  replaced by a loop (cap 3, `maxTokens` 65,536 per attempt — reasoning models
  spend output budget on reasoning_content, and a too-small cap returns empty
  content). Every failure — empty content (`finish_reason: length`),
  truncated code, or `svg.js render failed: <execute error>` — retries WITH
  the full accumulated context: the partial content and the model's
  `reasoning_content` are echoed back as an assistant message
  (`llmChatDetailed` in llm.ts surfaces the raw response details; gateways
  that reject `reasoning_content` are retried once with it stripped), so the
  follow-up continues the same reasoning instead of restarting from scratch.
  Truncated responses accumulate ("continue exactly where you stopped");
  complete-but-broken code is rewritten with the error attached.

## Follow-up (2026-08-14, dedicated diagram-plan pass)

- **Two-phase amend pipeline.** Diagram judgment is separated from extraction:
  phase 1 (`scripts/paper-knowledge/amend.ts`) extracts the structured block
  WITHOUT diagram briefs (the extraction prompt no longer carries diagram
  instructions), persists it with a capped paper-text excerpt
  (`.log/paper-knowledge/<slug>.json`, atomic write), and writes the block
  with NO fences. Phase 2 (`scripts/paper-knowledge/plan.ts`,
  `paperDiagramPlanPrompt` in prompts.ts) reads the persisted knowledge +
  excerpt (no PDF re-extraction), runs a dedicated LLM call that owns ALL the
  diagram trigger rules (complexity criteria, Input/Premise → Key Actions →
  Intermediate Constraints → Output/Result, brief-as-how-to-read-caption,
  ≤10 diagrams), and patches the fences into the block via
  `patchDiagramFences` (templates.ts) — strips existing fences inside the
  Paper Knowledge block first, inserts each fence at the end of its H3
  section, idempotent, sections absent from the block skipped.
- **Status model.** The diagram-plan phase rides the SAME entry in
  `.log/paper-knowledge-status.json`: `diagramPlan` (pending/running/ready/
  failed) + `diagramPlanError`. The amend's `ready` status is TERMINAL and is
  never touched by the plan phase; a plan failure marks only
  `diagramPlan: "failed"`, and `retry-diagrams` (API + paper page + health
  panel) re-runs ONLY the plan. `claimNextDiagramPlan` claims plan-pending
  entries under the same lock file as the amend claim; `isPaperKnowledgeRunning`
  gates reset-to-zero on either phase. The runner drains both phases (amend
  then plan); `yarn compile` drains both in-process. Cap raised 6 → 10
  (`MAX_DIAGRAMS`); diagrams validated via the shared `validateDiagrams`.
- **Render hardening extras.** Diagram-render calls use a 600s transport
  timeout (`LLM_DIAGRAM_TIMEOUT_MS`, default 600_000 — threaded via
  `llmChatDetailed.timeoutMs` → `postChat` → `httpJsonRequest`; all other
  callers keep the 300s default). Every raw render response is logged to
  `papers/compiled/<slug>_diagrams/<id>.raw.log` (attempt number +
  finish_reason + full content) and the exact executed program to
  `<id>.code.js` — provenance for debugging, not served by the route.
- **Reset.** Reset-to-zero now also removes `.log/paper-knowledge/`
  (persisted knowledge JSON + excerpts) alongside the status file.

## Follow-up (2026-08-14, structured slots + mermaid tiering + pipeline round)

- **Structured diagram slots.** The planner's diagram entries are now
  `{ id, section, title, brief, location?, format }` — `title` is a short
  human heading shown above the diagram (materialized as the fence's first
  content line `**Title**: …`, parsed server-side by `extractDiagramTitle`
  and passed to DiagramSlot as a prop; the caption strips it); `format` is
  the rendering route; `location` is a positional anchor. `patchDiagramFences`
  resolves each diagram's position independently: a `#### <location>`
  subsection heading → end of that subsection (level-aware boundary search:
  `### ` sections end at the next `### `/`## `, `#### ` subsections at the
  next `#### `/`### ` — a plain `#{3,4}` boundary overcorrected section ends),
  an exact fragment line → after its paragraph, else section end. Same-section
  diagrams no longer stack at the end (the "3× Core Formulas diagram" bug).
- **Mermaid tiering.** The planner chooses `format` per diagram: "mermaid"
  for simple linear flows / side-by-side comparisons with plain labels
  (cheap), "svg" when labels contain math or custom layout is needed. The
  fence info string carries the route (` ```diagram <id> <Section> <format>`);
  `extractDiagramFormat` defaults to svg for legacy fences. The render path
  branches: mermaid → `MERMAID_RENDER_SYSTEM` (one call + one compact retry,
  directive+size validation) → cached `<id>.mmd`; svg → the svg.js
  continuation loop. Cache key now includes the format
  (`hash(brief + "::" + format + "::" + RENDERER_VERSION)`), and `DiagramMeta`
  records it. The `/diagrams` route serves `.svg` and `.mmd` (text/plain),
  both hash-verified + immutable. Mermaid diagrams render CLIENT-SIDE via the
  browser `mermaid` package (lazy import, theme neutral) from the cached
  `.mmd` — no puppeteer/chromium.
- **v2 render prompt + consolidation.** `SVG_RENDER_SYSTEM` (rewritten:
  freedom-first — no palette spec, no example, no line cap; the fixed parts
  are the output contract, canvas margins, and geometry CORRECTNESS
  conventions: text-anchor/dominant-baseline centering instead of `y+22`
  drift, label-fit, edge-to-edge arrows), `MERMAID_RENDER_SYSTEM`, and the
  continuation/rewrite follow-up builders all moved into `prompts.ts`;
  `paper-knowledge.ts` imports them. `RENDERER_VERSION` bumped to
  "svgjs-v2" — every cached diagram re-renders once with the new style.
- **Pipeline drain.** `scripts/paper-knowledge/pipeline.ts` drains BOTH
  phases in one worker pool (`claimNextPaperKnowledge` else
  `claimNextDiagramPlan` per iteration) — a paper's diagram plan starts the
  moment ITS amend succeeds instead of waiting for all amends. The
  background runner uses the pipeline; `yarn compile` still drains
  sequentially in-process.
- **UX fixes.** DiagramSlot shows "Ready — refreshing…" while a completed
  render awaits `router.refresh()` (the silent-button flash); the health page
  gains a DiagramLogsPanel (per-paper "Show logs" toggle exposing
  `raw.log` / `code.js` / `.mmd` via `GET /api/paper-knowledge?diagram-logs=1`).

## Follow-up (2026-08-14, render-execution bugs round)

- **Cross-realm attr() no-op.** svg.js's `attr()` dispatches on
  `attr.constructor === Object` — object literals created INSIDE the vm
  sandbox carry the vm realm's `Object` as constructor, so `.attr({...})`
  silently became a no-op (only `.move()`-positioned labels worked; every
  `.attr({x,y})` label collapsed to the left edge). Fix: after
  `vm.createContext`, bridge the realm prototypes —
  `runInContext("Object")/("Array").prototype.constructor = <host>` — svg.js
  then handles sandbox-created objects normally.
- **tspan x override.** svg.js `<text>` elements contain a `<tspan>` with its
  own `x` attribute (synced only by `.move()`, initial 0); the tspan's x
  overrides the text's x in rendering. The executor strips `x` from every
  tspan before serialization so lines inherit the text position.
- **data-svgjs re-injection.** svg.js's `.svg()` runs `writeDataToDom()`,
  re-adding `data-svgjs` metadata after any pre-serialize strip — scrubbed
  from the final serialized string instead.
- **Per-completion refresh.** The diagram-jobs poller refreshes the page as
  soon as ANY tracked render turns terminal (done/failed), not when all
  settle — a finished diagram appears immediately even while slower siblings
  render. "Ready — refreshing…" is self-limiting (4s → button + "render may
  have been interrupted" hint) so a lost job registry can never freeze the
  slot.
- **Expressive render prompt.** `SVG_RENDER_SYSTEM` now invites longer,
  expressive code (helpers, groups, annotations, legends) instead of
  compactness; `RENDERER_VERSION` bumped to `svgjs-v3` (cached diagrams
  re-render).

## Follow-up (2026-08-14, figure lightbox)

- **Click-to-fullscreen figures.** A shared `FigureLightbox` (provider +
  `useLightbox` hook in `src/components/FigureLightbox.tsx`) renders a custom
  fixed overlay (bg-black/90, thin `p-2 sm:p-3` padding, `overflow-auto`)
  for three content types: raster images (`<img>`), svg.js diagrams
  (`<object>`, so foreignObject MathML keeps rendering), and Mermaid output
  (rendered HTML string). Page scroll is LOCKED while open (body
  `overflow:hidden` restored on close; `overscroll-behavior-y: contain` on
  the overlay). Closes via Escape / backdrop click / ✕ button; the caption
  ("How to read this diagram" for diagrams, the alt text for figures) is
  shown below the content. `WikiMarkdown` wraps its tree in the provider
  (covers all 5 routes: paper, wiki reader, knowledge articles/pieces, chat)
  and makes inline curated figures clickable (the `p`-override `<img>`
  becomes a `w-fit cursor-zoom-in` button); `DiagramSlot` opens it for both
  rendered branches. `FigureGallery` keeps its paging lightbox but gains the
  same scroll lock + thin padding.
