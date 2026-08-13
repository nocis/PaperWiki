/**
 * Deterministic markdown renderers for wiki pages.
 * The LLM supplies structured content; code owns the page format (see wiki/SCHEMA.md).
 */
import { renderCitationsSection, type CitationRecord } from "./citations";
import type { PaperKnowledge, PaperKnowledgeFigure, TopicKeyProperty } from "./prompts";
import type { PaperFrontmatter, PaperRelation, TopicFrontmatter } from "./wiki";

function renderRelationsLines(relations: PaperRelation[]): string {
  return relations.length > 0
    ? relations.map((r) => `- **${r.relation}** [[${r.slug}]] — ${r.note}`).join("\n")
    : "_No relations to existing wiki papers detected._";
}

/**
 * Replace only the relation bullet lines inside a paper body's ## Relations
 * section (the relationsContext prose is kept). Used by the end-of-run
 * relation finalize pass.
 */
export function patchRelationsBlock(body: string, relations: PaperRelation[]): string {
  const start = body.indexOf("## Relations");
  if (start === -1) return body;
  const end = body.indexOf("\n## Citations", start);
  const sectionEnd = end === -1 ? body.length : end;
  const block = body.slice(start, sectionEnd);
  const firstBullet = /(?:^|\n)- \*\*[^*\n]+\*\* \[\[[a-z0-9][a-z0-9-]*\]\]/.exec(block);
  const prose = (firstBullet ? block.slice(0, firstBullet.index) : block).trimEnd();
  const lines = renderRelationsLines(relations);
  const newBlock = prose ? `${prose}\n\n${lines}` : lines;
  return `${body.slice(0, start)}${newBlock}${body.slice(sectionEnd)}`;
}

interface PaperBodyInput {
  essence: string;
  contributions: string[];
  /** Contrastive pair (new format) or plain prose (legacy pages). */
  novelInsight: string | { prior: string; update: string };
  limitations: string;
  frontier: string;
  relationsContext: string;
  relations: PaperRelation[];
  /** Raw bibliography (displayed verbatim) + resolved matches (link markers). */
  citations: { rawReferences: string[]; matches: CitationRecord[] };
  /** Topic slug used in the ## Feeds section. */
  milestoneAnchor: string;
}

export function renderPaperBody(input: PaperBodyInput): string {
  const relations = renderRelationsLines(input.relations);

  const novelInsight =
    typeof input.novelInsight === "string"
      ? input.novelInsight
      : `*prior:* ${input.novelInsight.prior} / *update:* ${input.novelInsight.update}`;

  return `
## Essence
${input.essence}

## Contributions
${input.contributions.map((c) => `- ${c}`).join("\n")}

## Critical Analysis
**Novel Insight**: ${novelInsight}

**Fundamental Limitations**: ${input.limitations}

**Research Frontier**: ${input.frontier}

## Relations
${input.relationsContext}

${relations}

${renderCitationsSection(input.citations.rawReferences, input.citations.matches)}

## Feeds
milestone: [[${input.milestoneAnchor}]]
`;
}

interface TopicBodyInput {
  fm: TopicFrontmatter;
  definitionProse: string;
  keyProperties: TopicKeyProperty[];
  /** Sources of this topic, for the Source Cluster section. */
  sources: { slug: string; title: string; venue: string; publishedAt: string; subtopic: string | null }[];
  chronologicalEvolution: string | null;
  /** Merged-parent mode: per-subtopic notes keyed by subtopic slug. */
  subtopicNotes: Record<string, { definition: string; keyProperties: TopicKeyProperty[] }>;
}

/** One titled-card property: `### headline` + detail + source links. */
function renderKeyProperty(prop: TopicKeyProperty, headingLevel: "###" | "####"): string {
  const sourceLine =
    (prop.sources?.length ?? 0) > 0
      ? `*${prop.sources.length === 1 ? "Source" : "Sources"}: ${prop.sources.map((s) => `[[${s}]]`).join(", ")}*`
      : "";
  return [`${headingLevel} ${prop.headline}`, prop.detail, sourceLine].filter(Boolean).join("\n");
}

