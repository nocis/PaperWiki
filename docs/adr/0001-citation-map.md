# Citation Map as the derived source of truth for cites/citedBy

The wiki's citation layer is built around an LLM-built **Citation Map** (`data/citations/map.json`): every compiled paper's raw bibliography (extracted verbatim by the compile's analyze LLM — every entry, no truncation) is matched against the compiled-paper index by a slim dedicated LLM call (`citationMapPrompt`), and only the RESOLVED matches (`{ entry, matchedSlug }`) are persisted. `cites[]`/`citedBy[]` frontmatter, the paper page's `## Citations` section (raw list displayed verbatim with `→ [[slug]]` markers), the lint's citation checks, and the `/citations` graph are all derived from this map.

## Considered options

- **Mechanical title matching** (previous behavior) — deterministic but format-sensitive; rejected as the core problem the feature exists to solve, and later removed entirely (matching is LLM-only; unlinked entries stay unlinked).
- **Two LLM calls (parse, then match)** — rejected: one call does both, with bounded per-paper context.
- **Two calls with a separate match-only pass** — rejected: the map is rebuilt per paper; there is no match-only refresh use case that justifies the split.
- **Per-paper map files** — rejected in favor of one map file matching the rebuild workflow ("provide this file + all compiled slugs to the LLM").
- **Semantic relations merged into the graph** — rejected: `predecessors`/`contradictions`/`crossTopicImpacts` remain LLM-curated narrative edges, separate from bibliographic fact.
- **Full record normalization per entry (title/authors/year/venue/doi)** — initially adopted, then rejected: the paper page only needs the raw list (verbatim display) and the resolved links; normalizing every entry multiplied output tokens for no rendered value and pushed the slim call past the model's output cap. The map holds matches only.

## Consequences

- Rebuilds reuse the persisted `rawReferences` — no PDF re-extraction except for legacy papers missing map entries; a list hitting the extraction cap is a lint warning.
- Rebuild is fail-hard per run (mirrors compile); per-paper progress is tracked in `.log/citations-*` and shown on the health page.
- `cites[]` no longer includes predecessors/cross-topic relations — the map is authoritative, so the reciprocity invariant stays mechanical.
- Lint treats map-vs-frontmatter drift as mechanical (`cites-map-drift`, auto-fixable) and missing entries as a warning (`missing-citation-map`, action = health-page rebuild).
- Matching is LLM-only and output-tiny (a few tokens per paper), so the slim call never truncates; compile's finalize pass builds the map against the full final index, and compile self-heals interrupted runs by finalizing pending entries.
