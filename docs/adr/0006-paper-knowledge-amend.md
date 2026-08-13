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
