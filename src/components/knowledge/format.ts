"use client";

import type { KnowledgePiecePayload } from "@/lib/knowledge";

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** Human-readable provenance; falls back to raw fields. */
export function provenanceLine(piece: KnowledgePiecePayload): string {
  if (piece.kind === "chat") return `chat exchange · ${piece.addedAt}`;
  const match = piece.preview.match(/^\*\*Paper\*\*:\s*\[\[([a-z0-9][a-z0-9-]*)\]\]\s*\(p\.\s*(\d+)\)/i);
  if (match) return `reading note on ${match[1]} p. ${match[2]} · ${piece.addedAt}`;
  return `reading note · ${piece.addedAt}`;
}
