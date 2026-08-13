import type { ChatMessage } from "./llm";
import type {
  DeepAnalysis,
  Classification,
  PaperMergedResponse,
  TitleEssence,
  DedupScreen,
  TopicMergePair,
  TopicSynthesis,
  QueryRetrieval,
  CitationMapResponse,
  KnowledgeClusterArticle,
  KnowledgeClusterResponse,
  KnowledgeArticleResponse,
  RelationFinalizeResponse,
} from "./prompts/types";

export type {
  DeepAnalysis,
  Classification,
  PaperMergedResponse,
  TitleEssence,
  DedupScreen,
  TopicMergePair,
  TopicSynthesis,
  QueryRetrieval,
  CitationMapResponse,
  KnowledgeClusterArticle,
  KnowledgeClusterResponse,
  KnowledgeArticleResponse,
  RelationFinalizeResponse,
} from "./prompts/types";

// ---------------------------------------------------------------------------
// 1. Paper analysis + classification (ONE merged call; citations are matched
//    separately by the slim citation-map call)
// ---------------------------------------------------------------------------

/** Defensive cap on bibliography extraction — the prompt demands EVERY entry; this only bounds the JSON. */
export const MAX_REFERENCES = 150;

export function paperMergedPrompt(opts: {
  text: string;
  metaTitle: string | null;
  kbIndex: string;
  topicTree: string;
  language: string;
  /** Fixed facts from the title+essence phase — the deep call builds on them, never re-derives. */
  knownTitle?: string;
  knownEssence?: string;
}): { system: string; user: string } {
  const system = `You are the maintainer of a research-paper wiki knowledge base. You analyze ONE new paper and return a strict JSON object containing TWO parts: the paper analysis and the milestone classification. You may read the full paper text for both parts.
Part 1 — ANALYSIS. Rules:
- "predecessors", "crossTopicImpacts" and "contradictions" may ONLY reference paper slugs from the EXISTING WIKI INDEX provided by the user. Never invent slugs. If none apply, use empty arrays.
- Derive contributions from the delta between the field's prior art (the paper's own related work) and what the paper adds — never state them as isolated claims.
- When a KNOWN TITLE AND ESSENCE are provided, accept them as given: your analysis must agree with them and never contradict them.
- contributions: 3-6 concise deltas, each under 200 characters.
- references: the COMPLETE bibliography — every entry verbatim as printed in the paper, no truncation. At most ${MAX_REFERENCES} entries; omit only pure noise lines (page headers, section notes).
- novelInsight: a contrastive pair — "prior" is the field's received view or assumption this paper pushes against (under 400 characters), "update" is what this paper changes about it (under 400 characters).
- limitations, researchFrontier, and relationsContext: under 800 characters each.
- evolutionaryChain.role: "origin" (starts a new line of work), "intermediate" (builds on predecessors), "terminal" (closes/supersedes a line), or "fork" (splits a line).
- relationsContext: one short paragraph positioning the paper in the field's timeline (its predecessors, what it supersedes or contradicts).

Part 2 — CLASSIFICATION (fitness check, mandatory; use the raw paper text, not just the summary):
- The paper's core research question must genuinely fall within the topic's milestone definition.
- Shared keywords do NOT imply shared research questions.
- If no existing topic is a genuine conceptual match, CREATE a new standalone topic. Misclassification is worse than a small new topic.
- Topic tree has max depth 3. A "create" with parentSlug is only allowed if the parent is at depth <= 2.
- CREATION IS THE EXCEPTION, NOT A DEFAULT: before choosing "create", weigh it against EVERY existing topic in the tree above. In "reason", explicitly name the 1-3 closest existing topics (by slug) and state, for each one, the specific research-question mismatch that disqualifies it. If any existing topic is a genuine fit, choose "assign" instead.
- If a merged-parent topic (mode "merged") has a matching subtopic, assign with subtopicSlug set.
- New topic slugs: kebab-case, short, conceptual (e.g. "self-evolving-memory-architectures").

GENERAL:
- Respond with JSON only. No prose outside the JSON object.
- Write all prose fields in language "${opts.language}".
- Keep the complete JSON response compact so it fits within the output token limit.`;

  const user = `EXISTING WIKI INDEX (papers you may reference by slug):
${opts.kbIndex || "(empty — this is one of the first papers)"}

EXISTING TOPIC TREE (slug — definition [mode, subtopics]):
${opts.topicTree || "(empty — no topics yet)"}

PDF metadata title: ${opts.metaTitle ?? "(none)"}
${
  opts.knownTitle || opts.knownEssence
    ? `\nKNOWN TITLE AND ESSENCE (fixed facts — accept them as given, do not re-derive):
Title: ${opts.knownTitle ?? "(none)"}
Essence: ${opts.knownEssence ?? "(none)"}\n`
    : ""
}
PAPER TEXT (extracted, possibly truncated):
${opts.text}

Return JSON with exactly these fields:
{
  "authors": string[],
  "venue": string,
  "publishedAt": "YYYY-MM or empty string",
  "contributions": string[],
  "novelInsight": { "prior": string, "update": string },
  "limitations": string,
  "researchFrontier": string,
  "references": string[],
  "predecessors": [{ "slug": string, "relation": "builds-on|extends|supersedes", "note": string }],
  "evolutionaryChain": { "role": "origin|intermediate|terminal|fork", "note": string },
  "crossDomainOrigin": string | null,
  "crossTopicImpacts": [{ "slug": string, "note": string }],
  "contradictions": [{ "slug": string, "note": string }],
  "relationsContext": string,
  "classification": { "action": "assign", "topicSlug": string, "subtopicSlug": string|null, "reason": string }
              OR { "action": "create", "topic": { "slug": string, "name": string, "definition": string, "parentSlug": string|null, "tags": string[] }, "reason": string }
}`;

  return { system, user };
}

