"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLlmPrefs } from "./LlmPrefsProvider";
import { availabilityMessage } from "@/lib/llm-availability";

type EventStatus = "started" | "completed" | "failed" | "skipped" | "cancelled";
type RunStatus = "idle" | "running" | "completed" | "failed" | "cancelled";

type CompileProgressEvent = {
  runId: string;
  timestamp: string;
  scope: "run" | "paper" | "process";
  step: string;
  label: string;
  status: EventStatus;
  message?: string;
  durationMs?: number;
  paperIndex?: number;
  paperTotal?: number;
  file?: string;
  slug?: string;
};

type CompileRunSnapshot = {
  runId: string;
  status: RunStatus;
  source: "cli" | "ui";
  provider?: string;
  model?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  currentStep?: string;
  currentLabel?: string;
  currentFile?: string;
  error?: string;
  totals: { papers: number; compiled: number; duplicates: number; failed: number };
  events: CompileProgressEvent[];
  outputTail?: string;
};

type CompileStepInfo = { id: string; label: string };
type CompileStatusResponse = {
  status: CompileRunSnapshot | null;
  stepCatalog: { system: CompileStepInfo[]; paper: CompileStepInfo[] };
  progressLog: string;
  statusFile: string;
};

const fallbackCatalog: CompileStatusResponse["stepCatalog"] = {
  system: [],
  paper: [],
};

/** Per-run completion summary is hidden until the user dismisses it. */
const DISMISS_KEY = "paperwiki:compile-summary-dismissed";

function formatDuration(ms?: number): string {
  if (ms === undefined) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
}

function stepState(events: CompileProgressEvent[], stepId: string): CompileProgressEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].step === stepId) return events[i];
  }
  return null;
}

