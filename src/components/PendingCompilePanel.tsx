"use client";

import type { CompileRunSnapshot } from "@/lib/runs";
import { availabilityMessage } from "@/lib/llm-availability";
import { useCompileRunPolling } from "./compile/useCompileRunPolling";
import { completedPaperSteps } from "./compile/view";
import { RunSummaryCard } from "./compile/RunSummaryCard";
import { StepCatalogView } from "./compile/StepCatalogView";
import { PaperRow } from "./compile/PaperRow";
import { EventLogView } from "./compile/EventLogView";

export default function PendingCompilePanel({
  files,
  initialStatus,
}: {
  files: string[];
  initialStatus: CompileRunSnapshot | null;
}) {
  const {
    status,
    catalog,
    progressLog,
    statusFile,
    requestError,
    starting,
    cancelling,
    dismissed,
    prefs,
    availability,
    availabilityState,
    checkNow,
    prefsUnresolved,
    llmBlocked,
    isCompiling,
    compilePapers,
    cancelCompile,
    dismissSummary,
  } = useCompileRunPolling(initialStatus);

  const unavailableHint = prefsUnresolved
    ? "Loading model configuration…"
    : availabilityState === "unavailable" && availability
      ? availabilityMessage(availability.kind, availability.provider, availability.model)
      : availabilityState === "checking" || availabilityState === "unknown"
        ? "Checking LLM availability…"
        : null;

  const runEvents = status?.events.filter((event) => event.scope !== "paper") ?? [];
  const totalExpectedSteps = Math.max(1, catalog.paper.length * files.length);
  const totalCompletedSteps = files.reduce(
    (sum, file) =>
      sum + completedPaperSteps(status?.events.filter((event) => event.file === file) ?? [], catalog.paper),
    0
  );
  const percentComplete =
    status?.status === "completed"
      ? 100
      : Math.min(99, Math.round((totalCompletedSteps / totalExpectedSteps) * 100));

  if (dismissed && files.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-semibold text-amber-950">
            {files.length > 0
              ? `${files.length} new paper${files.length === 1 ? "" : "s"} waiting to be compiled`
              : status?.status === "completed"
                ? "Last compile completed"
                : status?.status === "failed"
                  ? "Last compile failed"
                  : status?.status === "cancelled"
                    ? "Last compile cancelled"
                    : "Compile"}
          </h2>
          {files.length > 0 && (
            <p className="mt-1 text-sm text-amber-800">
              The inbox <code>papers/new/</code> contains unprocessed PDFs. Compile them to add
              wiki pages, topics, and citations to the knowledge base.
            </p>
          )}
          {files.length > 0 && (
            <ul className="mt-3 list-inside list-disc text-sm text-amber-900">
              {files.map((file) => (
                <li key={file}>
                  <code>{file}</code>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex w-64 shrink-0 flex-col gap-3">
          {files.length > 0 && unavailableHint && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-800">
              {unavailableHint}
              {availabilityState === "unavailable" && (
                <button
                  type="button"
                  onClick={() => void checkNow()}
                  className="ml-1 font-medium underline underline-offset-2"
                >
                  Check now
                </button>
              )}
            </p>
          )}
          {files.length > 0 && (
            <button
              type="button"
              onClick={compilePapers}
              disabled={isCompiling || llmBlocked}
              title={llmBlocked && availabilityState !== "available" ? "Waiting for LLM availability…" : undefined}
              className="shrink-0 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-400"
            >
              {isCompiling
                ? "Compiling…"
                : llmBlocked
                  ? prefsUnresolved
                    ? "Loading…"
                    : availabilityState === "checking" || availabilityState === "unknown"
                      ? "Checking availability…"
                      : "LLM unavailable"
                  : status?.status === "failed"
                    ? "Retry compile"
                    : "Run yarn compile"}
            </button>
          )}
          {status?.status === "running" && (
            <button
              type="button"
              onClick={() => void cancelCompile()}
              disabled={cancelling}
              className="shrink-0 rounded-md border border-amber-700 bg-white px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cancelling ? "Cancelling…" : "Cancel compile"}
            </button>
          )}
          {status && (status.status === "completed" || status.status === "failed" || status.status === "cancelled") && files.length === 0 && (
            <button
              type="button"
              onClick={dismissSummary}
              className="shrink-0 rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:border-gray-300"
            >
              Dismiss summary
            </button>
          )}
          {files.length > 0 && (
            <p className="text-xs text-amber-900/70">
              Using <code>{prefs.provider || "…"}/{prefs.model || "…"}</code> — configured in the top bar.
            </p>
          )}
        </div>
      </div>

      {(status || requestError || starting) && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
          <RunSummaryCard
            status={status}
            starting={starting}
            requestError={requestError}
            percentComplete={percentComplete}
            filesCount={files.length}
          />

          {status && catalog.system.length > 0 && (
            <StepCatalogView catalog={catalog.system} runEvents={runEvents} />
          )}

          {status && catalog.paper.length > 0 && (
            <div className="mt-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-800">Paper steps</h3>
              {files.map((file) => (
                <PaperRow key={file} file={file} status={status} catalog={catalog.paper} />
              ))}
            </div>
          )}

          {status && <EventLogView status={status} />}

          <p className="mt-4 text-xs text-gray-500">
            Progress is persisted to <code>{progressLog}</code>; latest status is in <code>{statusFile}</code>.
          </p>
        </div>
      )}
    </section>
  );
}