/**
 * Coerce LLM-provided key properties into titled-card shape. Accepts the card
 * object form, a bare string (the pre-card legacy bullet shape), or a partial
 * object — never throws, so a non-compliant synthesis cannot fail the compile.
 */
export function normalizeKeyProperties(raw: unknown): TopicKeyProperty[] {
  if (!Array.isArray(raw)) return [];
  const cards: TopicKeyProperty[] = [];
  for (const p of raw) {
    if (typeof p === "string") {
      if (p.trim()) cards.push({ headline: p.trim().slice(0, 120), detail: "", sources: [] });
    } else if (p && typeof p === "object" && !Array.isArray(p)) {
      const card = p as Partial<TopicKeyProperty>;
      const headline = typeof card.headline === "string" ? card.headline.trim() : "";
      if (!headline) continue;
      cards.push({
        headline: headline.slice(0, 120),
        detail: typeof card.detail === "string" ? card.detail : "",
        sources: Array.isArray(card.sources) ? card.sources.filter((s): s is string => typeof s === "string") : [],
      });
    }
  }
  return cards;
}

/** Coerce per-subtopic notes ({definition, keyProperties}) — never throws. */
export function normalizeSubtopicNotes(
  raw: unknown
): Record<string, { definition: string; keyProperties: TopicKeyProperty[] }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, { definition: string; keyProperties: TopicKeyProperty[] }> = {};
  for (const [slug, note] of Object.entries(raw)) {
    if (!note || typeof note !== "object" || Array.isArray(note)) continue;
    const n = note as { definition?: unknown; keyProperties?: unknown };
    out[slug] = {
      definition: typeof n.definition === "string" ? n.definition : "",
      keyProperties: normalizeKeyProperties(n.keyProperties),
    };
  }
  return out;
}

export function renderTopicBody(input: TopicBodyInput): string {
  const parts: string[] = [];

  parts.push(`## Definition\n${input.definitionProse}`);

  const props =
    input.keyProperties.length > 0
      ? input.keyProperties.map((p) => renderKeyProperty(p, "###")).join("\n\n")
      : "_None yet._";
  parts.push(`## Key Properties\n${props}`);

  const cluster =
    input.sources.length > 0
      ? input.sources
          .map(
            (s) =>
              `- [[${s.slug}]] — "${s.title}" (${s.venue}, ${s.publishedAt})${s.subtopic ? ` · subtopic: ${s.subtopic}` : ""}`
          )
          .join("\n")
      : "_No sources yet._";
  parts.push(`## Source Cluster\n${cluster}`);

  if (input.fm.mode === "merged" && input.fm.subtopics.length > 0) {
    const sections = input.fm.subtopics.map((sub) => {
      const notes = input.subtopicNotes[sub];
      const lines = [`### ${sub}`];
      if (notes?.definition) lines.push(`> ${notes.definition}`);
      for (const prop of notes?.keyProperties ?? []) {
        lines.push(renderKeyProperty(prop, "####"));
      }
      return lines.join("\n").trim();
    });
    parts.push(`## Subtopics\n${sections.join("\n\n")}`);
  }

  if (input.chronologicalEvolution) {
    parts.push(`## Chronological Evolution\n${input.chronologicalEvolution}`);
  }

  parts.push(`## Open Questions\n_None recorded._`);

  return parts.join("\n\n") + "\n";
}

export type { PaperFrontmatter, TopicFrontmatter };

// ---------------------------------------------------------------------------
// Paper Knowledge block (the structured research-pickup section appended to a
// compiled Paper page by the post-run Paper Knowledge amend). The block is one
// anchored, fully strippable section — its presence marks the paper as
// "knowledge ready" (terminal: never regenerated except by recompile).
// ---------------------------------------------------------------------------

/** A text-brief diagram fence emitted by the template and rendered lazily. */
export function renderDiagramFence(id: string, brief: string): string {
  return `\`\`\`diagram ${id}\n${brief.trim()}\n\`\`\``;
}

