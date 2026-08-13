"use client";

import { useEffect, useMemo, useState } from "react";
import { PALETTE, type EdgeFilter, type GraphLink, type GraphNode, type GraphPaperInfo, type GraphRelationLink } from "./types";

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

export interface GraphEdgeTip {
  kind: string;
  title: string;
  note?: string;
  x: number;
  y: number;
}

/**
 * All citation-graph state: the force-directed layout simulation, edge filter,
 * hover/pin/selection, and the derived view inputs.
 */
export function useForceGraph(
  nodes: GraphNode[],
  links: GraphLink[],
  relationLinks: GraphRelationLink[],
  papers: GraphPaperInfo[]
) {
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }> | null>(null);
  const [filter, setFilter] = useState<EdgeFilter>("all");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [edgeTip, setEdgeTip] = useState<GraphEdgeTip | null>(null);

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

  function selectNode(id: string) {
    const toggle = selectedId === id ? null : id;
    setSelectedId(toggle);
    setPinnedId(toggle);
  }

  function clearSelection(clearTip = false) {
    setSelectedId(null);
    setPinnedId(null);
    if (clearTip) setEdgeTip(null);
  }

  return {
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
  };
}
