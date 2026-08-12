<!-- Priority: high | Updated: 2026-08-13 -->
# Notes

## Known Issues

- (closed 2026-08-13) Cancel compile left the button stuck on "Compiling…" forever — the poll's terminal check only handled completed/failed, not cancelled. Fix: "cancelled" added to the stop condition (PendingCompilePanel.tsx). Lesson: any run-status poll must treat cancelled as terminal.
- (closed 2026-08-13) Reset-to-zero then navigating home showed stale data (compiled papers still listed). Fix: health/page.tsx `resetToZero` calls `router.refresh()` after success to invalidate the client router cache.

## Gotchas

- undici global fetch hangs at connect in this app env (family-0 happy-eyeballs; IPv6 fails fast, IPv4 instant). All LLM HTTP goes through `llm-http.ts` (family-4-pinned node:https + hard 30s timeout) — do not reintroduce global fetch for LLM calls.
- `isGarbageName` (empty / pure digits / arXiv-id only) guards titles — NOT a filename-equality guard: fixture PDFs are named by title, so matching the filename rejects valid LLM titles into "untitled-…" fallbacks.
- `deriveDb()` validates invariants and throws. Topic skeletons are written under the run lock BEFORE the referencing paper page, so an aborted run never leaves an orphan milestone ref.
- Dedup is deliberately conservative (score ≥ 0.9): a missed duplicate is recoverable (re-drop), a false duplicate is near-impossible. Below the threshold the paper compiles; slug collisions are disambiguated code-side.
- Compile panel: a step with no event renders "not needed" once a LATER catalog step has run for that paper (or the paper finished) — don't read a missing event as "stuck". A gray "not started" paper means the run ended before it was dispatched — not a bug.
- LLM model catalog is cached; bypass with `publicCatalog(force)` or `?refresh=1`.

## Open Questions