/**
 * Remove one `## <title>` section (its heading through the next `## ` heading)
 * from a markdown body. Everything before AND after the section is preserved —
 * stripping must never truncate the rest of the paper. Returns the body
 * unchanged when the section is absent.
 */
function stripH2Section(body: string, title: string): string {
  const start = body.search(new RegExp(`^## ${title}\\s*$`, "m"));
  if (start === -1) return body;
  const rest = body.slice(start + 1);
  const nextHeading = rest.search(/^## /m);
  const end = nextHeading === -1 ? body.length : start + 1 + nextHeading;
  const before = body.slice(0, start).trimEnd();
  const after = body.slice(end).trimStart();
  if (!before && !after) return "";
  return before ? `${before}\n\n${after}` : after;
}

/** Remove the whole `## Paper Knowledge` section from a paper body (if any). */
export function stripPaperKnowledgeBlock(body: string): string {
  return stripH2Section(body, "Paper Knowledge");
}

/**
 * Remove the classic `## Figures` pile. The wiki body no longer has a figure
 * pile — figures appear only where the Paper Knowledge amend curates them
 * inline (the full gallery lives in the paper route's Figures tab).
 */
export function stripFiguresSection(body: string): string {
  return stripH2Section(body, "Figures");
}

/**
 * A curated figure embed. The caption lives in the image ALT text (rendered by
 * the wiki reader as a figure + math-capable figcaption), so only markdown-
 * breaking characters are sanitized — $...$ LaTeX is preserved intact.
 */
function figureMarkdown(slug: string, figure: PaperKnowledgeFigure): string {
  const alt = figure.caption.replace(/\]/g, " ").replace(/\s+/g, " ").trim();
  return `![${alt}](/figures/${slug}/${figure.file})`;
}

/** The H3 section names of a Paper Knowledge block, in render order. */
export const PAPER_KNOWLEDGE_SECTIONS = [
  "Research Purpose",
  "Overview",
  "Key Actions",
  "Core Concepts",
  "Mechanism",
  "Core Formulas",
  "Deep Dive",
  "Boundaries & Technical Debt",
] as const;

