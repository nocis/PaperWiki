# Post-stabilization refactor: phase-cohesive modules, shared job runner, UI decomposition

After feature-complete stabilization (v1.1), the codebase was restructured to
match the documented design path. The refactor is **behavior-preserving by
construction**: mechanical moves, verbatim bodies, and type-level changes only,
gated per-slice by `yarn build` + manual smoke tests (no test suite exists by
project choice). Every opportunistic behavior fix was grilled and approved
individually before landing.

## Context

The code had accumulated back-and-forth edits: god-files (a 1,195-line
`scripts/compile.ts`, a 555-line `runLint`, four 500–600-line UI components),
three divergent step-event mechanisms, UI layers re-declaring the domain model,
and triplicated CLI/error/route plumbing. Stable semantics meant the code could
now be reshaped to the clear path without feature work.

## Decisions

- **Compile pipeline → `scripts/compile/`**: `steps/screen|analyze|persist.ts`
  (phase-cohesive modules, one file per phase), `finalize.ts` (end-of-run
  passes), `helpers.ts`, `context.ts` (mutable `PaperCompileContext` threaded
  through steps), `budgets.ts` (all pipeline budgets in one place). Invariant:
  **step function name ↔ `COMPILE_STEP_CATALOG` id** (camelCase ↔ kebab-case).
- **One step-event mechanism**: the progress-factory `runStep` (returns the
  step value) is the only step wrapper; the hand-rolled knowledge helper and
  the citations manual triples were eliminated.
- **Knowledge/citations pipelines → `scripts/knowledge/` + `scripts/citations/`**
  with the same driver/step split; shared CLI plumbing in `scripts/lib/cli-utils.ts`.
- **Long-running job routes → `src/lib/jobs.ts`**: shared spawn/output-capture,
  optimistic running snapshot, provider guard, finalize-then-clear wiring; each
  route keeps its own preflight and response shape.
- **Linter → `src/lib/lint/`**: a `LintRule[]` registry of 13 checks with a thin
  driver; shared `emit(issue, fix)` + `queueProposal` helpers replaced the
  repeated `if (applyFixes)` blocks.
- **UI decomposition**: `PendingCompilePanel`, `KnowledgeDashboard`,
  `CitationGraph`, and the health page became shells composed from
  `src/components/compile|knowledge|graph|health/` hooks + view components.
- **UI stops re-declaring the domain**: components import canonical lib types
  (`KnowledgeApiPayload`, `KnowledgeRunSnapshot`, `CitationsRunSnapshot`,
  payload element types); lib owns all wire contracts.
- **Shared error formatting** in `src/lib/errors.ts` (re-exported by the script
  CLI module); **dead code swept** (4 removed exports, 43 unexported);
  **no import cycles** in `src/lib` + `scripts`.

## Consequences

- Files are navigable by phase; the driver reads like the documented pipeline.
- Deferred grills: `KnowledgeDb` → `KnowledgeApiPayload` contract, the dead
  citation-map migration guard, the redundant run-status props — all resolved
  during the refactor per the grilling protocol.
- `next build` does **not** compile `scripts/`, so script-side regressions are
  only caught by manual smokes (`yarn compile`, `yarn citations`,
  `yarn lint:wiki`).
- The compile corpus, on-disk formats, and derived artifacts are unchanged;
  SCHEMA.md remains the operating manual.
