/**
 * Deterministic markdown renderers for wiki pages.
 * The LLM supplies structured content; code owns the page format (see wiki/SCHEMA.md).
 */
import type { PaperFrontmatter, TopicFrontmatter } from "./wiki";

export interface PaperBodyInput {
  essence: string;
  contributions: string[];
  novelInsight: string;
  limitations: string;
  frontier: string;
  relationsContext: string;
  relations: { relation: string; slug: string; note: string }[];
  references: { raw: string; slug: string | null }[];
  /** Topic slug used in the ## Feeds section. */
  milestoneAnchor: string;
}

export function renderPaperBody(input: PaperBodyInput): string {
  const relations =
    input.relations.length > 0
      ? input.relations.map((r) => `- **${r.relation}** [[${r.slug}]] — ${r.note}`).join("\n")
      : "_No relations to existing wiki papers detected._";

  const references =
    input.references.length > 0
      ? input.references
          .map((r, i) => `${i + 1}. ${r.raw}${r.slug ? ` → [[${r.slug}]]` : ""}`)
          .join("\n")
      : "_No references extracted._";

  return `
## Essence
${input.essence}

## Contributions
${input.contributions.map((c) => `- ${c}`).join("\n")}

## Critical Analysis
**Novel Insight**: ${input.novelInsight}

**Fundamental Limitations**: ${input.limitations}

**Research Frontier**: ${input.frontier}

## Relations
${input.relationsContext}

${relations}

## References
${references}

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