export function renderPaperKnowledgeBlock(knowledge: PaperKnowledge, slug: string): string {
  const purpose = knowledge.research_purpose;
  const figuresBySection = new Map<string, PaperKnowledgeFigure[]>();
  for (const figure of knowledge.figures ?? []) {
    const list = figuresBySection.get(figure.section) ?? [];
    list.push(figure);
    figuresBySection.set(figure.section, list);
  }

  const sections = new Map<string, string[]>();
  const section = (heading: string, lines: string[]): void => {
    sections.set(heading, lines);
  };

  section("Research Purpose", [
    `**Target**: ${purpose.target}`,
    `**Bottleneck**: ${purpose.old_bottleneck}`,
    `**Usable benefit**: ${purpose.usable_benefit}`,
  ]);
  if (knowledge.overview_diagram) {
    section("Overview", [renderDiagramFence(knowledge.overview_diagram.id, knowledge.overview_diagram.brief)]);
  }
  section("Key Actions", knowledge.key_actions.map((a) => `- ${a}`));
  if (knowledge.core_concepts.length > 0) {
    section(
      "Core Concepts",
      knowledge.core_concepts.flatMap((c) => [
        `#### ${c.term}`,
        `- **Definition**: ${c.definition}`,
        `- **Problem it solves**: ${c.problem_solved}`,
        `- **Connection**: ${c.relationship}`,
      ])
    );
  }
  const mechanismLines = [knowledge.mechanism_chain.explanation];
  if (knowledge.mechanism_chain.diagram) {
    mechanismLines.push(renderDiagramFence(knowledge.mechanism_chain.diagram.id, knowledge.mechanism_chain.diagram.brief));
  }
  section("Mechanism", mechanismLines);
  if (knowledge.core_formulas.length > 0) {
    const formulaLines: string[] = [];
    knowledge.core_formulas.forEach((f, i) => {
      formulaLines.push(`#### Formula ${i + 1}`);
      formulaLines.push("**Formula**:");
      formulaLines.push(`$$${f.formula}$$`);
      formulaLines.push(`**What it calculates**: ${f.question_answered}`);
      if (f.variables.length > 0) {
        formulaLines.push("**Variables**:");
        formulaLines.push(...f.variables.map((v) => `- $${v.symbol}$ — ${v.meaning}`));
      }
      formulaLines.push(`**Intuition**: ${f.intuition}`);
    });
    section("Core Formulas", formulaLines);
  }
  if (knowledge.comprehensive_qa.length > 0) {
    section(
      "Deep Dive",
      knowledge.comprehensive_qa.flatMap((qa) => [`#### ${qa.question}`, qa.answer])
    );
  }
  const b = knowledge.boundaries_and_debt;
  section("Boundaries & Technical Debt", [
    "#### Evidence chain",
    b.evidence_chain,
    "#### Technical debt",
    b.technical_debt,
    "#### Boundaries",
    b.boundaries,
  ]);

  const parts: string[] = ["## Paper Knowledge"];
  for (const heading of PAPER_KNOWLEDGE_SECTIONS) {
    const lines = sections.get(heading) ?? [];
    const figures = figuresBySection.get(heading) ?? [];
    if (lines.length === 0 && figures.length === 0) continue;
    parts.push("", `### ${heading}`, "");
    if (lines.length > 0) parts.push(lines.join("\n"));
    for (const figure of figures) {
      parts.push("", figureMarkdown(slug, figure));
    }
  }

  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * Strip any existing Paper Knowledge block and ## Figures pile, then write the
 * fresh block between `## Contributions` and `## Critical Analysis` (falling
 * back to append when the anchor is missing).
 */
export function patchPaperKnowledgeBlock(body: string, slug: string, knowledge: PaperKnowledge): string {
  const stripped = stripPaperKnowledgeBlock(stripFiguresSection(body));
  const block = renderPaperKnowledgeBlock(knowledge, slug);
  const anchor = stripped.search(/^## Critical Analysis\s*$/m);
  if (anchor === -1) return `${stripped.trimEnd()}\n\n${block.trimEnd()}\n`;
  const before = stripped.slice(0, anchor).trimEnd();
  const after = stripped.slice(anchor).trimStart();
  return `${before}\n\n${block.trimEnd()}\n\n${after}`;
}

// ---------------------------------------------------------------------------
// Knowledge topic articles (derived — Knowledge Compile only)
// ---------------------------------------------------------------------------

interface KnowledgeArticleBodyInput {
  definition: string;
  synthesis: string;
  grounding: { slug: string; status: "supports" | "contradicts" | "unaddressed"; note: string }[];
  novelty: string;
  critique: string;
  limitations: string;
  frontier: string;
  relatedArticles: string[];
}

export function renderKnowledgeArticleBody(input: KnowledgeArticleBodyInput): string {
  const statusLabel: Record<KnowledgeArticleBodyInput["grounding"][number]["status"], string> = {
    supports: "Supports",
    contradicts: "Contradicts",
    unaddressed: "Unaddressed",
  };
  const grounding =
    input.grounding.length > 0
      ? input.grounding.map((g) => `- **${statusLabel[g.status]}** [[${g.slug}]] — ${g.note}`).join("\n")
      : "_No wiki papers mapped yet._";
  const related =
    input.relatedArticles.length > 0
      ? input.relatedArticles.map((slug) => `- [[${slug}]]`).join("\n")
      : "_None._";

  return `
## Definition
${input.definition}

## Synthesis
${input.synthesis}

## Wiki Grounding
${grounding}

## Academic Review
**Novelty Assessment**: ${input.novelty}

**Critique**: ${input.critique}

**Limitations**: ${input.limitations}

**Research Frontier**: ${input.frontier}

## Related Articles
${related}
`;
}
