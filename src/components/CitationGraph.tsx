"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface GraphNode {
  id: string;
  label: string;
  group: string;
}

export interface GraphLink {
  source: string;
  target: string;
}

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

const WIDTH = 900;
const HEIGHT = 600;
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

export default function CitationGraph({ nodes, links }: { nodes: GraphNode[]; links: GraphLink[] }) {
  const router = useRouter();
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }> | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    return degree;
  }, [nodes, links]);

  useEffect(() => {
    const sim: SimNode[] = nodes.map((n, i) => {
      const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      return {
        ...n,
        x: WIDTH / 2 + Math.cos(angle) * Math.min(240, 60 + nodes.length * 6) + (Math.random() - 0.5) * 40,
        y: HEIGHT / 2 + Math.sin(angle) * Math.min(240, 60 + nodes.length * 6) + (Math.random() - 0.5) * 40,
        vx: 0,
        vy: 0,
        degree: degreeById.get(n.id) ?? 0,
      };
    });
      const linkPairs = links
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
          n.vx += (WIDTH / 2 - n.x) * gravity;
          n.vy += (HEIGHT / 2 - n.y) * gravity;
          n.vx *= damping;
          n.vy *= damping;
          n.x += n.vx;
          n.y += n.vy;
        }
      }

      setPositions(new Map(sim.map((n) => [n.id, { x: n.x, y: n.y }])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links, degreeById]);

  if (!positions) {
    return <div className="flex h-[600px] items-center justify-center text-sm text-gray-500">Laying out citation graph…</div>;
  }

  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full rounded-lg border border-gray-200 bg-white" role="img" aria-label="Citation graph">
        <defs>
          <marker id="citation-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#9ca3af" />
          </marker>
        </defs>
        {links.map((link, index) => {
          const source = positions.get(link.source);
          const target = positions.get(link.target);
          if (!source || !target) return null;
          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const inset = 12;
          return (
            <line
              key={`${link.source}-${link.target}-${index}`}
              x1={source.x + (dx / dist) * inset}
              y1={source.y + (dy / dist) * inset}
              x2={target.x - (dx / dist) * inset}
              y2={target.y - (dy / dist) * inset}
              stroke="#9ca3af"
              strokeWidth={1}
              opacity={0.35}
              markerEnd="url(#citation-arrow)"
            />
          );
        })}
        {nodes.map((node) => {
          const pos = positions.get(node.id);
          if (!pos) return null;
          const degree = degreeById.get(node.id) ?? 0;
          const radius = Math.min(16, 7 + degree * 1.4);
          const color = colorByGroup.get(node.group) ?? PALETTE[0];
          return (
            <g
              key={node.id}
              className="cursor-pointer"
              onClick={() => router.push(`/paper/${node.id}`)}
              onMouseEnter={(event) => {
                if (hoverTimer.current) clearTimeout(hoverTimer.current);
                const rect = (event.currentTarget.ownerSVGElement as SVGSVGElement | null)?.getBoundingClientRect();
                const point = (event.currentTarget.ownerSVGElement as SVGSVGElement | null)?.createSVGPoint();
                if (!rect || !point) return;
                point.x = event.clientX - rect.left;
                point.y = event.clientY - rect.top;
                hoverTimer.current = setTimeout(() => {
                  setHover({ id: node.id, x: point.x, y: point.y });
                }, 180);
              }}
              onMouseLeave={() => {
                if (hoverTimer.current) clearTimeout(hoverTimer.current);
                setHover(null);
              }}
            >
              <circle cx={pos.x} cy={pos.y} r={radius + 3} fill="white" opacity={0.9} />
              <circle cx={pos.x} cy={pos.y} r={radius} fill={color} opacity={0.85} />
            </g>
          );
        })}
      </svg>
      {hover && (
        <div
          className="pointer-events-none fixed z-50 max-w-xs rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg"
          style={{ left: hover.x + 16, top: hover.y + 16 }}
        >
          <p className="text-sm font-semibold leading-5 text-gray-950">
            {nodes.find((n) => n.id === hover.id)?.label ?? hover.id}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {nodes.find((n) => n.id === hover.id)?.group ?? ""}
            {degreeById.get(hover.id) ? ` · degree ${degreeById.get(hover.id)}` : ""}
          </p>
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
      <p className="mt-3 text-xs text-gray-400">Nodes are compiled papers (colored by topic). Arrows point from a citing paper to the paper it cites. Click a node to open its page.</p>
    </div>
  );
}