// ---------------------------------------------------------------------------
// 1a2. Title + essence (the dedup key, extracted BEFORE any deep analysis —
//      one slim call; duplicates are decided without paying for the deep pass)
// ---------------------------------------------------------------------------


export function titleEssencePrompt(opts: {
  text: string;
  metaTitle: string | null;
  filename: string;
  language: string;
}): { system: string; user: string } {
  const system = `You extract TWO facts about ONE research paper: its exact title and a concise essence. Return strict JSON: {"title": string|null, "essence": string|null}.
Rules:
- "title": the paper's actual title as printed in the document (usually near the top of page 1). Return null only if the text contains no extractable title (e.g. scanned pages with no text layer). Never invent, paraphrase, or reconstruct a title from context. Never return the filename.
- "essence": 3 sentences max (scope, method, insight), under 600 characters. Base it on the abstract and the paper's own framing. Return null only if the text contains no usable content.
- Respond with JSON only. Write essence in language "${opts.language}".`;
  const user = `PDF filename: ${opts.filename}
PDF metadata title (may be unreliable): ${opts.metaTitle ?? "(none)"}

PAPER TEXT (extracted, possibly truncated):
${opts.text}

Return JSON: {"title": string|null, "essence": string|null}`;
  return { system, user };
}

// ---------------------------------------------------------------------------
// 1c. Dedup screen (title+essence of the new paper vs the compact history
//     record — the SINGLE duplicate decision: score >= 0.9 means duplicate)
// ---------------------------------------------------------------------------


/** Same-document confidence required to declare a duplicate (conservative — below this, compile). */
export const DEDUP_SAME_SCORE = 0.9;

export function dedupScreenPrompt(opts: {
  title: string;
  essence: string;
  record: string;
}): { system: string; user: string } {
  const system = `You decide whether ONE new research paper is a duplicate of any paper in a wiki's compiled history. Return strict JSON: {"slug": string|null, "score": number}.
Rules:
- Compare the new paper's title AND essence against each record entry.
- "same document" signals: near-identical title AND near-identical essence — re-drops under different filenames, preprint vs published version, a later identical retitle.
- Distinct papers that merely share vocabulary or similar titles are NOT duplicates: their essences differ.
- Mark the incoming as a duplicate ONLY when you are quite sure: the best match must have same-document confidence >= ${DEDUP_SAME_SCORE}. Otherwise return {"slug": null, "score": 0}.
- score: 0-1 same-document confidence for the picked entry. Only slugs listed in the record are valid.
- Respond with JSON only.`;
  const user = `INCOMING (new drop):
Title: ${opts.title}
Essence: ${opts.essence}

COMPILED HISTORY (slug — title — essence):
${opts.record || "(empty history — no compiled papers yet)"}

Return JSON: {"slug": string|null, "score": number}`;
  return { system, user };
}

// ---------------------------------------------------------------------------
// 1d. Topic merge detection (Confirm-tier — proposals only, never auto-applied)
// ---------------------------------------------------------------------------


