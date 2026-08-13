"use client";

/** Pure helpers shared by the compile panel views. */
import type { EventStatus } from "@/lib/progress";
import type { CompileProgressEvent } from "@/lib/runs";
import type { CompileStepInfo } from "./useCompileRunPolling";

export function formatDuration(ms?: number): string {
  if (ms === undefined) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
}

export function stepState(events: CompileProgressEvent[], stepId: string): CompileProgressEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].step === stepId) return events[i];
  }
  return null;
}

export function stateBadge(state: EventStatus | "pending" | "not-needed"): { text: string; className: string } {
  switch (state) {
    case "completed":
      return { text: "done", className: "bg-green-100 text-green-800" };
    case "started":
      return { text: "running", className: "bg-blue-100 text-blue-800" };
    case "failed":
      return { text: "failed", className: "bg-red-100 text-red-800" };
    case "skipped":
      return { text: "skipped", className: "bg-gray-200 text-gray-700" };
    case "cancelled":
      return { text: "cancelled", className: "bg-gray-200 text-gray-700" };
    case "not-needed":
      return { text: "not needed", className: "bg-gray-100 text-gray-400" };
    default:
      return { text: "pending", className: "bg-gray-100 text-gray-500" };
  }
}

export function paperOutcome(events: CompileProgressEvent[]): EventStatus | "pending" {
  const finished = stepState(events, "paper-finished");
  if (finished) return finished.status;
  if (events.some((event) => event.status === "failed")) return "failed";
  if (events.some((event) => event.status === "started")) return "started";
  return "pending";
}

export function completedPaperSteps(events: CompileProgressEvent[], catalog: CompileStepInfo[]): number {
  return catalog.filter((step) => stepState(events, step.id)?.status === "completed").length;
}
