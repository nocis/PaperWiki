"use client";

import type { CompileRunSnapshot } from "@/lib/runs";
import { formatDuration, formatTime } from "./view";

/** Event log and compiler output tail (the persistence note lives in the panel shell). */
export function EventLogView({
  status,
}: {
  status: CompileRunSnapshot;
}) {
  return (
    <>
      {status.events.length > 0 && (
        <details className="mt-4 rounded border border-gray-200 bg-gray-50 p-3">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">Event log</summary>
          <ol className="mt-3 max-h-72 space-y-1 overflow-auto font-mono text-xs text-gray-600">
            {[...status.events].reverse().map((event, index) => (
              <li key={`${event.timestamp}-${index}`} className="whitespace-pre-wrap">
                {formatTime(event.timestamp)} [{event.status}] {event.file ? `${event.file} — ` : ""}
                {event.label}
                {event.durationMs !== undefined ? ` (${formatDuration(event.durationMs)})` : ""}
                {event.message ? `: ${event.message}` : ""}
              </li>
            ))}
          </ol>
        </details>
      )}

      {status.outputTail && (
        <details className="mt-4 rounded border border-gray-200 bg-gray-50 p-3">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">Compiler output</summary>
          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-xs text-gray-700">
            {status.outputTail}
          </pre>
        </details>
      )}
    </>
  );
}
