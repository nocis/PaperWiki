"use client";

import type { CitationCoverageRow } from "@/lib/citations";
import type { CitationsRunSnapshot } from "@/lib/runs";

interface HealthIssue {
  severity: "error" | "warning";
  kind: string;
  target?: string;
  message: string;
  autoFixable: boolean;
}

export interface HealthReport {
  generatedAt: string;
  errors: number;
  warnings: number;
  ok: boolean;
  issues: HealthIssue[];
  fixed?: HealthIssue[];
  proposalsAdded?: number;
}

export type View = "report" | "running" | "applied";

export interface CitationsResponse {
  status: CitationsRunSnapshot | null;
  coverage: {
    summary: {
      papers: number;
      withMap: number;
      missingMap: number;
      citations: number;
      matched: number;
      unlinked: number;
    };
    rows: CitationCoverageRow[];
  };
}
