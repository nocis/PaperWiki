"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { PALETTE, RELATION_LABEL, RELATION_STYLE, type GraphLink, type GraphNode, type GraphRelationLink } from "./types";
import type { GraphEdgeTip } from "./useForceGraph";

/** The SVG canvas: citation arrows, relation curves, and nodes. */
export function GraphCanvas({
  positions,
  nodes,
  visibleLinks,
  visibleRelations,
  highlightId,
  selectedId,
  colorByGroup,
  degreeById,
  neighborsOf,
  canvas,
  onNodeSelect,
  onNodeHover,
  onBackgroundClick,
  setEdgeTip,
}: {
  positions: Map<string, { x: number; y: number }>;
  nodes: GraphNode[];
  visibleLinks: GraphLink[];
  visibleRelations: GraphRelationLink[];
  highlightId: string | null;
  selectedId: string | null;
  colorByGroup: Map<string, string>;
  degreeById: Map<string, number>;
  neighborsOf: Map<string, Set<string>>;
  canvas: { width: number; height: number };
  onNodeSelect: (id: string) => void;
  onNodeHover: (id: string | null) => void;
  onBackgroundClick: () => void;
  setEdgeTip: (tip: GraphEdgeTip | null) => void;
}) {
  const setTip = (event: ReactMouseEvent<SVGElement>, tip: { kind: string; title: string; note?: string }) => {
    const svg = event.currentTarget.ownerSVGElement as SVGSVGElement | null;
    const rect = svg?.getBoundingClientRect();
    if (!rect) return;
    setEdgeTip({ ...tip, x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  return (
    <svg
      viewBox={`0 0 ${canvas.width} ${canvas.height}`}
      width={canvas.width}
      height={canvas.height}
      className="block"
      role="img"
      aria-label="Citation and relation graph"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onBackgroundClick();
        }
      }}
    >
      <defs>
        <marker id="citation-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#9ca3af" />
        </marker>
        {(["temporal", "contradicts", "impacts"] as const).map((kind) => (
          <marker key={kind} id={`rel-arrow-${kind}`} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={RELATION_STYLE[kind].stroke} />
          </marker>
        ))}
      </defs>

      {visibleLinks.map((link, index) => {
        const source = positions.get(link.source);
        const target = positions.get(link.target);
        if (!source || !target) return null;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const inset = 12;
        const dimmed = highlightId !== null && link.source !== highlightId && link.target !== highlightId;
        return (
          <line
            key={`${link.source}-${link.target}-${index}`}
            x1={source.x + (dx / dist) * inset}
            y1={source.y + (dy / dist) * inset}
            x2={target.x - (dx / dist) * inset}
            y2={target.y - (dy / dist) * inset}
            stroke="#9ca3af"
            strokeWidth={highlightId !== null && !dimmed ? 2 : 1}
            opacity={dimmed ? 0.06 : 0.35}
            markerEnd="url(#citation-arrow)"
            className="cursor-pointer"
            onMouseEnter={(event) => setTip(event, { kind: "citation", title: "cites", note: link.ref })}
            onMouseMove={(event) => setTip(event, { kind: "citation", title: "cites", note: link.ref })}
            onMouseLeave={() => setEdgeTip(null)}
          />
        );
      })}

      {visibleRelations.map((link, index) => {
        const source = positions.get(link.source);
        const target = positions.get(link.target);
        if (!source || !target) return null;
        const style = RELATION_STYLE[link.kind];
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const midX = (source.x + target.x) / 2;
        const midY = (source.y + target.y) / 2;
        const curve = 18;
        const cx = midX + (-dy / dist) * curve;
        const cy = midY + (dx / dist) * curve;
        // Inset the endpoints outside the node circles so the arrowheads
        // (markerEnd) are visible instead of buried under the nodes.
        const radiusOf = (id: string) => Math.min(16, 7 + (degreeById.get(id) ?? 0) * 1.4);
        const startTx = cx - source.x;
        const startTy = cy - source.y;
        const startLen = Math.hypot(startTx, startTy) || 1;
        const sx = source.x + (startTx / startLen) * 3;
        const sy = source.y + (startTy / startLen) * 3;
        const endTx = target.x - cx;
        const endTy = target.y - cy;
        const endLen = Math.hypot(endTx, endTy) || 1;
        const ex = target.x - (endTx / endLen) * (radiusOf(link.target) + 5);
        const ey = target.y - (endTy / endLen) * (radiusOf(link.target) + 5);
        const dimmed = highlightId !== null && link.source !== highlightId && link.target !== highlightId;
        return (
          <path
            key={`rel-${link.kind}-${link.source}-${link.target}-${index}`}
            d={`M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`}
            fill="none"
            stroke={style.stroke}
            strokeWidth={highlightId !== null && !dimmed ? 2.4 : style.width}
            opacity={dimmed ? 0.06 : 0.6}
            strokeDasharray={style.dash}
            markerEnd={`url(#rel-arrow-${link.kind})`}
            className="cursor-pointer"
            onMouseEnter={(event) => setTip(event, { kind: RELATION_LABEL[link.kind], title: link.kind, note: link.note })}
            onMouseMove={(event) => setTip(event, { kind: RELATION_LABEL[link.kind], title: link.kind, note: link.note })}
            onMouseLeave={() => setEdgeTip(null)}
          />
        );
      })}

      {nodes.map((node) => {
        const pos = positions.get(node.id);
        if (!pos) return null;
        const degree = degreeById.get(node.id) ?? 0;
        const radius = Math.min(16, 7 + degree * 1.4);
        const color = colorByGroup.get(node.group) ?? PALETTE[0];
        const neighbors = neighborsOf.get(node.id) ?? new Set<string>();
        const dimmed = highlightId !== null && node.id !== highlightId && !neighbors.has(highlightId);
        const label = node.label.length > 16 ? `${node.label.slice(0, 15)}…` : node.label;
        return (
          <g
            key={node.id}
            className="cursor-pointer"
            onClick={() => onNodeSelect(node.id)}
            onMouseEnter={() => onNodeHover(node.id)}
            onMouseLeave={() => {
              onNodeHover(null);
              setEdgeTip(null);
            }}
          >
            <title>{node.label}</title>
            <circle cx={pos.x} cy={pos.y} r={radius + 3} fill="white" opacity={0.9 * (dimmed ? 0.15 : 1)} />
            <circle
              cx={pos.x}
              cy={pos.y}
              r={radius}
              fill={color}
              opacity={0.85 * (dimmed ? 0.15 : 1)}
              stroke={selectedId === node.id ? "#111827" : "none"}
              strokeWidth={selectedId === node.id ? 2 : 0}
            />
            <text
              x={pos.x}
              y={pos.y + radius + 12}
              textAnchor="middle"
              fontSize={9}
              fill="#6b7280"
              opacity={dimmed ? 0.15 : 1}
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
