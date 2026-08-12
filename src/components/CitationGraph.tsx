"use client";

import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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

type EdgeFilter = "all" | "cite" | "temporal" | "contradicts" | "impacts";

const RELATION_STYLE: Record<GraphRelationLink["kind"], { stroke: string; width: number; dash?: string }> = {
  temporal: { stroke: "#2563eb", width: 1.4 },
  contradicts: { stroke: "#dc2626", width: 1.6 },
  impacts: { stroke: "#6b7280", width: 1.4, dash: "4 4" },
};

const RELATION_LABEL: Record<GraphRelationLink["kind"], string> = {
  temporal: "temporal relation",
  contradicts: "contradicts",
  impacts: "cross-topic impact",
};

const PALETTE = [
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

const ITERATIONS = 350;

interface SimNode {
  id: string;
  label: string;
  group: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
}

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
  const router = useRouter();
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }> | null>(null);
  const [filter, setFilter] = useState<EdgeFilter>("all");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Clicking a node pins the neighborhood highlight (hover that persists).
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [edgeTip, setEdgeTip] = useState<{ kind: string; title: string; note?: string; x: number; y: number } | null>(null);

  // The highlight target is the pinned node when set, else the hovered node.
  const highlightId = pinnedId ?? hoveredId;

  // Canvas grows with the node count so labels stay readable; the container
  // scrolls instead of shrinking the whole graph.
  const canvas = useMemo(() => {
    const n = Math.max(1, nodes.length);
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    return {
      width: Math.max(900, cols * 220),
      height: Math.max(600, Math.ceil(n / cols) * 200),
    };
  }, [nodes.length]);

  const colorByGroup = useMemo(() => {
    const groups = [...new Set(nodes.map((n) => n.group))];
    return new Map(groups.map((g, i) => [g, PALETTE[i % PALETTE.length]]));
  }, [nodes]);

  const degreeById = useMemo(() => {
    const degree = new Map<string, number>();
    for (const n of nodes) degree.set(n.id, 0);
    for (const link of links) {
      degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
      degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
    }
    for (const link of relationLinks) {
      degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
      degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
    }
    return degree;
  }, [nodes, links, relationLinks]);

  const counts = useMemo(
    () => ({
      cite: links.length,
      temporal: relationLinks.filter((l) => l.kind === "temporal").length,
      contradicts: relationLinks.filter((l) => l.kind === "contradicts").length,
      impacts: relationLinks.filter((l) => l.kind === "impacts").length,
    }),
    [links, relationLinks]
  );

  const visibleLinks = useMemo(() => {
    if (filter === "all" || filter === "cite") return links;
    return [];
  }, [filter, links]);

  const visibleRelations = useMemo(() => {
    if (filter === "all") return relationLinks;
    return relationLinks.filter((l) => l.kind === filter);
  }, [filter, relationLinks]);

  // Neighbors of a node (for hover highlight).
  const neighborsOf = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const n of nodes) map.set(n.id, new Set());
    for (const link of [...links, ...relationLinks]) {
      map.get(link.source)?.add(link.target);
      map.get(link.target)?.add(link.source);
    }
    return map;
  }, [nodes, links, relationLinks]);

  const selectedPaper = selectedId ? papers.find((p) => p.slug === selectedId) : null;
  const selectedRelations = selectedId
    ? relationLinks.filter((l) => l.source === selectedId)
    : [];
  const selectedCitations = selectedId ? links.filter((l) => l.source === selectedId) : [];

  useEffect(() => {
    const sim: SimNode[] = nodes.map((n, i) => {
      const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      return {
        ...n,
        x: canvas.width / 2 + Math.cos(angle) * Math.min(240, 60 + nodes.length * 6) + (Math.random() - 0.5) * 40,
        y: canvas.height / 2 + Math.sin(angle) * Math.min(240, 60 + nodes.length * 6) + (Math.random() - 0.5) * 40,
        vx: 0,
        vy: 0,
        degree: degreeById.get(n.id) ?? 0,
      };
    });
    const linkPairs = [...links, ...relationLinks]
      .map((l) => [sim.findIndex((n) => n.id === l.source), sim.findIndex((n) => n.id === l.target)])
      .filter(([a, b]) => a !== -1 && b !== -1 && a !== b) as [number, number][];

    for (let iter = 0; iter < ITERATIONS; iter++) {
      const repulsion = 900;
      const springK = 0.012;
      const restLength = 130;
      const gravity = 0.012;
      const damping = 0.82;

      for (let i = 0; i < sim.length; i++) {
        for (let j = i + 1; j < sim.length; j++) {
          const dx = sim[i].x - sim[j].x;
          const dy = sim[i].y - sim[j].y;
          const distSq = dx * dx + dy * dy || 1;
          const dist = Math.sqrt(distSq);
          const force = repulsion / distSq;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          sim[i].vx += fx;
          sim[i].vy += fy;
          sim[j].vx -= fx;
          sim[j].vy -= fy;
        }
      }
      for (const [a, b] of linkPairs) {
        const dx = sim[b].x - sim[a].x;
        const dy = sim[b].y - sim[a].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = springK * (dist - restLength);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        sim[a].vx += fx;
        sim[a].vy += fy;
        sim[b].vx -= fx;
        sim[b].vy -= fy;
      }
      for (const n of sim) {
        n.vx += (canvas.width / 2 - n.x) * gravity;
        n.vy += (canvas.height / 2 - n.y) * gravity;
        n.vx *= damping;
        n.vy *= damping;
        n.x += n.vx;
        n.y += n.vy;
      }
    }

    setPositions(new Map(sim.map((n) => [n.id, { x: n.x, y: n.y }])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links, relationLinks, degreeById, canvas.width, canvas.height]);

  if (!positions) {
    return <div className="flex h-[600px] items-center justify-center text-sm text-gray-500">Laying out citation graph…</div>;
  }

  const FILTERS: { id: EdgeFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: links.length + relationLinks.length },
    { id: "cite", label: "Citations", count: counts.cite },
    { id: "temporal", label: "Temporal", count: counts.temporal },
    { id: "contradicts", label: "Contradicts", count: counts.contradicts },
    { id: "impacts", label: "Impacts", count: counts.impacts },
  ];

  const setTip = (event: ReactMouseEvent<SVGElement>, tip: { kind: string; title: string; note?: string }) => {
    const svg = event.currentTarget.ownerSVGElement as SVGSVGElement | null;
    const rect = svg?.getBoundingClientRect();
    if (!rect) return;
    setEdgeTip({ ...tip, x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  return (
    <div>
      {/* Edge category filter */}
      <div className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              filter === f.id
                ? "bg-gray-900 text-white"
                : "border border-gray-200 bg-white text-gray-600 hover:border-gray-300"
            }`}
          >
            {f.label} <span className={filter === f.id ? "text-gray-300" : "text-gray-400"}>({f.count})</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="max-h-[80vh] overflow-auto rounded-lg border border-gray-200 bg-white lg:flex-1">
        <svg
          viewBox={`0 0 ${canvas.width} ${canvas.height}`}
          width={canvas.width}
          height={canvas.height}
          className="block"
          role="img"
          aria-label="Citation and relation graph"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedId(null);
              setPinnedId(null);
              setEdgeTip(null);
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
                onClick={() => {
                  const toggle = selectedId === node.id ? null : node.id;
                  setSelectedId(toggle);
                  setPinnedId(toggle);
                }}
                onMouseEnter={() => {
                  setHoveredId(node.id);
                }}
                onMouseLeave={() => {
                  setHoveredId(null);
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
        </div>

        {/* Node info panel */}
        {selectedPaper && (
          <aside className="w-full shrink-0 rounded-lg border border-gray-200 bg-white p-4 lg:w-80">
            <div className="flex items-start justify-between gap-2">
              <Link href={`/paper/${selectedPaper.slug}`} className="text-sm font-semibold text-gray-950 hover:text-blue-700">
                {selectedPaper.title}
              </Link>
              <button type="button" onClick={() => { setSelectedId(null); setPinnedId(null); }} className="text-xs text-gray-400 hover:text-gray-700" aria-label="Close panel">
                ✕
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span
                className="flex items-center gap-1.5 rounded-full bg-gray-50 px-2 py-0.5"
                title={selectedPaper.milestone}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorByGroup.get(selectedPaper.milestone) ?? "#9ca3af" }} />
                {selectedPaper.milestone}
              </span>
              {selectedPaper.publishedAt && <span className="rounded-full bg-gray-50 px-2 py-0.5">{selectedPaper.publishedAt}</span>}
              <span className="rounded-full bg-gray-50 px-2 py-0.5">{degreeById.get(selectedPaper.slug) ?? 0} edges</span>
            </div>
            {selectedPaper.essence && (
              <p className="mt-3 text-xs leading-5 text-gray-600">
                {selectedPaper.essence.length > 220 ? `${selectedPaper.essence.slice(0, 219)}…` : selectedPaper.essence}
              </p>
            )}
            {selectedRelations.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Relations</h3>
                <ul className="mt-2 space-y-1.5">
                  {selectedRelations.map((rel, i) => (
                    <li key={i} className="text-xs leading-5 text-gray-700">
                      <span
                        className="mr-1.5 inline-block rounded px-1.5 py-0.5 font-medium"
                        style={{
                          color: RELATION_STYLE[rel.kind].stroke,
                          backgroundColor: `${RELATION_STYLE[rel.kind].stroke}14`,
                        }}
                      >
                        {rel.kind}
                      </span>
                      <Link href={`/paper/${rel.target}`} className="font-mono text-[11px] text-blue-700 hover:underline">
                        {rel.target}
                      </Link>
                      {rel.note ? <span className="text-gray-500"> — {rel.note}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {selectedCitations.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Cites ({selectedCitations.length})
                </h3>
                <ul className="mt-2 space-y-1">
                  {selectedCitations.slice(0, 8).map((cite, i) => (
                    <li key={i} className="text-xs text-gray-700">
                      <Link href={`/paper/${cite.target}`} className="font-mono text-[11px] text-blue-700 hover:underline">
                        {cite.target}
                      </Link>
                    </li>
                  ))}
                  {selectedCitations.length > 8 && (
                    <li className="text-[11px] text-gray-400">… and {selectedCitations.length - 8} more</li>
                  )}
                </ul>
              </div>
            )}
            <Link
              href={`/paper/${selectedPaper.slug}`}
              className="mt-4 inline-block rounded-full bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800"
            >
              Open paper page
            </Link>
          </aside>
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
    </div>
  );
}
