"use client";

import { useState } from "react";
import Link from "next/link";
import type { KnowledgePiecePayload } from "@/lib/knowledge";
import { provenanceLine } from "./format";

/** One knowledge piece row: preview, edit (chat only), topic hints, delete. */
export function PieceRow({
  piece,
  onPatch,
  onDelete,
}: {
  piece: KnowledgePiecePayload;
  onPatch: (slug: string, op: "edit-content" | "set-topics", payload: Record<string, unknown>) => Promise<void>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState("");
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [topics, setTopics] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveContent() {
    setSaving(true);
    setError(null);
    try {
      await onPatch(piece.slug, "edit-content", { content });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveTopics() {
    setSaving(true);
    setError(null);
    try {
      await onPatch(piece.slug, "set-topics", {
        topics: topics.split(",").map((t) => t.trim()).filter(Boolean),
      });
      setTopicsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/knowledge/pieces/${piece.slug}`}
              className="font-mono text-sm font-medium text-gray-900 hover:text-blue-700"
            >
              {piece.slug}
            </Link>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
              {piece.kind}
            </span>
            <code className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-400">{piece.source}</code>
          </div>
          <p className="mt-1 text-xs text-gray-400">{provenanceLine(piece)}</p>

          {editing ? (
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={6}
              className="mt-2 w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm leading-6 text-gray-800 outline-none focus:border-blue-500"
            />
          ) : (
            <p className="mt-1 text-sm leading-6 text-gray-600">{piece.preview}</p>
          )}

          {piece.topics.length > 0 && !topicsOpen && (
            <div className="mt-2 flex flex-wrap gap-1">
              {piece.topics.map((topic) => (
                <span key={topic} className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700">
                  {topic}
                </span>
              ))}
            </div>
          )}

          {topicsOpen && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={topics}
                onChange={(event) => setTopics(event.target.value)}
                placeholder="Topic hints (comma-separated)"
                className="w-64 rounded border border-gray-300 px-2 py-1 text-xs text-gray-800 outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => void saveTopics()}
                disabled={saving}
                className="rounded bg-blue-700 px-2 py-1 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setTopicsOpen(false)}
                className="text-xs text-gray-400 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          )}

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
          {piece.kind === "chat" && (
            <button
              type="button"
              onClick={async () => {
                setTopicsOpen(false);
                try {
                  const res = await fetch(`/api/knowledge?slug=${encodeURIComponent(piece.slug)}`, { cache: "no-store" });
                  const data = (await res.json()) as { piece?: { content?: string }; error?: string };
                  if (!res.ok || !data.piece) throw new Error(data.error ?? "failed to load piece");
                  setContent(data.piece.content ?? "");
                  setEditing(true);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "failed to load piece");
                }
              }}
              className="text-xs font-medium text-blue-700 hover:text-blue-900"
            >
              Edit
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setTopics(piece.topics.join(", "));
              setTopicsOpen(true);
              setEditing(false);
            }}
            className="text-xs font-medium text-gray-500 hover:text-gray-800"
          >
            Topics
          </button>
          <button type="button" onClick={onDelete} className="text-xs font-medium text-gray-400 hover:text-red-600">
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}
