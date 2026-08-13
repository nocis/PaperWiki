"use client";

export interface GraphNode {
  id: string;
  label: string;
  group: string;
}

export interface GraphLink {
  source: string;
  target: string;
  /** Raw bibliography entry text behind a citation edge (tooltip). */
  ref?: string;
}

/** Typed relation edge classes: temporal / contradicts / cross-topic impacts. */
export interface GraphRelationLink {
  source: string;
  target: string;
  kind: "temporal" | "contradicts" | "impacts";
  note?: string;
}

/** Info-panel payload for a paper node (derived from DbPaper). */
export interface GraphPaperInfo {
  slug: string;
  title: string;
  publishedAt: string;
  essence: string;
  milestone: string;
}

export type EdgeFilter = "all" | "cite" | "temporal" | "contradicts" | "impacts";

export const RELATION_STYLE: Record<GraphRelationLink["kind"], { stroke: string; width: number; dash?: string }> = {
  temporal: { stroke: "#2563eb", width: 1.4 },
  contradicts: { stroke: "#dc2626", width: 1.6 },
  impacts: { stroke: "#6b7280", width: 1.4, dash: "4 4" },
};

export const RELATION_LABEL: Record<GraphRelationLink["kind"], string> = {
  temporal: "temporal relation",
  contradicts: "contradicts",
  impacts: "cross-topic impact",
};

export const PALETTE = [
  "#2563eb",
  "#059669",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#ea580c",
  "#4f46e5",
];