export function topicMergePrompt(opts: {
  topics: { slug: string; name: string; definition: string; parentSlug: string | null }[];
}): { system: string; user: string } {
  const system = `You detect near-duplicate milestone topics in a research-paper wiki topic tree. Return strict JSON: {"mergeCandidates": [{"slugA": string, "slugB": string, "reason": string}]}.
Rules:
- Pair ONLY topics covering the SAME research direction — their milestone definitions genuinely overlap. Shared vocabulary alone does NOT qualify (fitness is about the research question, not keywords).
- Never pair a topic with itself, with its own parent, child, or subtopic.
- Prefer pairs of siblings or leaves; a pair is useless if one topic already absorbs the other as a subtopic.
- reason: one sentence (under 200 characters) naming the overlap.
- Return an empty array when there are no genuine near-duplicates.
- Respond with JSON only.`;
  const user = `TOPIC TREE (slug — name — definition [parent]):
${opts.topics.map((t) => `${t.slug} — ${t.name} — ${t.definition} [parent: ${t.parentSlug ?? "(root)"}]`).join("\n")}

Return JSON: {"mergeCandidates": [{"slugA": string, "slugB": string, "reason": string}]}`;
  return { system, user };
}

// ---------------------------------------------------------------------------
// 2. Topic synthesis (Ingest Phase 4 — the compounding step)
// ---------------------------------------------------------------------------


export function topicSynthesisPrompt(opts: {
  topicName: string;
  topicSlug: string;
  currentDefinition: string;
  existingBody: string | null;
  sources: { slug: string; title: string; essence: string; contributions: string[]; publishedAt: string }[];
  subtopics: string[];
  language: string;
}): { system: string; user: string } {
  const system = `You are the maintainer of a research-paper wiki. You rewrite the synthesis sections of ONE milestone topic page so it reflects ALL of its sources. Return strict JSON only.

Rules:
- Write in language "${opts.language}".
- The synthesis must compound: integrate the new source with what the topic already says; do not restart from scratch, do not drop earlier insights.
- keyProperties: atomic properties of the milestone, each attributed with [[paper-slug]] where it came from.
- chronologicalEvolution: a markdown bullet list ordering sources by publication date, describing the evolutionary chain (who builds on whom, what gets superseded). REQUIRED if the topic has >= 3 sources or if the newest source changes the chain; otherwise null.
- Reference papers ONLY by the [[slug]] forms provided. Never invent slugs.
- If the topic is a merged parent with subtopics, also return per-subtopic notes keyed by subtopic slug (definition: one line; keyProperties: bullets with [[slug]] attribution). Use {} if not applicable.`;

  const sourcesText = opts.sources
    .map(
      (s) =>
        `### [[${s.slug}]] "${s.title}" (${s.publishedAt})\nEssence: ${s.essence}\nContributions: ${s.contributions.join("; ")}`
    )
    .join("\n\n");

  const user = `TOPIC: ${opts.topicName} (slug: ${opts.topicSlug})
Current definition: ${opts.currentDefinition || "(new topic)"}
Subtopics: ${opts.subtopics.length > 0 ? opts.subtopics.join(", ") : "(none)"}

EXISTING TOPIC PAGE BODY (may be empty for new topics):
${opts.existingBody ?? "(none)"}

SOURCES (${opts.sources.length}):
${sourcesText}

Return JSON:
{
  "definition": string,
  "keyProperties": string[],
  "chronologicalEvolution": string | null,
  "subtopicNotes": { "<subtopic-slug>": { "definition": string, "keyProperties": string[] } }
}`;

  return { system, user };
}

// ---------------------------------------------------------------------------
// 3. Query retrieval (chat hub, step 1: read the index, pick pages)
// ---------------------------------------------------------------------------


export function queryRetrievePrompt(opts: { index: string; question: string }): {
  system: string;
  user: string;
} {
  const system = `You are the retrieval planner for a research-paper wiki. Given the wiki index and a user question, pick the pages whose full text is needed to answer well. Return strict JSON only.

Rules:
- Pick at most 6 slugs total.
- Only use slugs that appear in the index. Never invent slugs.
- "papers" = paper pages (slugs under Papers), "pages" = topic/concept pages (slugs under Topics).
- If nothing is relevant, return empty arrays.`;

  const user = `WIKI INDEX:
${opts.index}

QUESTION:
${opts.question}

Return JSON: { "pages": string[], "papers": string[] }`;

  return { system, user };
}

// ---------------------------------------------------------------------------
// 4. Citation map (raw bibliography → resolved matches only)
// ---------------------------------------------------------------------------


