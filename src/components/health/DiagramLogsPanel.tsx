"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

interface DiagramLogEntry {
  id: string;
  rawLog?: string;
  codeJs?: string;
  mmd?: string;
}

/**
 * Health panel for diagram render provenance: every paper with diagram logs
 * (raw LLM responses, executed svg.js code, cached Mermaid source), toggled
 * open per paper, per diagram. Re-polls when refreshKey changes (e.g. after a
 * reset-to-zero). Renders nothing when no paper has logs yet.
 */
export default function DiagramLogsPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [logsBySlug, setLogsBySlug] = useState<Record<string, DiagramLogEntry[]> | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/paper-knowledge?diagram-logs=1", { cache: "no-store" });
      if (!res.ok) return;
      setLogsBySlug(((await res.json()) as { logsBySlug?: Record<string, DiagramLogEntry[]> }).logsBySlug ?? {});
    } catch {
      /* keep the last known state */
    }
  }, []);

  useEffect(() => {
    void poll();
  }, [poll, refreshKey]);

  const slugs = Object.keys(logsBySlug ?? {});
  if (slugs.length === 0) return null;

  const block = (title: string, content?: string): ReactNode =>
    content !== undefined ? (
      <div>
        <p className="text-xs font-medium text-gray-500">{title}</p>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-gray-950 p-2 text-[11px] leading-5 text-gray-100">
          {content}
        </pre>
      </div>
    ) : null;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight text-gray-900">Diagram render logs</h3>
        <button
          type="button"
          onClick={() => void poll()}
          className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {slugs.map((slug) => {
        const entries = logsBySlug?.[slug] ?? [];
        const open = openSlug === slug;
        return (
          <div key={slug} className="border-b border-gray-100 py-2">
            <div className="flex items-center justify-between gap-3">
              <a
                href={`/paper/${slug}`}
                className="text-sm text-blue-700 underline decoration-blue-200 hover:decoration-blue-400"
              >
                {slug}
              </a>
              <span className="text-xs text-gray-500">{entries.length} diagram(s)</span>
              <button
                type="button"
                onClick={() => {
                  setOpenSlug(open ? null : slug);
                  setOpenId(null);
                }}
                className="rounded-lg bg-gray-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-700"
              >
                {open ? "Hide logs" : "Show logs"}
              </button>
            </div>
            {open &&
              entries.map((entry) => (
                <div key={entry.id} className="mt-2 rounded-lg border border-gray-100 bg-gray-50/60 p-2">
                  <button
                    type="button"
                    onClick={() => setOpenId(openId === entry.id ? null : entry.id)}
                    className="text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-800"
                  >
                    {entry.id} {openId === entry.id ? "▾" : "▸"}
                  </button>
                  {openId === entry.id && (
                    <div className="mt-2 space-y-2">
                      {block("raw.log (LLM responses)", entry.rawLog)}
                      {block("code.js (executed svg.js program)", entry.codeJs)}
                      {block("mmd (cached Mermaid source)", entry.mmd)}
                    </div>
                  )}
                </div>
              ))}
          </div>
        );
      })}
    </section>
  );
}
