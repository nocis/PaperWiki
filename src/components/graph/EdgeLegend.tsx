"use client";

import { RELATION_STYLE } from "./types";

/** Topic color dots, edge-class legend, and interaction help. */
export function EdgeLegend({ colorByGroup }: { colorByGroup: Map<string, string> }) {
  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        {[...colorByGroup.entries()].map(([group, color]) => (
          <span key={group} className="flex items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1 text-xs text-gray-600">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
            {group}
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5" style={{ backgroundColor: "#9ca3af" }} /> citation (citing → cited)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5" style={{ backgroundColor: RELATION_STYLE.temporal.stroke }} /> temporal relation
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5" style={{ backgroundColor: RELATION_STYLE.contradicts.stroke }} /> contradicts
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5" style={{ borderTop: `2px dashed ${RELATION_STYLE.impacts.stroke}` }} /> cross-topic impact
        </span>
      </div>
      <p className="mt-3 text-xs text-gray-400">
        Nodes are compiled papers (colored by topic). Solid arrows are citations (citing → cited); colored
        arrows are LLM-typed relations (source → target). Filter edges by category; hover a node to highlight
        its neighborhood, click a node to pin the highlight and open details (click again, the ✕, or empty
        graph space to release), hover an edge for its note. Scroll the graph when it outgrows the viewport.
      </p>
    </>
  );
}
