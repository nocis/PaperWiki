<!-- Priority: high | Updated: 2026-08-14 -->
# Notes

## Known Issues

- (closed 2026-08-14) Diagram render execution-bugs round: labels collapsed to
  x=0 (cross-realm `.attr({...})` no-op — see Gotchas), 'Ready — refreshing…'
  stuck up to 30min or forever (poller waited for ALL jobs + done view
  persisted when the registry lost the job), TypeScript 'redefined' build
  error (duplicate `const artifactUrl` in DiagramSlot). Fixes: realm bridging
  in diagram-exec.ts; per-completion refresh in diagram-jobs-client.tsx + 4s
  DONE_WAIT_MS fallback in DiagramSlot; duplicate removed. Verified via
  plain-node smoke with the user's actual failing render fn — yarn
  build/browser smoke pending per AGENTS.md.
- (closed 2026-08-13) Cancel compile left the button stuck on "Compiling…" forever — the poll's terminal check only handled completed/failed, not cancelled. Fix: "cancelled" added to the stop condition (PendingCompilePanel.tsx). Lesson: any run-status poll must treat cancelled as terminal.
- (closed 2026-08-13) Reset-to-zero then navigating home showed stale data (compiled papers still listed). Fix: health/page.tsx `resetToZero` calls `router.refresh()` after success to invalidate the client router cache.
- (closed 2026-08-13) Paper Knowledge reliability (R4): stale health panel after reset (resetEpoch bump → PaperKnowledgePanel refreshKey prop re-polls in-session), retry blocked while another amend ran (claim-based retry, always 202, no more 409), 120s gateway timeouts (LLM_REQUEST_TIMEOUT_MS default 120s→300s, env-tunable with NaN guard), empty LLM responses not retried (llmJson runs a compact-budget retry once — kept as a SINGLE llmJson function, a mistaken duplicate was removed). Root evidence: all 3 papers failed — 2x 120s timeouts, 1x empty content (reasoning_tokens == completion_tokens).
- (closed 2026-08-13) Display round 2: diagram fences rendered as bare inline text — the diagram id lives in the fence INFO STRING (```diagram overview → meta="overview") but the code override parsed it from the content's first line (the brief's first sentence) and failed the id regex; NOT a stale build (.next deletion proved it). Also: <figure> in <p> warnings (img override returned a block-level figure while markdown wraps standalone images in <p>) and figure caption math not rendering (captions rode in the image alt, which the alt sanitizer stripped of   LaTeX-mangling chars). All fixed; a diagram fence can never legitimately render as bare text.
- (closed 2026-08-13) Diagram render 500 (Round 6): llmChat's maxTokens 8192 was spent ENTIRELY on reasoning_content → finish_reason "length" with empty content → res.json() crash. Fix: maxTokens 32768 + try/catch at llmChat, the API route, and the client. Lesson: reasoning models can burn the whole budget on reasoning_content — guard empty-content responses.
- (closed 2026-08-13) /diagrams/<slug>/overview.svg 404: the [id] dynamic segment captured "overview.svg" including the extension, ID_RE rejects dots → 404 before the file read (the handler would then also have looked up overview.svg.svg). Fix: strip trailing .svg from params.id before validation, then read `${id}.svg`.
- (closed 2026-08-13) Bare-LaTeX figure captions (no $...$ delimiters) in terminal bodies didn't typeset. Render-side fix (no re-amend): wrapBareMath in src/lib/math.ts — splits on already-delimited $...$ (preserved), wraps runs containing a backslash command/_/^ (bounded by whitespace/sentence punctuation/em- and en-dashes; ASCII hyphen kept so x_{t-1} stays whole); applied to the figcaption input in WikiMarkdown's p override. Already-delimited math untouched.
- (closed 2026-08-13) Code-review robustness round: stripH2Section dropped everything AFTER the stripped section on amend retries (data loss via stripPaperKnowledgeBlock/stripFiguresSection); validatePaperKnowledge crashed with a TypeError on malformed LLM output (non-object top level, non-object overview_diagram/mechanism_chain/diagram); readCachedDiagrams could report hasSvg for a stale brief after a retry amend. Fixes: stripH2Section preserves before AND after; JSON/object guards; hasSvg only when cached briefHash matches the current body brief.
- NOTE (2026-08-13): the four fixes above are edits in place but NOT yet verified — user must run `yarn build` + restart + smoke per AGENTS.md before trusting them.

## Gotchas

- Cross-realm attr() no-op (svg.js inside node:vm): attr() dispatches on
  `attr.constructor === Object`; object literals created in the VM realm have
  the VM realm's Object as constructor, so `.attr({...})` SILENTLY no-ops
  (labels collapsed to x=0, top-left corner). Fix: after vm.createContext,
  bridge realm prototypes — `vm.runInContext('Object'/'Array',
  ctx).prototype.constructor = host Object/Array`. Sandbox object props are
  globals, but realm intrinsics must be fetched via runInContext.
- svg.js <text> contains a <tspan> with its own x attr (synced only by
  .move(), initial 0) that overrides the text x in rendering — strip x from
  every tspan pre-serialize (keep dy for multiline).
- svg.js .svg() runs writeDataToDom(), which re-adds data-svgjs attrs AFTER
  any pre-serialize strip — scrub the final serialized string instead:
  `svg.replace(/ data-svgjs="[^"]*"/g, '')`.
- Job/refresh polls must be per-item-terminal, and terminal UI states need a
  self-limit: the diagram poller refreshed only when ALL jobs settled (a
  completed diagram waited on slower siblings, up to 30min), and a done view
  persisted forever when the registry lost the job (sig unchanged → no
  re-seed). Fix: refresh as soon as ANY key turns terminal (Set of
  non-terminal keys) + 4s done-state timer falling back to a retry button
  with an 'render may have been interrupted' hint.
- vm sandbox gotchas (diagram renderer): TWO-PHASE runInContext — compile the
  fn in-context, then invoke it ALSO inside runInContext (vm timeout only
  guards the script containing the code; host-side calls of the returned fn
  hang on infinite loops); svgdom serializer throws Invalid State Error on
  the root's namespace-unaware xmlns — removeAttribute before serialize;
  foreignObject is never painted in <img>-served SVG — must serve via
  <object>.
- Section-boundary search must be LEVEL-AWARE: sectionEndAt uses
  /^#{3,4} /m for #### subsections but /^### |^## /m for ### sections
  (uniform patterns misplace fences); next-heading search must start AFTER
  the section's own heading line (own-heading-offset bug) or fences land one
  section early.
- `next build` (`yarn build`) does NOT typecheck `scripts/` — a green build never covers script edits. After any change under `scripts/`, smoke manually: `yarn compile`, `yarn citations`, `yarn lint:wiki` (caveat carried in the compressed PROGRESS.md handoff). Instance: the spawned amend runner crashed at startup ("parseFlags is not a function") until cli-utils.ts exported it.
- undici global fetch hangs at connect in this app env (family-0 happy-eyeballs; IPv6 fails fast, IPv4 instant). All LLM HTTP goes through `llm-http.ts` (family-4-pinned node:https + hard 30s timeout) — do not reintroduce global fetch for LLM calls.
- `isGarbageName` (empty / pure digits / arXiv-id only) guards titles — NOT a filename-equality guard: fixture PDFs are named by title, so matching the filename rejects valid LLM titles into "untitled-…" fallbacks.
- `deriveDb()` validates invariants and throws. Topic skeletons are written under the run lock BEFORE the referencing paper page, so an aborted run never leaves an orphan milestone ref.
- Dedup is deliberately conservative (score ≥ 0.9): a missed duplicate is recoverable (re-drop), a false duplicate is near-impossible. Below the threshold the paper compiles; slug collisions are disambiguated code-side.
- Compile panel: a step with no event renders "not needed" once a LATER catalog step has run for that paper (or the paper finished) — don't read a missing event as "stuck". A gray "not started" paper means the run ended before it was dispatched — not a bug.
- LLM model catalog is cached; bypass with `publicCatalog(force)` or `?refresh=1`.
- Paper Knowledge papers in ready state are TERMINAL: prompt/template output-format changes apply ONLY to new amends — the 3 existing papers need reset-to-zero + recompile to show them; rendering fixes apply immediately and must be done RENDER-SIDE (e.g. the bare-LaTeX caption fix via wrapBareMath in src/lib/math.ts typesets existing captions without re-amend).
- Diagram ids live in the fence INFO STRING, not the content: react-markdown v9 exposes it via `node.data?.meta` (hast-util-to-jsx-runtime passNode → props.node) — code overrides must read node.data, never parse the content's first line. The alt sanitizer strips `()[]*`-class chars, so captions containing LaTeX must not ride in the image alt.
- Deprecation warnings can come from stale compiled chunks: the "enhanceTextSelection" warning traced to react-pdf-highlighter@6.1.0, which already commented the option out (PdfHighlighter.js:264) — no code change, a fresh build/restart resolves it.
- Reasoning models can spend the ENTIRE maxTokens budget on reasoning_content and return finish_reason "length" with empty content — downstream res.json()/JSON.parse crashes. Budget generously (llmChat now 32768) and guard empty content at the LLM client, the API route, and the client.
- Dynamic route segments that carry a file extension must include the extension in the segment regex (or strip it before validation): /figures/[slug]/[file] always did; /diagrams/[slug]/[id] did not, so "overview.svg" failed ID_RE → 404 before the file read (and the handler appended ".svg" on top).

## Open Questions
