"use client";

import { useForceGraph } from "./graph/useForceGraph";
import { GraphCanvas } from "./graph/GraphCanvas";
import { GraphFilters } from "./graph/GraphFilters";
import { NodeInfoPanel } from "./graph/NodeInfoPanel";
import { EdgeLegend } from "./graph/EdgeLegend";
import type { GraphLink, GraphNode, GraphPaperInfo, GraphRelationLink } from "./graph/types";

export type { GraphNode, GraphLink, GraphRelationLink, GraphPaperInfo } from "./graph/types";

export default function CitationGraph({
  nodes,
  links,
  relationLinks,
  papers = [],
}: {
  nodes: GraphNode[];
  links: GraphLink[];
  relationLinks: GraphRelationLink[];
  papers?: GraphPaperInfo[];
}) {
  const {
    positions,
    filter,
    setFilter,
    highlightId,
    selectedId,
    canvas,
    colorByGroup,
    degreeById,
    counts,
    visibleLinks,
    visibleRelations,
    neighborsOf,
    selectedPaper,
    selectedRelations,
    selectedCitations,
    edgeTip,
    setEdgeTip,
    selectNode,
    clearSelection,
    setHoveredId,
  } = useForceGraph(nodes, links, relationLinks, papers);

  if (!positions) {
    return <div className="flex h-[600px] items-center justify-center text-sm text-gray-500">Laying out citation graph…</div>;
  }

  return (
    <div>
      <GraphFilters
        filter={filter}
        counts={counts}
        total={links.length + relationLinks.length}
        onFilter={setFilter}
      />

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="max-h-[80vh] overflow-auto rounded-lg border border-gray-200 bg-white lg:flex-1">
          <GraphCanvas
            positions={positions}
            nodes={nodes}
            visibleLinks={visibleLinks}
            visibleRelations={visibleRelations}
            highlightId={highlightId}
            selectedId={selectedId}
            colorByGroup={colorByGroup}
            degreeById={degreeById}
            neighborsOf={neighborsOf}
            canvas={canvas}
            onNodeSelect={selectNode}
            onNodeHover={setHoveredId}
            onBackgroundClick={() => clearSelection(true)}
            setEdgeTip={setEdgeTip}
          />
        </div>

        {selectedPaper && (
          <NodeInfoPanel
            paper={selectedPaper}
            relations={selectedRelations}
            citations={selectedCitations}
            degree={degreeById.get(selectedPaper.slug) ?? 0}
            colorByGroup={colorByGroup}
            onClose={() => clearSelection()}
          />
        )}
      </div>

      {edgeTip && (
        <div
          className="pointer-events-none fixed z-50 max-w-xs rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg"
          style={{ left: edgeTip.x + 16, top: edgeTip.y + 16 }}
        >
          <p className="text-xs font-semibold text-gray-950">{edgeTip.title}</p>
          {edgeTip.note && <p className="mt-0.5 text-xs leading-5 text-gray-600">{edgeTip.note}</p>}
          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-400">{edgeTip.kind}</p>
        </div>
      )}

      <EdgeLegend colorByGroup={colorByGroup} />
    </div>
  );
}