function stateBadge(state: EventStatus | "pending" | "not-needed"): { text: string; className: string } {
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

function paperOutcome(events: CompileProgressEvent[]): EventStatus | "pending" {
  const finished = stepState(events, "paper-finished");
  if (finished) return finished.status;
  if (events.some((event) => event.status === "failed")) return "failed";
  if (events.some((event) => event.status === "started")) return "started";
  return "pending";
}

function completedPaperSteps(events: CompileProgressEvent[], catalog: CompileStepInfo[]): number {
  return catalog.filter((step) => stepState(events, step.id)?.status === "completed").length;
}

export default function PendingCompilePanel({
  files,
  initialStatus,
}: {
  files: string[];
  initialStatus: CompileRunSnapshot | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<CompileRunSnapshot | null>(initialStatus);
  const [catalog, setCatalog] = useState(fallbackCatalog);
  const [progressLog, setProgressLog] = useState(".log/compile-progress.jsonl");
  const [statusFile, setStatusFile] = useState(".log/compile-status.json");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [shouldPoll, setShouldPoll] = useState(initialStatus?.status === "running");
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const sawRunningRef = useRef(initialStatus?.status === "running");
  const { prefs, availability, availabilityState, checkNow } = useLlmPrefs();

  // A dismissed completion summary stays hidden across refreshes (session).
  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") setDismissed(true);
    } catch {
      /* storage is optional */
    }
  }, []);

  const isCompiling = status?.status === "running" || shouldPoll || starting;
  const prefsUnresolved = !prefs.provider || !prefs.model;
  const llmBlocked =
    prefsUnresolved ||
    availabilityState === "checking" ||
    availabilityState === "unavailable" ||
    availabilityState === "unknown";
  const unavailableHint = prefsUnresolved
    ? "Loading model configuration…"
    : availabilityState === "unavailable" && availability
      ? availabilityMessage(availability.kind, availability.provider, availability.model)
      : availabilityState === "checking" || availabilityState === "unknown"
        ? "Checking LLM availability…"
        : null;

  useEffect(() => {
    if (!shouldPoll) return;

    let active = true;
    async function loadStatus() {
      try {
        const response = await fetch("/api/compile", { cache: "no-store" });
        if (!response.ok) throw new Error(`status request failed with HTTP ${response.status}`);
        const body = (await response.json()) as CompileStatusResponse;
        if (!active) return;
        setStatus(body.status);
        setCatalog(body.stepCatalog);
        setProgressLog(body.progressLog);
        setStatusFile(body.statusFile);
        setStarting(false);
        setRequestError(null);
        if (body.status?.status === "completed" || body.status?.status === "failed" || body.status?.status === "cancelled") {
          setShouldPoll(false);
        }
      } catch (err) {
        if (active) {
          setRequestError(err instanceof Error ? err.message : "failed to load compile status");
        }
      }
    }

    void loadStatus();
    const interval = window.setInterval(loadStatus, 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [shouldPoll]);

  useEffect(() => {
    if (status?.status === "running") {
      sawRunningRef.current = true;
      return;
    }
    if ((status?.status === "completed" || status?.status === "failed") && sawRunningRef.current) {
      sawRunningRef.current = false;
      router.refresh();
    }
  }, [status, router]);

  async function compilePapers() {
    setRequestError(null);
    if (availabilityState !== "available") {
      setRequestError("LLM unavailable — cannot start compile.");
      void checkNow();
      return;
    }
    // Optimistic start: clear the old snapshot and show "Run is starting…"
    // immediately. Polling starts only after the POST confirms the new run is
    // on disk — a first poll during the POST would read the OLD terminal
    // snapshot and freeze the panel on the previous failure.
    try {
      sessionStorage.removeItem(DISMISS_KEY);
    } catch {
      /* storage is optional */
    }
    setDismissed(false);
    setStatus(null);
    setStarting(true);
    sawRunningRef.current = true;

    try {
      const response = await fetch("/api/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: prefs.provider, model: prefs.model }),
      });
      const body = (await response.json()) as { error?: string };
      if (response.ok) {
        setStarting(false);
        setShouldPoll(true);
      } else if (/already running/i.test(body.error ?? "")) {
        // Another run is genuinely live — reconcile by showing it.
        setStarting(false);
        setShouldPoll(true);
        setRequestError("A compile is already running — showing its live status.");
      } else {
        setRequestError(body.error ?? `compile request failed with HTTP ${response.status}`);
        setShouldPoll(false);
        sawRunningRef.current = false;
        setStarting(false);
      }
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "compile request failed");
      setShouldPoll(false);
      sawRunningRef.current = false;
      setStarting(false);
    }
  }

  async function cancelCompile() {
    setRequestError(null);
    setCancelling(true);
    try {
      const response = await fetch("/api/compile/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? `cancel request failed with HTTP ${response.status}`);
      }
      // Pick up the cancelled terminal state on the next poll.
      setShouldPoll(true);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "cancel request failed");
      // Reconcile — the run may have ended on its own.
      setShouldPoll(true);
    } finally {
      setCancelling(false);
    }
  }

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
              onClick={() => {
                setDismissed(true);
                try {
                  sessionStorage.setItem(DISMISS_KEY, "1");
                } catch {
                  /* storage is optional */
                }
              }}
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
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-gray-900">
                {status?.status === "running" && (status.currentLabel ?? "Compile is starting…")}
                {status?.status === "completed" && "Compile completed"}
                {status?.status === "failed" && "Compile failed"}
                {status?.status === "cancelled" && "Compile cancelled"}
                {starting && !status && "Run is starting…"}
                {!status && !starting && "Compile status unavailable"}
              </p>
              {(status?.status === "completed" || status?.status === "cancelled") && (
                <p className="mt-1 text-xs text-gray-600">
                  {status.totals.compiled} compiled · {status.totals.duplicates} duplicate
                  {status.totals.duplicates === 1 ? "" : "s"} · {status.totals.failed} failed
                </p>
              )}
              <p className="text-xs text-gray-500">
                {status ? (
                  <>
                    run <code>{status.runId}</code> · {status.source}
                    {status.provider || status.model ? (
                      <>
                        {" "}
                        ·{" "}
                        <code>
                          {status.provider ?? "default"}/{status.model ?? "default"}
                        </code>
                      </>
                    ) : null}
                        · updated {formatTime(status.updatedAt)}
                    {status.currentFile ? ` · ${status.currentFile}` : ""}
                  </>
                ) : (
                  requestError
                )}
              </p>
            </div>
            {status && (
              <span
                className={`rounded-full px-2 py-1 text-xs font-medium ${
                  stateBadge(
                    status.status === "running"
                      ? "started"
                      : status.status === "idle"
                        ? "pending"
                        : status.status
                  ).className
                }`}
              >
                {status.status}
              </span>
            )}
          </div>

          {status && (
            <>
              <div className="mt-3 h-2 overflow-hidden rounded bg-gray-100">
                <div
                  className={`h-full transition-all ${status.status === "failed" ? "bg-red-500" : "bg-blue-600"}`}
                  style={{ width: `${percentComplete}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                <span>{percentComplete}% of known paper steps</span>
                <span>{status.totals.compiled}/{status.totals.papers || files.length} compiled</span>
                <span>{status.totals.duplicates} duplicates</span>
                <span>{status.totals.failed} failed</span>
              </div>
            </>
          )}

          {requestError && (
            <p className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
              {requestError}
            </p>
          )}
          {status?.error && (
            <p
              className={`mt-3 rounded border p-2 text-sm ${
                status.status === "cancelled"
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-red-200 bg-red-50 text-red-800"
              }`}
            >
              {status.error}
            </p>
          )}

          {catalog.system.length > 0 && status && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-gray-800">Run steps</h3>
              <ol className="mt-2 space-y-1">
                {catalog.system.map((step) => {
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
          )}

          {catalog.paper.length > 0 && status && (
            <div className="mt-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-800">Paper steps</h3>
              {files.map((file) => {
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
                const completedSteps = completedPaperSteps(events, catalog.paper);
                const paperPercent = Math.min(
                  100,
                  Math.round((completedSteps / Math.max(1, catalog.paper.length)) * 100)
                );
                return (
                  <details key={file} className="rounded border border-gray-200 bg-gray-50 p-3" open={!neverStarted && (outcome === "started" || outcome === "failed" || outcome === "cancelled")}>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                      <span className="min-w-0 flex-1">
                        <code className="block truncate text-sm text-gray-800">{file}</code>
                        <span className="text-xs text-gray-500">
                          {neverStarted
                            ? "the run ended before this paper started"
                            : `${completedSteps}/${catalog.paper.length} steps complete${
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
                        {catalog.paper.map((step) => {
                          const event = stepState(events, step.id);
                          // A step with no event was conditional and not
                          // applicable once the paper finished OR once the
                          // pipeline has already passed its position (a later
                          // step has run) — don't let it read as "stuck".
                          const stepIndex = catalog.paper.indexOf(step);
                          const passedPosition =
                            event === null &&
                            catalog.paper.some(
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
              })}
            </div>
          )}

          {status && status.events.length > 0 && (
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

          {status?.outputTail && (
            <details className="mt-4 rounded border border-gray-200 bg-gray-50 p-3">
              <summary className="cursor-pointer text-sm font-medium text-gray-700">Compiler output</summary>
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-xs text-gray-700">
                {status.outputTail}
              </pre>
            </details>
          )}

          <p className="mt-4 text-xs text-gray-500">
            Progress is persisted to <code>{progressLog}</code>; latest status is in <code>{statusFile}</code>.
          </p>
        </div>
      )}
    </section>
  );
}
