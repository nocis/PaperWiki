"use client";

import type { CompileProgressEvent } from "@/lib/runs";
import { formatDuration, stateBadge, stepState } from "./view";
import type { CompileStepInfo } from "./useCompileRunPolling";

/** The run-level (non-paper) step list. */
export function StepCatalogView({
  catalog,
  runEvents,
}: {
  catalog: CompileStepInfo[];
  runEvents: CompileProgressEvent[];
}) {
  if (catalog.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-gray-800">Run steps</h3>
      <ol className="mt-2 space-y-1">
        {catalog.map((step) => {
          const event = stepState(runEvents, step.id);
          const badge = stateBadge(event?.status ?? "pending");
          return (
            <li key={step.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-gray-700">{step.label}</span>
              <span className="flex items-center gap-2">
                {event?.durationMs !== undefined && (
                  <span className="text-xs text-gray-400">{formatDuration(event.durationMs)}</span>
                )}
                <span className={`rounded-full px-2 py-0.5 text-xs ${badge.className}`}>{badge.text}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
