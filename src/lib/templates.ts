/**
 * Deterministic markdown renderers for wiki pages.
 * The LLM supplies structured content; code owns the page format (see wiki/SCHEMA.md).
 */
import { figureLabel } from "./extract-figures";
import { renderCitationsSection, type CitationRecord } from "./citations";
import type { PaperFrontmatter, TopicFrontmatter } from "./wiki";

export interface PaperBodyInput {
  essence: string;
  contributions: string[];
  novelInsight: string;
  limitations: string;
  frontier: string;
  relationsContext: string;
  relations: { relation: string; slug: string; note: string }[];
  /** Raw bibliography (displayed verbatim) + resolved matches (link markers). */
  citations: { rawReferences: string[]; matches: CitationRecord[] };
  /** Topic slug used in the ## Feeds section. */
  milestoneAnchor: string;
  /** Extracted figures (file + absolute web URL). */
  figures?: { file: string; url: string }[];
}

export function renderPaperBody(input: PaperBodyInput): string {
  const relations =
    input.relations.length > 0
      ? input.relations.map((r) => `- **${r.relation}** [[${r.slug}]] — ${r.note}`).join("\n")
      : "_No relations to existing wiki papers detected._";

  const figures =
    input.figures && input.figures.length > 0
      ? `## Figures\n${input.figures.map((f) => `![${figureLabel(f.file)}](${f.url})`).join("\n")}`
      : "";

  return `
## Essence
${input.essence}

## Contributions
${input.contributions.map((c) => `- ${c}`).join("\n")}

${figures}

## Critical Analysis
**Novel Insight**: ${input.novelInsight}

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

export interface TopicBodyInput {
  fm: TopicFrontmatter;
  definitionProse: string;
  keyProperties: string[];
  /** Sources of this topic, for the Source Cluster section. */
  sources: { slug: string; title: string; venue: string; publishedAt: string; subtopic: string | null }[];
  chronologicalEvolution: string | null;
  /** Merged-parent mode: per-subtopic notes keyed by subtopic slug. */
  subtopicNotes: Record<string, { definition: string; keyProperties: string[] }>;
}

export function renderTopicBody(input: TopicBodyInput): string {
  const parts: string[] = [];

  parts.push(`## Definition\n${input.definitionProse}`);

  parts.push(
    `## Key Properties\n${input.keyProperties.map((k) => `- ${k}`).join("\n") || "_None yet._"}`
  );

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
      const lines = [`### ${sub}`, ""];
      if (notes?.definition) lines.push(`> ${notes.definition}`, "");
      for (const prop of notes?.keyProperties ?? []) lines.push(`- ${prop}`);
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
// Knowledge topic articles (derived — Knowledge Compile only)
// ---------------------------------------------------------------------------

export interface KnowledgeArticleBodyInput {
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
