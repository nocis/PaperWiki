/**
 * Structured prompt wrappers for the LLM wiki pipeline.
 * Distilled from the AutoWiki skill's ingest workflow and adapted to a
 * batch compiler + web chat hub (no Obsidian, JSON responses, slug-based links).
 */
import type { ChatMessage } from "./llm";

// ---------------------------------------------------------------------------
// 1. Paper analysis (Ingest Phase 1)
// ---------------------------------------------------------------------------

export interface PaperAnalysis {
  title: string;
  authors: string[];
  venue: string;
  publishedAt: string; // YYYY-MM or ""
  essence: string;
  contributions: string[];
  novelInsight: string;
  limitations: string;
  researchFrontier: string;
  references: string[];
  predecessors: { slug: string; relation: string; note: string }[];
  evolutionaryChain: { role: "origin" | "intermediate" | "terminal" | "fork"; note: string };
  crossDomainOrigin: string | null;
  crossTopicImpacts: { slug: string; note: string }[];
  contradictions: { slug: string; note: string }[];
  relationsContext: string;
}

export function paperAnalysisPrompt(opts: {
  text: string;
  metaTitle: string | null;
  kbIndex: string;
  language: string;
}): { system: string; user: string } {
  const system = `You are the maintainer of a research-paper wiki knowledge base. You analyze ONE new paper and return a strict JSON object.

Rules:
- Respond with JSON only. No prose outside the JSON object.
- Write all prose fields in language "${opts.language}".
- "predecessors", "crossTopicImpacts" and "contradictions" may ONLY reference paper slugs from the EXISTING WIKI INDEX provided by the user. Never invent slugs. If none apply, use empty arrays.
- Derive contributions from the delta between the field's prior art (the paper's own related work) and what the paper adds — never state them as isolated claims.
- essence: 3 sentences max (scope, method, insight).
- references: the paper's bibliography entries as raw strings, best-effort, max 50.
- evolutionaryChain.role: "origin" (starts a new line of work), "intermediate" (builds on predecessors), "terminal" (closes/supersedes a line), or "fork" (splits a line).
- relationsContext: one short paragraph positioning the paper in the field's timeline (its predecessors, what it supersedes or contradicts).`;

  const user = `EXISTING WIKI INDEX (papers you may reference by slug):
${opts.kbIndex || "(empty — this is one of the first papers)"}

PDF metadata title: ${opts.metaTitle ?? "(none)"}

PAPER TEXT (extracted, possibly truncated):
${opts.text}

Return JSON with exactly these fields:
{
  "title": string,
  "authors": string[],
  "venue": string,
  "publishedAt": "YYYY-MM or empty string",
  "essence": string,
  "contributions": string[],
  "novelInsight": string,
  "limitations": string,
  "researchFrontier": string,
  "references": string[],
  "predecessors": [{ "slug": string, "relation": "builds-on|extends|supersedes", "note": string }],
  "evolutionaryChain": { "role": "origin|intermediate|terminal|fork", "note": string },
  "crossDomainOrigin": string | null,
  "crossTopicImpacts": [{ "slug": string, "note": string }],
  "contradictions": [{ "slug": string, "note": string }],
  "relationsContext": string
}`;

  return { system, user };
}

// ---------------------------------------------------------------------------
// 2. Milestone classification (Ingest Phase 1, step 6 — with fitness check)
// ---------------------------------------------------------------------------

export interface Classification {
  action: "assign" | "create";
  topicSlug?: string;
  subtopicSlug?: string | null;
  topic?: {
    slug: string;
    name: string;
    definition: string;
    parentSlug: string | null;
    tags: string[];
  };
  reason: string;
}

export function milestoneClassifyPrompt(opts: {
  title: string;
  essence: string;
  contributions: string[];
  topicTree: string;
  language: string;
}): { system: string; user: string } {
  const system = `You are the maintainer of a research-paper wiki. You assign ONE new paper to a milestone topic, or create a new topic. Return strict JSON only.

CLASSIFICATION FITNESS CHECK (mandatory):
- The paper's core research question must genuinely fall within the topic's milestone definition.
- Shared keywords do NOT imply shared research questions. (A paper about general LLM jailbreaking does NOT fit an "agent safety" topic just because both involve "safety".)
- If no existing topic is a genuine conceptual match, CREATE a new standalone topic. Misclassification is worse than a small new topic.

Rules:
- Topic tree has max depth 3. A "create" with parentSlug is only allowed if the parent is at depth <= 2.
- Prefer assigning to an existing genuine fit over creating a near-duplicate topic.
- If a merged-parent topic (mode "merged") has a matching subtopic, assign with subtopicSlug set.
- New topic slugs: kebab-case, short, conceptual (e.g. "self-evolving-memory-architectures").
- Write definition and name in language "${opts.language}".`;

  const user = `NEW PAPER:
Title: ${opts.title}
Essence: ${opts.essence}
Contributions:
${opts.contributions.map((c) => `- ${c}`).join("\n")}

EXISTING TOPIC TREE (slug — definition [mode, subtopics]):
${opts.topicTree || "(empty — no topics yet)"}

Return JSON with exactly one of these shapes:
{ "action": "assign", "topicSlug": string, "subtopicSlug": string | null, "reason": string }
{ "action": "create", "topic": { "slug": string, "name": string, "definition": string, "parentSlug": string | null, "tags": string[] }, "reason": string }`;

  return { system, user };
}

// ---------------------------------------------------------------------------
// 3. Topic synthesis (Ingest Phase 4 — the compounding step)
// ---------------------------------------------------------------------------

export interface TopicSynthesis {
  definition: string;
  keyProperties: string[];
  chronologicalEvolution: string | null;
  subtopicNotes: Record<string, { definition: string; keyProperties: string[] }>;
}

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
// 4. Query retrieval (chat hub, step 1: read the index, pick pages)
// ---------------------------------------------------------------------------

export interface QueryRetrieval {
  pages: string[];
  papers: string[];
}

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
// 5. Query answer (chat hub, step 2: answer from retrieved pages)
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
