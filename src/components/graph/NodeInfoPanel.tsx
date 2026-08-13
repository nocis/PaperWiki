"use client";

import Link from "next/link";
import { RELATION_STYLE, type GraphLink, type GraphPaperInfo, type GraphRelationLink } from "./types";

/** The selected-node info panel: meta, relations, outgoing citations. */
export function NodeInfoPanel({
  paper,
  relations,
  citations,
  degree,
  colorByGroup,
  onClose,
}: {
  paper: GraphPaperInfo;
  relations: GraphRelationLink[];
  citations: GraphLink[];
  degree: number;
  colorByGroup: Map<string, string>;
  onClose: () => void;
}) {
  return (
    <aside className="w-full shrink-0 rounded-lg border border-gray-200 bg-white p-4 lg:w-80">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/paper/${paper.slug}`} className="text-sm font-semibold text-gray-950 hover:text-blue-700">
          {paper.title}
        </Link>
        <button type="button" onClick={onClose} className="text-xs text-gray-400 hover:text-gray-700" aria-label="Close panel">
          ✕
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span
          className="flex items-center gap-1.5 rounded-full bg-gray-50 px-2 py-0.5"
          title={paper.milestone}
        >
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorByGroup.get(paper.milestone) ?? "#9ca3af" }} />
          {paper.milestone}
        </span>
        {paper.publishedAt && <span className="rounded-full bg-gray-50 px-2 py-0.5">{paper.publishedAt}</span>}
        <span className="rounded-full bg-gray-50 px-2 py-0.5">{degree} edges</span>
      </div>
      {paper.essence && (
        <p className="mt-3 text-xs leading-5 text-gray-600">
          {paper.essence.length > 220 ? `${paper.essence.slice(0, 219)}…` : paper.essence}
        </p>
      )}
      {relations.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Relations</h3>
          <ul className="mt-2 space-y-1.5">
            {relations.map((rel, i) => (
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
      {citations.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Cites ({citations.length})
          </h3>
          <ul className="mt-2 space-y-1">
            {citations.slice(0, 8).map((cite, i) => (
              <li key={i} className="text-xs text-gray-700">
                <Link href={`/paper/${cite.target}`} className="font-mono text-[11px] text-blue-700 hover:underline">
                  {cite.target}
                </Link>
              </li>
            ))}
            {citations.length > 8 && (
              <li className="text-[11px] text-gray-400">… and {citations.length - 8} more</li>
            )}
          </ul>
        </div>
      )}
      <Link
        href={`/paper/${paper.slug}`}
        className="mt-4 inline-block rounded-full bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800"
      >
        Open paper page
      </Link>
    </aside>
  );
}
