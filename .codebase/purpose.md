<!-- Priority: critical | Updated: 2026-08-12 -->
# Purpose

PaperWiki is a research knowledge management system in which an LLM acts as a
disciplined maintainer of a structured wiki of compiled papers.

A researcher drops PDFs into `papers/new/`; the compile pipeline extracts a
deep analysis of each document (bounded essence, contributions as deltas vs
prior art, a contrastive prior→update novel insight, verbatim bibliography,
typed relations to other papers), classifies it into a tree of milestone
Topics, and maintains a personal knowledge layer (`knowledge/`) in which the
researcher's own pieces are clustered into articles and reviewed against the
literature. The result is a living, queryable model of a field — an automated
survey — rather than a collection of document summaries.

## Design principles (README §2)

- **P1** — The wiki is a model of the field, not an archive of documents;
  Topic assignment is subject to a fitness check (shared research question,
  not shared vocabulary).
- **P2** — The LLM is a disciplined maintainer governed by `wiki/SCHEMA.md`,
  the operating manual loaded into prompts; no invented slugs/citations/claims.
- **P3** — Formats are owned by code, content by the model. Derived artifacts
  (`data/wiki-db.json`, citation map, knowledge articles) are regenerated from
  zero and never hand-edited.
- **P4** — Provenance and falsifiability via wikilinks; `comments/` (private
  reading notes) is quarantined — the pipeline never reads it.
- **P5** — Graded maintenance autonomy: mechanical lint fixes are automatic;
  structural changes are queued as proposals for operator approval.
- **P6** — Literature truth (`wiki/`) is separated from personal knowledge
  (`knowledge/`).

## Domain vocabulary

Canonical terms live in `GRILL.md`: Topic, Paper, Relation (builds-on /
extends / supersedes / contradicts / impacts), prior/update, knowledge piece,
favorite, compile, journal. Use these in code, docs, and conversation; avoid
the aliases GRILL.md flags.

## Current state (as of init, per PROGRESS.md)

Feature-complete across four phases (compiler/API, web UI, figures + health
lint, knowledge layer). Reference corpus: 3 compiled papers on diffusion
models (Sohl-Dickstein 2015; DDPM; DDIM) under one topic; 3 knowledge pieces
compiled into 2 articles. Verification is manual — the maintainer runs
`yarn build` and browser smoke tests; there is no automated test suite.
