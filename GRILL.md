# PaperWiki

The domain vocabulary of an LLM-maintained research wiki: papers, milestone topics, typed relations, and the human's personal knowledge layer.

## Language

**Topic**:
A milestone node in the knowledge tree — a research direction with a definition, source cluster, and temporal evolution.
_Avoid_: milestone (frontmatter key only), bucket, category

**Paper**:
A compiled source page under `wiki/papers/` — deep analysis of one document, linked into its topic.
_Avoid_: source page, article (that's a knowledge-layer concept)

**Relation**:
A typed, LLM-assigned link from one paper to another: temporal (`builds-on`, `extends`, `supersedes`), `contradicts`, or cross-topic `impacts`.
_Avoid_: link, edge (generic graph words)

**Prior/update**:
The contrastive structure of a Novel Insight: `prior` = the field's received view, `update` = what the paper changes about it.
_Avoid_: novelty, insight (unstructured prose)

**Knowledge piece**:
A unit of the human's own knowledge (`knowledge/pieces/`), created only by Add-to-knowledge.
_Avoid_: note (ambiguous with comments)

**Favorite**:
A piece-owned flag on a derived article that archives it — exempting it from the compile wipe.
_Avoid_: pin, star, bookmark

**Compile**:
The operation that ingests papers into the wiki; Knowledge Compile is a separate operation over pieces.
_Avoid_: ingest (reserved for a single paper's flow), build

**Slug**:
The canonical, title-derived identifier of a Paper or Topic (the "compiled name"): kebab-case, unique, names the paper page, its PDF, its comments dir, and its figure dir alike.
_Avoid_: compiled name, filename, page name

**Duplicate**:
A dropped PDF that the LLM has confirmed to be the same Paper as an already-compiled one (same work — title, authors, venue/date). A mere slug collision between distinct papers is not a Duplicate; the new Paper is compiled under a disambiguated Slug instead.
_Avoid_: collision, clash (a name overlap, not a verdict)

**Merge proposal**:
A Confirm-tier consolidation candidate joining two near-duplicate Topics into one. Queued in `wiki/proposals.md`, applied only by the human — never auto-applied.
_Avoid_: dedup, auto-merge

**Journal**:
The cognitive timeline at `wiki/journal/YYYY-MM.md` — dated entries auto-appended per operation (compile runs, resets).
_Avoid_: changelog, log (that's `wiki/log.md`, the audit trail)

## Relationships

- A **Paper** belongs to exactly one **Topic** (`milestone`) and may have many **Relations** to other Papers.
- A **Relation** classifies a **Paper** against another Paper: temporal, contradicts, or impacts.
- A **Knowledge piece** can appear in many derived articles; an article groups pieces and grounds claims on **Papers**.
- A **Favorite** is carried by one article and survives the **Compile** wipe.
- A **Journal** entry records each **Compile** and each reset.

## Example dialogue

> **Dev:** "Should the graph render `milestones` as nodes?"
> **Domain expert:** "They're Topics. Papers attach to exactly one Topic; the graph renders papers as nodes, Topics as colors, and Relations as colored edges."

> **Dev:** "The old paper pages have prose Novel Insights. How do we render them?"
> **Domain expert:** "Legacy pages render as-is; only new compiles emit the `prior → update` pair."

## Flagged ambiguities

- "milestone" was used in frontmatter (`milestone`, `parent_milestone`) and AutoWiki marketing, while docs said "topic" — resolved: **Topic** is canonical; the YAML key stays `milestone` for compatibility.
- "notes" meant both reading notes (`comments/`, quarantined) and knowledge pieces — resolved: **comments** vs **knowledge pieces** are distinct concepts.
- "log" meant both the audit trail (`wiki/log.md`) and the journal — resolved: **Journal** is the cognitive timeline; `log.md` is the audit trail.
- "compiled name" meant the slug that names the paper page, PDF, comments dir — resolved: **Slug** is canonical.
- "duplicate folder" implied any same-name file; resolved: a **Duplicate** is an LLM-confirmed same paper — a same-name but distinct paper keeps compiling under a disambiguated **Slug**.
