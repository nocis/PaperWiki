"use client";

import type { AvailabilityState } from "@/lib/llm-availability";
import type { KnowledgeApiPayload } from "@/lib/knowledge";
import type { KnowledgeRunSnapshot } from "@/lib/runs";

/** The Knowledge Compile control panel: run button, live progress, terminal banner. */
export function CompilePanel({
  db,
  runStatus,
  runTotals,
  runProgress,
  polling,
  llmBlocked,
  prefsUnresolved,
  availabilityState,
  onCompile,
}: {
  db: KnowledgeApiPayload;
  runStatus: KnowledgeRunSnapshot | null;
  runTotals: Record<string, number> | undefined;
  runProgress: number;
  polling: boolean;
  llmBlocked: boolean;
  prefsUnresolved: boolean;
  availabilityState: AvailabilityState;
  onCompile: () => void;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-950">Knowledge Compile</h2>
          <p className="mt-1 text-sm text-gray-500">
            From-zero build: cluster all pieces into overlapping topic articles, then review each
            against the latest literature wiki. Articles are derived — edits belong in pieces.
          </p>
        </div>
        <button
          type="button"
          onClick={onCompile}
          disabled={polling || llmBlocked || db.pieces.length === 0}
          title={
            db.pieces.length === 0
              ? "Add knowledge pieces first (reading note or chat selection)"
              : llmBlocked && availabilityState !== "available"
                ? "Waiting for LLM availability…"
                : undefined
          }
          className="rounded-full bg-blue-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-blue-400"
        >
          {polling
            ? "Compiling…"
            : llmBlocked
              ? prefsUnresolved
                ? "Loading…"
                : availabilityState === "checking" || availabilityState === "unknown"
                  ? "Checking availability…"
                  : "LLM unavailable"
              : "Compile knowledge"}
        </button>
      </div>

      {runStatus && runStatus.status === "running" && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm font-medium text-gray-900">
            Compiling knowledge…
            {runStatus.provider || runStatus.model ? (
              <span className="ml-2 text-xs text-gray-500">
                <code>{runStatus.provider ?? "default"}/{runStatus.model ?? "default"}</code>
              </span>
            ) : null}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {runTotals?.compiled ?? 0}/{runTotals?.articles ?? 0} articles written · {runTotals?.pieces ?? 0} pieces
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded bg-white">
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${runProgress}%` }} />
          </div>
          {runStatus.events.slice(-5).map((event, index) => (
            <p key={`${event.step}-${index}`} className="mt-1 font-mono text-xs text-gray-500">
              {event.status} · {event.label}
              {event.message ? `: ${event.message}` : ""}
            </p>
          ))}
        </div>
      )}

      {runStatus && (runStatus.status === "completed" || runStatus.status === "failed") && (
        <p
          className={`mt-3 rounded border p-2 text-sm ${
            runStatus.status === "failed"
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {runStatus.status === "failed"
            ? `Knowledge compile failed: ${runStatus.error ?? "unknown error"}`
            : "Knowledge compile completed."}
        </p>
      )}
    </section>
  );
}
