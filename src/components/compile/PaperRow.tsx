"use client";

import type { CompileRunSnapshot } from "@/lib/runs";
import { completedPaperSteps, formatDuration, formatElapsed, paperOutcome, stateBadge, stepState } from "./view";
import type { CompileStepInfo } from "./useCompileRunPolling";

/** One paper's progress row: outcome badge, per-step list, failure message. */
export function PaperRow({
  file,
  status,
  catalog,
}: {
  file: string;
  status: CompileRunSnapshot;
  catalog: CompileStepInfo[];
}) {
  const events = status.events.filter((event) => event.scope === "paper" && event.file === file);
  const rawOutcome = paperOutcome(events);
  // A paper mid-flight when the run ended is not "running" forever —
  // it inherits the run's terminal outcome.
  const outcome =
    rawOutcome === "started" &&
    (status.status === "cancelled" || status.status === "failed")
      ? status.status
      : rawOutcome;
  // A paper with no events in a terminal run was never dispatched
  // (fail-hard stopped the pool) — say so instead of a pending list.
  const neverStarted =
    events.length === 0 &&
    (status.status === "completed" || status.status === "failed" || status.status === "cancelled");
  const outcomeBadge = neverStarted
    ? { text: "not started", className: "bg-gray-100 text-gray-500" }
    : stateBadge(outcome);
  const runningEvent = [...events].reverse().find((event) => event.status === "started");
  const completedSteps = completedPaperSteps(events, catalog);
  const paperPercent = Math.min(
    100,
    Math.round((completedSteps / Math.max(1, catalog.length)) * 100)
  );

  return (
    <details
      className="rounded border border-gray-200 bg-gray-50 p-3"
      open={!neverStarted && (outcome === "started" || outcome === "failed" || outcome === "cancelled")}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="min-w-0 flex-1">
          <code className="block truncate text-sm text-gray-800">{file}</code>
          <span className="text-xs text-gray-500">
            {neverStarted
              ? "the run ended before this paper started"
              : `${completedSteps}/${catalog.length} steps complete${
                  runningEvent && outcome === "started"
                    ? ` · ${runningEvent.label} (${formatElapsed(Date.now() - new Date(runningEvent.timestamp).getTime())})`
                    : ""
                }`}
          </span>
          {!neverStarted && outcome === "started" && (
            <span className="mt-1.5 block h-1 w-full overflow-hidden rounded bg-gray-200">
              <span
                className="block h-full bg-blue-600 transition-all"
                style={{ width: `${paperPercent}%` }}
              />
            </span>
          )}
        </span>
        <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${outcomeBadge.className}`}>
          {outcomeBadge.text}
        </span>
      </summary>
      {!neverStarted && (
        <ol className="mt-3 space-y-1 border-t border-gray-200 pt-3">
          {catalog.map((step) => {
            const event = stepState(events, step.id);
            // A step with no event was conditional and not
            // applicable once the paper finished OR once the
            // pipeline has already passed its position (a later
            // step has run) — don't let it read as "stuck".
            const stepIndex = catalog.indexOf(step);
            const passedPosition =
              event === null &&
              catalog.some(
                (later, idx) => idx > stepIndex && stepState(events, later.id) !== null
              );
            const badge = stateBadge(
              event?.status ??
                (stepState(events, "paper-finished") || passedPosition ? "not-needed" : "pending")
            );
            return (
              <li key={step.id} className="flex items-start justify-between gap-3 text-sm">
                <span className="text-gray-700">{step.label}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {event?.durationMs !== undefined && (
                    <span className="text-xs text-gray-400">{formatDuration(event.durationMs)}</span>
                  )}
                  {event?.status === "started" && (
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-600" />
                  )}
                  <span className={`rounded-full px-2 py-0.5 text-xs ${badge.className}`}>{badge.text}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {events.some((event) => event.message && event.status === "failed") && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {events.find((event) => event.message && event.status === "failed")?.message}
        </p>
      )}
    </details>
  );
}
