# Dedup-first compile pipeline: screen filters, confirm judges, sequential incremental compile

The compile pipeline was redesigned around one ordering principle: **cheap before
expensive**. Duplicate detection is decided after two slim LLM calls and before
any deep analysis, so duplicates never pay for the heavy pass. The same redesign
removed parallelism in favor of a sequential, incremental compile.

## Context

The previous pipeline ran two papers concurrently and ran a single merged
analysis call (analysis + classification + bibliography) before any duplicate
decision. Three problems:

- **Parallelism undermined both correctness and incrementality.** Slug
  allocation was in-memory only, so two same-document papers in one run could
  claim the same slug and silently overwrite each other's page and PDF
  (`fs.rename` clobbers existing targets). Worse, each paper's decisions could
  not see its siblings' final state — the knowledge base was not built
  incrementally.
- **Dedup was post-analysis and conditional.** `duplicate-compare` fired only on
  an exact slug collision with an already-compiled paper. A same-document
  re-drop under a different filename with a divergent extracted title compiled
  as a duplicate entry; same-run duplicates were invisible to it entirely.
- **The merged call was overloaded.** Full paper text + 40-paper insertion-
  ordered index + topic tree competed for one context, and the 150-entry
  bibliography competed with the analysis fields for the output budget.

## Considered options

- **Parallel workers with a reservation ledger** — rejected: adds a new
  persistent allocation mechanism to make a parallel design safe; sequential
  processing makes the ledger unnecessary (each paper sees every prior paper's
  persisted state) and directly serves the incremental-KB goal.
- **Code-side title-token overlap pre-filter** for near-duplicates — rejected in
  favor of a semantic LLM screen: token overlap is lexical only and misses
  renamed re-drops whose extracted titles diverge; the LLM compares title AND
  essence, which is the decisive signal for same-document.
- **Piggyback dedup onto the merged analysis call** — rejected: the merged call
  exists to understand ONE document; a database-comparison judgment competes
  for the same attention and output budget.
- **Screen decides directly** — initially adopted a two-stage shape (screen
  filters, a separate compare call judges), then reverted: title+essence is the
  decisive signal for same-document, so a second LLM call adding only
  authors/venue/date was redundant and added panel confusion. The screen is
  the SINGLE decision: same-document confidence ≥ 0.9 → duplicate (conservative
  — below it, the paper compiles; a bad call is further mitigated by the score
  audit and the recoverable `papers/duplicates/` folder). The compare prompt
  and the `duplicate-compare` catalog step were deleted.
- **Keep title extraction inside the deep call** — rejected: the deep call is
  only worth running when the paper survives dedup; title+essence are now a
  first-class slim phase that everything downstream consumes.

## Decisions

- **Sequential compile.** One paper at a time; fail-hard preserved. The worker
  pool, the in-process `withRunLock` serialization, and all concurrency
  comments were removed.
- **Pipeline per paper:** filename duplicate-check (free) → extract → slim
  title+essence → code-only slug resolution → slim dedup screen (title+essence
  vs a relevance-bounded history record; colliding slugs force-included) →
  deep analysis+classification on the full text with title+essence as fixed
  facts → topic synthesis (newest-first sources).
- **The screen judges duplicates.** `{slug, score}` — score ≥ 0.9 (`DEDUP_SAME_SCORE`)
  means "same document as <slug>" → duplicate path; below it the paper
  compiles, disambiguated code-side (`uniqueSlug`) when its slug collides.
  No second LLM call; no `duplicate-compare` step.
- **Restore rule.** On verdict "same", if the matched paper's compiled PDF is
  missing (an interrupted run), the inbox PDF is moved to
  `papers/compiled/<slug>.pdf` instead of `papers/duplicates/` — dedup doubles
  as crash recovery.
- **Window-bounded budgets, not arbitrary caps.** Named constants sized for a
  1M-token / 384K-max-output model: `FULL_MAX_CHARS` (full paper, 200+ pages),
  `KB_BUDGET_CHARS` shared by the relation index and the dedup history record
  (~1,000+ papers — effectively unlimited until the window is exhausted,
  then relevance-ordering decides), `TOPIC_TREE_BUDGET_CHARS`.
- **Title+essence is the single source of truth** for slug, dedup, the paper
  page, and synthesis; the deep call receives them as fixed facts and its
  schema no longer emits them.

## Consequences

- Duplicates pay one slim LLM call (plus the free filename guard) and nothing
  else; the deep analysis, figure extraction, and topic synthesis never run
  for them.
- The KB is built incrementally: every paper compiles against the full prior
  state, and topic synthesis compounds the newest sources into the existing
  body.
- Interrupted runs self-heal (restore rule), closing the class of
  "page written, PDF missing, next compile misfiled it" failures.
- The 0.9 decision line is deliberately conservative: a missed duplicate
  (compile) is recoverable via lint and re-drops; a false duplicate move is
  near-impossible.
- Each deep call now ingests up to ~300k tokens — minutes per call; total run
  time is the sum over papers. Accepted for incremental compiles of few papers.
- The panel gained two steps (`extract-title-essence`, `dedup-screen`), and
  conditional steps render "not needed" once a paper is finished.
