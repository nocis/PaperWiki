# PaperWiki

PaperWiki is a research knowledge management system in which a large language
model acts as a disciplined maintainer of a structured wiki of compiled
papers. A researcher drops PDFs into an inbox; the system extracts a deep
analysis of each document, classifies it into a tree of milestone topics,
positions it temporally relative to related work through typed relations,
and maintains a personal knowledge layer in which the researcher's own notes
are compiled and reviewed against the literature. The result is a living,
queryable model of a field — an automated survey — rather than a collection
of document summaries.

---

## 1. Motivation

Reading a single paper is insufficient for understanding a field: a document
acquires meaning only in relation to the prior beliefs it revises, the line
of work it extends, the results it contradicts, and the successor results
that supersede it. Survey papers perform this synthesis manually, but they
are expensive to produce and become stale as the literature grows.

PaperWiki addresses this by making the synthesis itself the unit of
maintenance. Each compiled paper is represented as a structured page that
records, at minimum: a bounded essence; contributions expressed as deltas
with respect to prior art; a contrastive novel insight (prior belief versus
the update the paper introduces); typed relations to other compiled papers;
and a verbatim bibliography with resolved links into the corpus. These
structures are the machine-readable analogue of the analysis a survey author
performs.

## 2. Design Principles

**P1 — The wiki is a model of the field, not an archive of documents.**
Papers are organized under milestone topics, each of which carries a
definition, a source cluster, and a chronological evolution. Classification
is subject to a fitness check: a paper's core research question must fall
within the topic's definition; shared vocabulary does not constitute a
shared research question.

**P2 — The LLM is a disciplined maintainer, governed by an explicit
operating manual.** `wiki/SCHEMA.md` defines conventions, invariants, and
workflows and is loaded into the system prompt of every conversational
query. The model may not invent slugs, citations, or claims; absence of
evidence must be reported as absence.

**P3 — Formats are owned by code; content is owned by the model.**
Deterministic renderers produce page layouts and derived files
(`data/wiki-db.json`, the citation map, knowledge articles) from
model-supplied structured content. Derived artifacts are never hand-edited;
regeneration is from zero.

**P4 — Provenance and falsifiability are enforced.** Every claim in the
wiki is traceable through wikilinks to the page from which it derives.
Private reading notes (`comments/`) are quarantined: the pipeline never
reads them, and no prompt may reference them.

**P5 — Maintenance autonomy is graded.** Lint tiers distinguish mechanical
repairs, which are applied automatically and logged, from structural
changes, which are queued as proposals and applied only with operator
approval.

**P6 — Literature truth and personal knowledge are separated.**
`wiki/` contains the compiled literature; `knowledge/` contains the
researcher's own pieces, which are clustered into articles and reviewed
against the literature as supported, contradicted, or unaddressed.

## 3. Architecture

### 3.1 Storage layers

| Layer | Location | Owner | Role |
|-------|----------|-------|------|
| Source archive | `papers/compiled/` | compiler | Immutable PDFs, flat layout, stable URLs |
| Work queue | `papers/new/` | researcher | Unprocessed PDFs; emptied by each compile |
| Wiki | `wiki/` | LLM | Papers, topics, index, log, journal, proposals |
| Derived index | `data/wiki-db.json` | compiler | Regenerated index; never hand-edited |
| Citation map | `data/citations/map.json` | compiler | Resolved bibliography matches only |
| Reading notes | `comments/<slug>/` | researcher | Private; quarantined from all LLM prompts |
| Knowledge pieces | `knowledge/pieces/` | researcher | Personal knowledge, created only via Add-to-knowledge |
| Knowledge articles | `knowledge/articles/` | compiler | Derived topic articles over pieces |

### 3.2 Compilation pipeline

Per paper, in order:

1. **Extraction** — PDF text and page count; figures extracted separately as
   a best-effort step that never aborts the run.
