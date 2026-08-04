# PaperWiki

A personal research-paper knowledge base: PDFs are compiled into an Obsidian-style
markdown wiki with LLM-written paper pages, milestone topics, and reading notes.
This context defines the domain language used across the compiler, the wiki schema,
and the web UI.

## Language

**Inbox**:
The `papers/new/` directory — the work queue of PDFs awaiting compilation. A PDF present here is an unprocessed source.

**Compile**:
The LLM pipeline that turns one inbox PDF into a paper page, a topic assignment, and derived index entries. Compiled PDFs move to the archive.

**Archive**:
The `papers/compiled/` flat directory of compiled PDFs, named by canonical slug. Immutable once written; reorganizations never move PDFs.

**Slug**:
The canonical kebab-case identifier of a paper or topic, derived from the paper's real title. It names the PDF, the wiki page, the comments directory, and the figures directory.

**Milestone**:
A topic in the wiki (standalone, merged, or split mode) that a paper page points to via its `milestone` field. The paper's core research question must genuinely fit the topic's definition (classification fitness).

**Subtopic**:
An optional inline cluster inside a merged milestone. Papers declare a `subtopic`; milestones list them in `subtopics`.

**Source Cluster**:
The `## Source Cluster` section of a milestone page listing its paper pages. Bidirectional with each paper's `milestone` field.

**Figure**:
A visual extracted from a compiled PDF (embedded raster image or a rendered key page), stored in the paper's figures directory and embedded into its wiki page.

**Comment**:
A private reading note attached to a PDF annotation, stored under `comments/<slug>/`. Quarantined — never fed to the LLM.

**Proposal**:
A Confirm-tier structural recommendation (split, promote, tag-to-parent) queued in `wiki/proposals.md`, never auto-applied by compile.

**Lint**:
A wiki health inspection that detects invariant violations and broken references, auto-fixing mechanical issues and queueing structural ones as proposals.

