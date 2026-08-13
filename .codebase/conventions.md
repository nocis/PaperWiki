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
