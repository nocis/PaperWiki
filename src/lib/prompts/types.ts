/**
 * LLM response schemas for the wiki pipeline prompts.
 *
 * Types only — the prompt builders and policy constants live in prompts.ts.
 */

export interface DeepAnalysis {
  authors: string[];
  venue: string;
  publishedAt: string; // YYYY-MM or ""
  contributions: string[];
  /** Contrastive: prior = the field's received view; update = what this paper changes. */
  novelInsight: { prior: string; update: string };
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

export interface PaperMergedResponse extends DeepAnalysis {
  classification: Classification;
}

export interface TitleEssence {
  title: string;
  essence: string;
}

export interface DedupScreen {
  /** Slug of the paper the incoming IS a duplicate of, or null when not a duplicate. */
  slug: string | null;
  /** 0-1 same-document confidence. 0 when nothing resembles. */
  score: number;
}

export interface TopicMergePair {
  slugA: string;
  slugB: string;
  reason: string;
}

export interface TopicKeyProperty {
  /** Short phrase (<= ~12 words) — the card title. */
  headline: string;
  /** One sentence (<= ~200 chars) expanding the headline. */
  detail: string;
  /** Paper slugs (from the synthesis SOURCES) supporting this property. */
  sources: string[];
}

export interface TopicSynthesis {
  definition: string;
  keyProperties: TopicKeyProperty[];
  chronologicalEvolution: string | null;
  subtopicNotes: Record<string, { definition: string; keyProperties: TopicKeyProperty[] }>;
}

export interface QueryRetrieval {
  pages: string[];
  papers: string[];
}

export interface CitationMapResponse {
  citations: {
    /** 1-based position of the entry in the numbered reference list. */
    entry: number;
    matchedSlug: string;
  }[];
}

export interface KnowledgeClusterArticle {
  slug: string;
  title: string;
  definition: string;
  pieceSlugs: string[];
  paperSlugs: string[];
  /** Code-side, overlap-derived after the cluster response is validated. */
  relatedArticleSlugs?: string[];
}

export interface KnowledgeClusterResponse {
  articles: KnowledgeClusterArticle[];
}

export interface KnowledgeArticleResponse {
  definition: string;
  /** Markdown body of the ## Synthesis section — claims cite [[piece-slug]]. */
  synthesis: string;
  /** Evidence mapping of the article's claims against wiki papers. */
  grounding: { slug: string; status: "supports" | "contradicts" | "unaddressed"; note: string }[];
  novelty: string;
  critique: string;
  limitations: string;
  frontier: string;
}

export interface RelationFinalizeResponse {
  relations: { relation: string; slug: string; note: string }[];
}

// ---------------------------------------------------------------------------
// Paper Knowledge (the structured research-pickup block, extracted by a second
// deep pass over the full paper text, seeded by the compile facts).
// ---------------------------------------------------------------------------

/** Rendering route for a diagram: mermaid (cheap, simple flows) or svg.js (math/custom). */
export type DiagramFormat = "mermaid" | "svg";

export interface PaperKnowledgeDiagramBrief {
  /** Short slug identifying the diagram (e.g. "overview", "mechanism", "formula-1"). */
  id: string;
  /** Paper Knowledge H3 the diagram lives under (one of PAPER_KNOWLEDGE_SECTIONS). */
  section: string;
  /** Short human heading shown above the diagram (at most ~6 words). */
  title: string;
  /**
   * Text description — NOT raw SVG; an on-demand LLM call renders it later
   * (via svg.js backend code or Mermaid source). Also doubles as the "How to
   * read this diagram" caption, so it must describe the diagram in
   * reader-facing terms.
   */
  brief: string;
  /**
   * Positional anchor inside the section: the `####` subsection heading
   * (e.g. "Formula 2"), a concept term, a QA question, or an exact content
   * fragment the diagram belongs right after. Omit to place at section end.
   */
  location?: string;
  /** Rendering route chosen by the planner. */
  format: DiagramFormat;
}

/**
 * Output of the dedicated diagram-planning pass (phase 2 of the Paper
 * Knowledge amend): which sections need a diagram, and how to draw it.
 */
export interface PaperDiagramPlan {
  diagrams: PaperKnowledgeDiagramBrief[];
}

/** Per-figure context captured at extraction time (scripts/extract_figures.py). */
export interface PaperKnowledgeFigureContext {
  file: string;
  page: number;
  caption: string;
  context: string;
  kind: string;
  url: string;
}

/** A curated figure placement inside the Paper Knowledge block. */
export interface PaperKnowledgeFigure {
  file: string;
  /** One of the Paper Knowledge H3 section names (see PAPER_KNOWLEDGE_SECTIONS). */
  section: string;
  caption: string;
}

export interface PaperKnowledgeConcept {
  /** English term with an operational "how to understand it" meaning. */
  term: string;
  definition: string;
  problem_solved: string;
  relationship: string;
}

export interface PaperKnowledgeFormulaVariable {
  symbol: string;
  meaning: string; // includes whether larger/smaller is better, or an intermediate cost
}

export interface PaperKnowledgeFormula {
  /** LaTeX representation of the core formula. */
  formula: string;
  question_answered: string;
  variables: PaperKnowledgeFormulaVariable[];
  intuition: string;
}

export interface PaperKnowledge {
  research_purpose: { target: string; old_bottleneck: string; usable_benefit: string };
  /** LLM-chosen diagram briefs: which sections get a diagram, and how to draw it. */
  diagrams: PaperKnowledgeDiagramBrief[];
  key_actions: string[];
  core_concepts: PaperKnowledgeConcept[];
  mechanism_chain: { explanation: string };
  core_formulas: PaperKnowledgeFormula[];
  comprehensive_qa: { question: string; answer: string }[];
  boundaries_and_debt: { evidence_chain: string; technical_debt: string; boundaries: string };
  /** Curated figure placements (empty = no figure is worth showing inline). */
  figures: PaperKnowledgeFigure[];
}