2. **Analysis and classification** (one merged LLM call) — real title,
   essence, contributions as deltas, contrastive novel insight, verbatim
   bibliography, critical analysis, typed relations to papers in the current
   index, and topic assignment subject to the fitness check.
3. **Slug resolution** — canonical naming derived from the real title,
   independently of the dropped filename.
4. **Citation matching** — a slim LLM call maps bibliography entries to
   compiled papers; matching is exact-title-and-authors, never approximate.
5. **Topic synthesis** — the topic page is compounded with the new source;
   earlier insights are retained, not restated from scratch.
6. **Relation finalization** (end of run) — because the analysis pass
   observed a partial index, one slim call per compiled paper re-maps typed
   relations against the complete final index; results are validated
   code-side and the relations block is patched in place.
7. **Derived-file rebuild** — index, database, and citation map are
   regenerated atomically.

Compile failures are fail-hard; duplicate detections are non-fatal skips
moved to `papers/duplicates/`.

### 3.3 Typed relations

Relations form the graph structure of the corpus and are restricted to five
types: `builds-on`, `extends`, `supersedes` (temporal), `contradicts`, and
`impacts` (cross-topic). They are persisted in paper frontmatter
(`relations[]`) and rendered in the citation graph as directed, colored
edges; a filter isolates a single relation class, and each edge carries the
model's explanatory note.

### 3.4 Contrastive analysis

The novel-insight field is a pair `{ prior, update }`: the received view of
the field the paper argues against, and the specific revision it introduces.
Pages compiled before this format are rendered as-is.

## 4. Operational Workflows

| Operation | Interface | Semantics |
|-----------|-----------|-----------|
| Ingest | `yarn compile` | Incremental ingestion per §3.2; journal entry per run |
| Query | `/chat` | Retrieval over the index; answers cite `[[slug]]` pages; ephemeral, never written back |
| Lint | `yarn lint:wiki`, `/health` | Invariant checks; mechanical auto-fixes; structural proposals |
| Rebuild citations | `yarn citations`, `/health` | Re-maps the persisted reference lists only; the PDF is never re-read |
| Knowledge compile | `/knowledge` | Clusters pieces into articles; reviews claims against the wiki; wipes stale articles except favorites |
| Reset | `/health` (danger zone) | Returns all compiled PDFs to the inbox and deletes derived artifacts; favorites and private notes are preserved |

## 5. Implementation Status

The current implementation is feature-complete across four phases: the
compiler and API layer, the web interface, figures with health linting, and
the knowledge layer. The reference corpus contains three compiled papers on
diffusion models (Sohl-Dickstein 2015; DDPM; DDIM), organized under one
milestone topic, with a citation map of match-only resolution and a
knowledge layer of three pieces compiled into two articles. Typed relations,
relation finalization, favorites, and the reset workflow are operational.
Verification is partial: `yarn build` and browser smoke tests are executed
manually by the maintainer.

## 6. Usage

```bash
yarn install                      # install dependencies
cp .env.example .env.local        # configure LLM provider credentials
yarn dev                          # start the web application
yarn compile                      # ingest papers from papers/new/
yarn citations [--slug <slug>]    # rebuild citation matches
yarn lint:wiki                    # run the invariant linter
```

Primary routes: `/` (compile dashboard), `/wiki` (browse), `/paper/<slug>`
(paper pages), `/citations` (typed relation graph), `/knowledge` (personal
layer), `/chat` (cited question answering), `/health` (lint, citation
rebuild, reset).

## 7. Documentation

- `wiki/SCHEMA.md` — the LLM operating manual: conventions, invariants, and
  workflows; loaded into chat system prompts.
- `GRILL.md` — the domain glossary (topic, relation, prior/update, favorite,
  journal).
- `docs/adr/` — architectural decision records (citation map, knowledge
  layer, relations in frontmatter).
- `PROGRESS.md` — session handoff and implementation status.

## 8. License

MIT — see [LICENSE](LICENSE).
