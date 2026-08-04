# Knowledge layer: from-zero derived compilation of user knowledge

The wiki (`wiki/`) is literature ground truth: compiled from PDFs, LLM-written, invariant-checked. The human's own knowledge — reading notes, chat discoveries, personal claims — was previously quarantined (`comments/`, never LLM-readable) or ephemeral (chat answers). This ADR adds a second, separate tree: **`knowledge/`**, where the human's knowledge lives as atomic **Knowledge Pieces** (added only via an explicit Add-to-knowledge action) and is compiled by the LLM into overlapping **Topic Articles**, each carrying an **Academic Review** section that maps the article's claims against wiki truth (supported / contradicted / unaddressed).

## Considered options

- **Write user knowledge into the wiki** (e.g., `## Open Questions`, inline insight sections on topic pages) — rejected: mixes human-owned claims with literature-derived ground truth, breaking lint invariants and the ground-truth promise of `wiki/`.
- **Let the knowledge pipeline read `comments/` directly** — rejected: violates the comments quarantine invariant (SCHEMA #1). Only an explicit user button copies a note into `knowledge/pieces/`.
- **Incremental knowledge compilation** (like paper compile: patch existing articles as pieces arrive) — rejected in favor of **from-zero** regeneration every compile: stateless, no merge state, always consistent with the latest wiki.
- **Hand-editable articles with merge-on-recompile** — rejected: derived-only keeps the human out of the loop, matching the citation-map model; edits belong in pieces (delete + re-add).
- **User-defined topic list** (LLM only assigns) — rejected in favor of LLM-discovered topics with optional `topics[]` piece hints, preserving serendipitous cross-paper topics (e.g., "diffusion sampling evolving").
- **Piece versioning** — rejected: the human manages their own versioning/backup externally; the project's no-git rule makes file-snapshot versioning low-value for pieces.

## Consequences

- `knowledge/pieces/` is the only human-owned, LLM-readable source; `knowledge/articles/` and `knowledge/index.md` are derived and fully regenerated each Knowledge Compile.
- Articles may reference pieces and papers many-to-many (overlapping membership is intended).
- Knowledge Compile is fail-hard with LLM pre-flight and progress tracking, mirroring paper compile; it never writes `wiki/` pages and never reads `comments/`.
- Lint gains knowledge checks: broken piece/article wikilinks, orphan pieces, article↔piece mismatch, and a "wiki changed since last knowledge compile" staleness flag.
