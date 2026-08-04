"use client";

import { useState } from "react";

/**
 * Add-to-knowledge: the ONLY sanctioned path for user knowledge to enter the
 * knowledge pipeline. Copies a reading note or selected chat range into
 * knowledge/pieces/ via POST /api/knowledge. Optional topic hint nudge.
 */
export default function AddToKnowledgeButton({
  kind,
  source,
  content,
  title,
  onDone,
  className = "",
  label = "Add to knowledge",
}: {
  kind: "note" | "chat";
  source: string;
  content: string;
  title?: string;
  onDone?: (slug: string) => void;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          source,
          content,
          title,
          topics: topic
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 10),
        }),
      });
      const data = (await response.json()) as { error?: string; piece?: { slug?: string } };
      if (!response.ok) throw new Error(data.error ?? `request failed with HTTP ${response.status}`);
      onDone?.(data.piece?.slug ?? "");
      setOpen(false);
      setTopic("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "failed to add to knowledge");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!content.trim()}
        className={`text-xs font-medium text-blue-700 hover:text-blue-900 disabled:cursor-not-allowed disabled:text-gray-300 ${className}`}
      >
        {label}
      </button>
    );
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <input
        value={topic}
        onChange={(event) => setTopic(event.target.value)}
        placeholder="Topic hint (optional, comma-separated)"
        className="w-44 rounded border border-gray-300 px-2 py-1 text-xs text-gray-800 outline-none focus:border-blue-500"
      />
      <button
        type="button"
        onClick={() => void add()}
        disabled={busy}
        className="rounded bg-blue-700 px-2 py-1 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setTopic("");
          setError(null);
        }}
        className="text-xs text-gray-400 hover:text-gray-700"
      >
        Cancel
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