**Citation Map**:
The derived artifact `data/citations/map.json`: per compiled paper, the persisted raw bibliography (extracted by the compile's analyze LLM — EVERY entry, no truncation, no normalization) plus only the RESOLVED matches `{ entry, matchedSlug }` pointing into that list. The raw bibliography is displayed verbatim on the paper page with `→ [[slug]]` markers on resolved entries. `cites[]`/`citedBy[]`, the citation coverage stats, and the `/citations` graph are derived from the map. Matching is a slim dedicated LLM call (`citationMapPrompt`), run at compile's finalize pass (against the full final index) or during a rebuild — the PDF is never re-read. Matching is LLM-only: an entry the LLM does not resolve stays unlinked, and compiled papers that are never cited are left alone.

**Citation Record**:
One resolved match in the Citation Map: `{ entry, matchedSlug }` — the 1-based position of an entry in the paper's raw reference list plus the compiled-paper slug it resolves to. Produced by a dedicated slim LLM call that matches any bibliography style (IEEE, APA, BibTeX, …) to compiled papers in the same step. No normalization is stored or displayed.

**Unlinked Citation**:
A raw bibliography entry that the LLM did not resolve to any compiled paper — it has no entry in the Citation Map. It renders as plain text on the paper page (no clickable link) and is counted in coverage stats; it is never a lint problem.

**Citation Coverage**:
The per-paper (and wiki-wide) ratio of matched to total Citation Records — the "x of y linked" line on paper pages and the summary chips on the health page and `/citations`.

**Citations Page**:
The `/citations` UI: a zero-dependency SVG force graph of papers (nodes, colored by milestone) with directional citation edges, plus most-cited / citing-most / isolated lists. Distinct from the Citation Map data artifact.

**Citation Rebuild**:
A run that re-parses and re-matches Citation Records per paper (persisted raw bibliography, PDF fallback for legacy papers), rewrites `cites[]` + the page's `## Citations` section, then recomputes `citedBy[]` globally. Triggered per-paper or for all papers from the health page; fail-hard with progress tracking.

**LLM Availability**:
The state of the selected provider/model for LLM work: `unknown | checking | available | unavailable`, with a reason kind (`missing-key | auth | quota | unreachable | other`). Driven by `GET /api/llm/availability` (cached server-side, polled client-side while the tab is visible), surfaced by the site-wide banner, the nav status dot, and the compile/rebuild button blocking. Distinct from Wiki Health, which inspects wiki invariants.

**Knowledge Piece**:
An atomic unit of the user's own knowledge (`knowledge/pieces/<slug>.md`, kind `note` or `chat`). Created only via the explicit Add-to-knowledge action from a reading note (source = comment id) or a selected chat range (source = `chat-<timestamp>`). The wiki (literature ground truth) never writes pieces; the knowledge pipeline reads them but never modifies them in place.

**Piece edit / topic management**:
Two separate post-add operations. *Edit-content* rewrites the body — allowed for `chat` pieces only; `note` pieces are immutable (delete + re-add is their edit path). *Set-topics* manages the `topics[]` hint field and is allowed for both kinds. Any piece change stamps `updatedAt` and marks the knowledge layer stale (articles are derived and must be recompiled).

**Add-to-knowledge**:
The only sanctioned path for user knowledge to enter the LLM pipeline: an explicit user action (UI button) that copies a reading note or a selected chat message range into `knowledge/pieces/`. Comments stay quarantined — the knowledge pipeline never reads `comments/` directly.

**Knowledge Compile**:
A from-zero LLM build over `knowledge/pieces/` + the latest wiki: cluster pieces into overlapping Topic Articles, review each against wiki truth, and regenerate `knowledge/index.md`. Runs on demand from `/knowledge` (or headless via tsx). Each run is stateless — articles are derived artifacts, never hand-edited; no incremental state.

**Topic Article**:
A derived, regenerated-per-compile markdown page (`knowledge/articles/<slug>.md`) that groups several Knowledge Pieces into a coherent topic discovered by the LLM (e.g. "diffusion sampling evolving"). Pieces can appear in multiple articles. An article cites its pieces via `[[piece-slug]]`, grounds its claims in the wiki via `[[paper-slug]]`, and ends with an Academic Review section.

**Academic Review**:
The per-article section where the LLM critiques the article's claims against wiki ground truth: evidence mapping (supported / contradicted / unaddressed by compiled papers), novelty assessment, methodological critique, and research frontier. Distinct from a paper page's Critical Analysis, which critiques one paper.

**Model Catalog**:
The provider/model option list served by `GET /api/llm`. Nothing is bundled: the server fetches each provider's model list live from its OpenAI-compatible `/models` endpoint (parallel, per-provider failures isolated, 5-minute server-side cache) and exposes `keySet` (key env var present) + `modelsError` per provider. The client never assumes a default provider or model before the catalog arrives; the server does not reject model strings outside the catalog (env/CLI overrides stay valid).

## Relationships

- An **Inbox** PDF becomes exactly one compiled **Archive** PDF named by its **Slug**
- A **Compile** produces one **Paper** page and one **Milestone** assignment
- A **Milestone** owns zero or more papers via its **Source Cluster**
- A paper belongs to at most one **Subtopic** within its **Milestone**
- A paper's **Figures** live under the paper's slug and are embedded in its wiki page
- A **Comment** belongs to exactly one paper's slug directory
- A **Lint** run produces either **auto-fixes** (mechanical) or **Proposals** (structural)
- A **Citation Map** pins every paper's **Citation Records** to compiled papers; `cites[]` is derived from matched records, **citedBy[]** is its reciprocal
- An **Unlinked Citation** stays in the map and on the paper page but never enters `cites[]`
- **Compile** and **Citation Rebuild** require **LLM Availability** = `available`; the UI blocks their buttons otherwise, and the scripts fail-hard on their own pre-flight
- **LLM Availability** `missing-key` means the provider's API key env var is unset on the server (see **Model Catalog** `keySet`) — add it to `.env.local` and restart
- A **Knowledge Compile** reads all **Knowledge Pieces** and the latest wiki (ground truth) and writes only derived files — it never writes `wiki/` pages and never reads `comments/`
- A **Topic Article** is derived: hand edits are wiped by the next **Knowledge Compile**; edits belong in **Knowledge Pieces**

## Example dialogue

> **Dev:** "I dropped three PDFs into the Inbox. Compile renamed one from `2006.11239.pdf` to its real-title Slug — why?"
> **Domain expert:** "Slugs are canonical identifiers from the real title. The filename is just a carrier; the wiki, archive, comments, and figures all key off the Slug."
> **Dev:** "The new paper claims a Subtopic its Milestone doesn't list. Should I just add the Subtopic?"
> **Domain expert:** "No — that's a semantic change, a Confirm-tier Proposal. Lint flags it; the human decides. Auto-fix only repairs mechanical mismatches like a missing reciprocal citedBy link."

## Flagged ambiguities

- "milestone" was used to mean both the conceptual breakthrough and the YAML field pointing to it — resolved: the field references the milestone **topic** page.
- "figure" was used loosely to include any extracted image — resolved: only embedded raster images and rendered key pages qualify; icons and tiny decorations are filtered out.
- "knowledge" was used loosely to mean both the wiki (literature-derived) and the user's own notes — resolved: the **wiki** is literature ground truth (compiled from papers); **knowledge/** is the user's own knowledge (pieces + derived topic articles), a separate tree that the LLM compiles from zero.
