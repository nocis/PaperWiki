"use client";

import type { EdgeFilter } from "./types";

/** The edge-category filter buttons. */
export function GraphFilters({
  filter,
  counts,
  total,
  onFilter,
}: {
  filter: EdgeFilter;
  counts: { cite: number; temporal: number; contradicts: number; impacts: number };
  total: number;
  onFilter: (filter: EdgeFilter) => void;
}) {
  const FILTERS: { id: EdgeFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: total },
    { id: "cite", label: "Citations", count: counts.cite },
    { id: "temporal", label: "Temporal", count: counts.temporal },
    { id: "contradicts", label: "Contradicts", count: counts.contradicts },
    { id: "impacts", label: "Impacts", count: counts.impacts },
  ];

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {FILTERS.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => onFilter(f.id)}
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
  );
}