export function citationMapPrompt(opts: { references: string[]; index: string }): {
  system: string;
  user: string;
} {
  const system = `You maintain a citation map for a research-paper wiki. Given a paper's numbered reference list (any citation style: IEEE, APA, BibTeX, ACM, etc.) and the wiki's compiled-paper index, find which entries are the same paper as a compiled wiki paper. Return strict JSON only.

Rules:
- Return ONLY entries that are genuinely the same paper: title strongly similar AND year/authors consistent. Never approximate, never guess.
- "entry" is the 1-based position of the entry in the numbered list below; "matchedSlug" is its slug from the WIKI INDEX.
- The paper being processed never cites itself; if an entry IS the paper itself, skip it.
- If no entries match, return { "citations": [] }.
- Respond with JSON only. No prose outside the JSON object.`;

  const user = `WIKI INDEX (compiled papers you may match against):
${opts.index || "(empty index)"}

REFERENCE LIST OF THE PAPER (numbered, as extracted from its bibliography):
${opts.references.length > 0 ? opts.references.map((r, i) => `${i + 1}. ${r}`).join("\n") : "(empty)"}

Return JSON: { "citations": [ { "entry": number, "matchedSlug": string } ] }`;

  return { system, user };
}

// ---------------------------------------------------------------------------
// 5. Knowledge Compile (user knowledge → overlapping topic articles)
// ---------------------------------------------------------------------------



export function knowledgeClusterPrompt(opts: {
  pieces: { slug: string; kind: string; topics: string[]; body: string }[];
  papers: string; // compact wiki paper index
  topics: string; // compact wiki topic tree
  language: string;
}): { system: string; user: string } {
  const system = `You organize a researcher's personal knowledge into topic articles for a Wikipedia-style knowledge base. Given the researcher's knowledge pieces (atomic notes and chat extracts) and the literature wiki, cluster the pieces into coherent topics. Return strict JSON only.

Rules:
- Discover the topics yourself from the content (e.g. "diffusion sampling evolving", "from UNet to DiT as continuous solvers") — do NOT mirror wiki topics unless the pieces genuinely form that topic.
- A piece MAY appear in MULTIPLE articles when it genuinely belongs to several topics (overlapping membership is intended).
- Every piece must appear in at least one article. Do not drop pieces; if a piece is truly standalone, make it a single-piece article.
- Respect piece topic hints ("topics" field) as nudges toward grouping, but decide by content fit.
- "paperSlugs" per article: from the WIKI PAPERS index only, the compiled papers that the article's claims engage with. Never invent slugs; empty array if none.
- article slugs: kebab-case, short, conceptual, unique.
- definition: one sentence (under 200 characters) capturing the article's scope.
- Respond with JSON only. Write all prose in language "${opts.language}".`;

  const piecesText = opts.pieces
    .map((p) => `### [[${p.slug}]] (kind: ${p.kind}${p.topics.length > 0 ? `, hints: ${p.topics.join(", ")}` : ""})\n${p.body}`)
    .join("\n\n");

  const user = `WIKI PAPERS (compiled literature, may be referenced by slug):
${opts.papers || "(no papers compiled yet — grounding will be limited)"}

WIKI TOPICS (for context):
${opts.topics || "(none)"}

KNOWLEDGE PIECES (${opts.pieces.length}):
${piecesText || "(no pieces — return {\"articles\": []})"}

Return JSON: { "articles": [ { "slug": string, "title": string, "definition": string, "pieceSlugs": string[], "paperSlugs": string[] } ] }`;

  return { system, user };
}


