<!-- Priority: high | Updated: 2026-08-13 -->
# Conventions

## Reviewed
(empty until a human promotes an entry from Proposed)

## Proposed (unreviewed)

- Step function name ↔ COMPILE_STEP_CATALOG id invariant: each compile step
  function's name must match its catalog id (e.g. `extractTitleEssence` ↔
  "extract-title-essence"; verified 11/11 during R4). The driver fills the
  context in catalog order; keep both in sync when adding/renaming steps.
  Evidence: scripts/compile/steps/{screen,analyze,persist}.ts, scripts/compile.ts.
- lib owns domain contracts — src/lib modules define domain types/contracts and
  the UI/API/scripts import them; no local re-declarations in components or
  routes (R2a/R2b: PendingCompilePanel imports EventStatus/CompileProgressEvent/
  CompileRunSnapshot from lib; KnowledgeDashboard/API use KnowledgeApiPayload;
  dropped local KnowledgeDbPayload/KnowledgeRunStatusResponse types).
  NOTE: this was a grilled, user-approved decision (R2b) — candidate for
  recording as an ADR via the grill skill; it lives here in Proposed pending
  human promotion.
- Shared CLI plumbing lives in scripts/lib/cli-utils.ts (parseFlags tokenizer,
  parseArgs/parseCitationsArgs typed façades, truncate); errorMessage has ONE
  implementation in src/lib/errors.ts, re-exported by cli-utils.ts — never
  re-implement or triplicate per-script (R1, R13).
- Paper Knowledge math-in-prose rule (paperKnowledgePrompt, FIGURE CURATION):
  every math expression in ANY prose field must be $...$-wrapped LaTeX — no
  bare LaTeX, no ASCII-math like sqrt(alpha_t); figure captions likewise
  require $...$-wrapped LaTeX (e.g. $\dim \tau = 10$); only core_formulas
  "formula" fields stay raw (the template wraps them in $$...$$); a prompt
  self-check item enforces it. Root cause: the LLM emitted prose math without
  $ delimiters so remark-math/KaTeX never rendered it. Evidence:
  src/lib/prompts.ts (paperKnowledgePrompt), src/lib/templates.ts
  (figureMarkdown alt text; render-side wrapBareMath in src/lib/math.ts is a
  fallback for legacy bodies — new content must still $...$-wrap).
- Figure embeds are ALT-ONLY: the caption lives in the image alt text
  (`![caption](/figures/<slug>/<file>)`), never a separate caption line —
  WikiMarkdown's p override turns a single-image paragraph into
  `<figure>` + `<figcaption>` and runs the alt through the math pipeline
  (remark-math/rehype-katex, wrapBareMath first). Root cause: the old
  `*Figure: <caption>*` line form broke caption math (the old alt sanitizer
  stripped LaTeX-mangling chars) and was removed. Evidence: templates.ts
  figureMarkdown (alt-only), WikiMarkdown.tsx p override,
  src/lib/math.ts wrapBareMath; SCHEMA.md workflow 1b item 6 updated to
  match (2026-08-13). Caveat: pre-R6 terminal bodies were NOT re-amended —
  their embeds keep the old sanitized alt + a legacy `*Figure:*` line (which
  now renders as plain italic; fix only via reset-to-zero + recompile).