export function knowledgeArticlePrompt(opts: {
  title: string;
  definition: string;
  pieces: { slug: string; body: string }[];
  papers: string; // compact wiki paper index
  topics: string;
  language: string;
}): { system: string; user: string } {
  const system = `You write a topic article for a researcher's personal knowledge base, then review it against the literature wiki. Return strict JSON only.

The article has two parts:
1. SYNTHESIS — turn the knowledge pieces into a coherent narrative. Every claim must be attributed to its piece(s) with [[piece-slug]]. Do not add external knowledge; synthesize what the pieces say.
2. ACADEMIC REVIEW — check the article's claims against the WIKI PAPERS (the literature ground truth):
   - "grounding": for each relevant wiki paper (from WIKI PAPERS), map whether it SUPPORTS, CONTRADICTS, or leaves UNADDRESSED the article's claims. Include papers where the article's claims directly engage or should engage; only slugs from WIKI PAPERS. Status semantics: "supports" = evidence aligns, "contradicts" = tension/conflict, "unaddressed" = the wiki paper is relevant but the pieces don't cover it (a gap).
   - "novelty": what in the article is genuinely the researcher's own insight vs. restating the literature.
   - "critique": methodological or evidential weaknesses of the claims as stated in the pieces.
   - "limitations": what this article cannot claim given the compiled literature (gaps, missing evidence).
   - "research frontier": the open questions and next directions the article points to, given the literature.
- definition: one sentence (under 200 characters).
- Respond with JSON only. Write all prose in language "${opts.language}". Never invent paper slugs.`;

  const piecesText = opts.pieces.map((p) => `### [[${p.slug}]]\n${p.body}`).join("\n\n");

  const user = `ARTICLE: ${opts.title}
Scope: ${opts.definition}

WIKI PAPERS (compiled literature — the ground truth for the review):
${opts.papers || "(no papers compiled yet)"}

WIKI TOPICS (context):
${opts.topics || "(none)"}

KNOWLEDGE PIECES FOR THIS ARTICLE (${opts.pieces.length}):
${piecesText}

Return JSON: {
  "definition": string,
  "synthesis": string,
  "grounding": [ { "slug": string, "status": "supports|contradicts|unaddressed", "note": string } ],
  "novelty": string,
  "critique": string,
  "limitations": string,
  "frontier": string
}`;

  return { system, user };
}

// ---------------------------------------------------------------------------
// 6. Query answer (chat hub, step 2: answer from retrieved pages)
// ---------------------------------------------------------------------------

export function buildAnswerMessages(opts: {
  schema: string;
  contextPages: { slug: string; content: string }[];
  history: ChatMessage[];
  language: string;
}): ChatMessage[] {
  const context =
    opts.contextPages.length > 0
      ? opts.contextPages.map((p) => `===== PAGE: [[${p.slug}]] =====\n${p.content}`).join("\n\n")
      : "(no wiki pages retrieved — the knowledge base may be empty or the question may be out of scope)";

  const system = `You are the query interface of a research-paper wiki knowledge base. Answer the user's research question using ONLY the wiki pages provided below as sources.

Wiki conventions (from SCHEMA.md):
${opts.schema}

Rules:
- Write in language "${opts.language}".
- Ground every claim in the provided pages and cite with [[paper-slug]] or [[topic-slug]] wikilinks — the UI renders them as clickable links to the source.
- If the pages don't contain the answer, say so plainly; never hallucinate content that isn't in the knowledge base.
- Note contradictions between sources explicitly when relevant.
- Reading notes/comments are NOT part of the knowledge base; never reference them.`;

  return [
    { role: "system", content: system },
    { role: "user", content: `RETRIEVED WIKI PAGES:\n\n${context}` },
    ...opts.history,
  ];
}

// ---------------------------------------------------------------------------
// 7. Relation finalize (end-of-run: re-map typed relations against the FULL
//    final index — the analyze pass saw only the pre-run index)
// ---------------------------------------------------------------------------


export function relationFinalizePrompt(opts: {
  title: string;
  seedRelations: { relation: string; slug: string; note: string }[];
  index: string;
  language: string;
}): { system: string; user: string } {
  const seed =
    opts.seedRelations.length > 0
      ? opts.seedRelations
          .map((r) => `- **${r.relation}** [[${r.slug}]] — ${r.note}`)
          .join("\n")
      : "(none)";

  const system = `You are the maintainer of a research-paper wiki. You verify and complete the typed relations of ONE paper against the COMPLETE final wiki index.
Rules:
- "relation" must be exactly one of: "builds-on", "extends", "supersedes", "contradicts", "impacts".
- "slug" may ONLY reference papers from the WIKI INDEX provided. Never invent slugs. Never reference the paper itself.
- Start from the SEED RELATIONS (extracted when the index was partial). Keep every seed that is still accurate; correct or drop seeds that are wrong; ADD relations to papers the seed pass could not see (compiled later in the same run).
- "builds-on" = this paper builds directly on the target; "extends" = generalizes the target's approach; "supersedes" = replaces/surpasses the target; "contradicts" = findings conflict with the target; "impacts" = relevant cross-topic influence.
- Notes: under 200 characters, precise, in language "${opts.language}".
- Respond with JSON only: { "relations": [ { "relation": string, "slug": string, "note": string } ] }`;

  return {
    system,
    user: `PAPER TITLE: ${opts.title}

SEED RELATIONS (from the analysis pass against a partial index):
${seed}

COMPLETE WIKI INDEX (all compiled papers):
${opts.index || "(empty — no papers yet)"}`,
  };
}
