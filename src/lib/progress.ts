/**
 * Generic persistent run-progress tracker.
 *
 * One factory powers the three long-running pipelines (paper compile, citation
 * rebuild, knowledge compile). Each tracker owns:
 *   .log/<name>-progress.jsonl   — append-only event log (history)
 *   .log/<name>-status.json      — atomically-updated latest snapshot (UI)
 *
 * Snapshot JSON shapes are shared with the client components (PendingCompilePanel,
 * KnowledgeDashboard, health page) — fields that are not set are omitted.
 */
import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";

const LOG_DIR = path.join(process.cwd(), ".log");

export type RunStatus = "idle" | "running" | "completed" | "failed" | "cancelled";
export type EventStatus = "started" | "completed" | "failed" | "skipped" | "cancelled";
export type RunSource = "cli" | "ui";

export interface ProgressEvent {
  runId: string;
  timestamp: string;
  /** Compile only: "run" | "paper" | "process". */
  scope?: string;
  step: string;
  label: string;
  status: EventStatus;
  message?: string;
  durationMs?: number;
  paperIndex?: number;
  paperTotal?: number;
  file?: string;
  slug?: string;
}

export interface RunSnapshot {
  runId: string;
  status: RunStatus;
  source: RunSource;
  provider?: string;
  model?: string;
  /** Citations only: "all" or a single slug. */
  scope?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  currentStep?: string;
  currentLabel?: string;
  currentFile?: string;
  currentSlug?: string;
  error?: string;
  totals: Record<string, number>;
  events: ProgressEvent[];
  outputTail?: string;
}

/** A persisted "running" snapshot this old, with no live process, is a dead run. */
export const STALE_RUN_MS = 15 * 60_000;

export function isStaleRunning(snapshot: RunSnapshot | null): boolean {
  return (
    !!snapshot &&
    snapshot.status === "running" &&
    Date.now() - new Date(snapshot.updatedAt).getTime() > STALE_RUN_MS
  );
}

export interface ProgressConfig {
  /** Tracker name — also names the .log files. */
  name: "compile" | "citations" | "knowledge";
  initialTotals: Record<string, number>;
  /** Compile events carry a scope field ("run"|"paper"|"process"). */
  eventScope?: boolean;
  /** Increment a total when an event with the given step/status is recorded. */
  totalsOnEvent?: Record<string, Partial<Record<EventStatus, string>>>;
}

type EventInput = Omit<ProgressEvent, "runId" | "timestamp"> & { runId?: string };

export function createProgress(config: ProgressConfig) {
  const progressLog = path.join(LOG_DIR, `${config.name}-progress.jsonl`);
  const statusPath = path.join(LOG_DIR, `${config.name}-status.json`);
  let currentRunId: string | undefined;

  // Serialize status-file read-modify-write operations. Concurrent callers
  // (parallel compile papers, end-of-run passes) share ONE status file — a
  // promise chain ensures events and totals are never lost to interleaving.
  let lockChain: Promise<void> = Promise.resolve();
  function withLock<T>(work: () => Promise<T>): Promise<T> {
    const result = lockChain.then(work);
    lockChain = result.then(() => undefined, () => undefined);
    return result;
  }

  function newSnapshot(input: {
    runId: string;
    source: RunSource;
    provider?: string;
    model?: string;
    scope?: string;
  }): RunSnapshot {
    const now = new Date().toISOString();
    return {
      runId: input.runId,
      status: "running",
      source: input.source,
      provider: input.provider,
      model: input.model,
      scope: input.scope,
      startedAt: now,
      updatedAt: now,
      totals: { ...config.initialTotals },
      events: [],
    };
  }

  async function writeSnapshotAtomic(snapshot: RunSnapshot): Promise<void> {
    await fs.mkdir(LOG_DIR, { recursive: true });
    const tmp = `${statusPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2) + "\n");
    await fs.rename(tmp, statusPath);
  }

  async function appendEventLine(event: ProgressEvent): Promise<void> {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.appendFile(progressLog, JSON.stringify(event) + "\n");
  }

  async function readStatus(): Promise<RunSnapshot | null> {
    try {
      return JSON.parse(await fs.readFile(statusPath, "utf8")) as RunSnapshot;
    } catch {
      return null;
    }
  }

  /**
   * readStatus, but a stale "running" snapshot (interrupted run — e.g. the dev
   * server restarted and killed the spawned child) is surfaced as failed so
   * the UI stops polling and unblocks. The persisted file is untouched; the
   * POST route formally fails the run.
   */
  async function readEffectiveStatus(): Promise<RunSnapshot | null> {
    const snapshot = await readStatus();
    if (isStaleRunning(snapshot)) {
      snapshot!.status = "failed";
      snapshot!.error =
        "The previous run was interrupted (server restarted mid-run). Start a new run to resume; pending work self-heals.";
      snapshot!.finishedAt = new Date().toISOString();
    }
    return snapshot;
  }

  function createRunId(): string {
    return `${config.name}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  }

  async function startRaw(input: {
    runId?: string;
    source: RunSource;
    provider?: string;
    model?: string;
    scope?: string;
  }): Promise<string> {
    const runId = input.runId ?? createRunId();
    currentRunId = runId;
    const snapshot = newSnapshot({
      runId,
      source: input.source,
      provider: input.provider,
      model: input.model,
      scope: input.scope,
    });
    await writeSnapshotAtomic(snapshot);
    await recordRaw({
      runId,
      step: "run-started",
      label: "Run started",
      status: "started",
      message: input.model ? `Provider: ${input.provider ?? "default"} · Model: ${input.model}` : undefined,
    });
    return runId;
  }

  /** Attach to a run already started by the API route (UI-spawned runs). */
  function resume(runId: string): void {
    currentRunId = runId;
  }

  async function recordRaw(input: EventInput): Promise<void> {
    const runId = input.runId ?? currentRunId;
    if (!runId) return;

    let snapshot = await readStatus();
    if (!snapshot || snapshot.runId !== runId) {
      snapshot = newSnapshot({ runId, source: "cli" });
    }

    const { runId: _ignored, ...eventInput } = input;
    const event: ProgressEvent = {
      ...eventInput,
      runId,
      timestamp: new Date().toISOString(),
    };

    snapshot.events = [...snapshot.events, event].slice(-500);
    snapshot.updatedAt = event.timestamp;
    if (event.status === "started" || event.status === "failed") {
      snapshot.currentStep = event.step;
      snapshot.currentLabel = event.label;
      snapshot.currentFile = event.file;
      snapshot.currentSlug = event.slug;
    }
    if (event.status === "failed" && !snapshot.error) {
      snapshot.error = event.message ?? event.label;
    }
    const totalKey = config.totalsOnEvent?.[event.step]?.[event.status];
    if (totalKey) {
      snapshot.totals[totalKey] = (snapshot.totals[totalKey] ?? 0) + 1;
    }

    await appendEventLine(event);
    await writeSnapshotAtomic(snapshot);
  }

  function start(input: {
    runId?: string;
    source: RunSource;
    provider?: string;
    model?: string;
    scope?: string;
  }): Promise<string> {
    return withLock(() => startRaw(input));
  }

  function record(input: EventInput): Promise<void> {
    return withLock(() => recordRaw(input));
  }

  async function updateRaw(patch: {
    totals?: Partial<Record<string, number>>;
    provider?: string;
    model?: string;
    outputTail?: string;
  }): Promise<void> {
    if (!currentRunId) return;
    const snapshot = await readStatus();
    if (!snapshot || snapshot.runId !== currentRunId) return;
    if (patch.totals) snapshot.totals = { ...snapshot.totals, ...patch.totals } as Record<string, number>;
    if (patch.provider) snapshot.provider = patch.provider;
    if (patch.model) snapshot.model = patch.model;
    if (patch.outputTail !== undefined) snapshot.outputTail = patch.outputTail;
    snapshot.updatedAt = new Date().toISOString();
    await writeSnapshotAtomic(snapshot);
  }

  function update(patch: {
    totals?: Partial<Record<string, number>>;
    provider?: string;
    model?: string;
    outputTail?: string;
  }): Promise<void> {
    return withLock(() => updateRaw(patch));
  }

  async function runStep<T>(
    step: string,
    label: string,
    work: () => Promise<T>,
    context: Partial<ProgressEvent> = {}
  ): Promise<T> {
    const startedAt = Date.now();
    await record({
      ...(config.eventScope ? { scope: "run" } : {}),
      ...context,
      step,
      label,
      status: "started",
    });
    try {
      const result = await work();
      await record({
        ...(config.eventScope ? { scope: "run" } : {}),
        ...context,
        step,
        label,
        status: "completed",
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (err) {
      await record({
        ...(config.eventScope ? { scope: "run" } : {}),
        ...context,
        step,
        label,
        status: "failed",
        durationMs: Date.now() - startedAt,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async function finishRaw(
    status: Exclude<RunStatus, "idle" | "running">,
    message: string,
    outputTail?: string
  ): Promise<void> {
    if (!currentRunId) return;
    await recordRaw({
      step: status === "completed" ? "run-completed" : "run-failed",
      label: status === "completed" ? "Run completed" : "Run failed",
      status: status === "completed" ? "completed" : "failed",
      message,
    });

    const snapshot = await readStatus();
    if (!snapshot || snapshot.runId !== currentRunId) return;
    snapshot.status = status;
    snapshot.finishedAt = new Date().toISOString();
    snapshot.updatedAt = snapshot.finishedAt;
    snapshot.currentStep = undefined;
    snapshot.currentLabel = undefined;
    snapshot.currentFile = undefined;
    snapshot.currentSlug = undefined;
    if (status === "failed") snapshot.error = message;
    if (outputTail !== undefined) snapshot.outputTail = outputTail;
    await writeSnapshotAtomic(snapshot);
  }

  function finish(
    status: Exclude<RunStatus, "idle" | "running">,
    message: string,
    outputTail?: string
  ): Promise<void> {
    return withLock(() => finishRaw(status, message, outputTail));
  }

  /** Terminal fallback used by the API parent process if the child exits early. */
  async function markProcessFinishedRaw(input: {
    runId: string;
    ok: boolean;
    message: string;
    outputTail?: string;
    /** Override the terminal status — e.g. a user-initiated cancel. */
    status?: "failed" | "cancelled";
  }): Promise<void> {
    const snapshot = await readStatus();
    if (!snapshot || snapshot.runId !== input.runId) return;

    if (snapshot.status === "running") {
      const cancelled = input.status === "cancelled";
      await recordRaw({
        runId: input.runId,
        step: cancelled ? "process-cancelled" : input.ok ? "process-completed" : "process-failed",
        label: cancelled ? "Process cancelled" : input.ok ? "Process completed" : "Process failed",
        status: cancelled ? "cancelled" : input.ok ? "completed" : "failed",
        message: input.message,
      });
    }

    const latest = await readStatus();
    if (!latest || latest.runId !== input.runId) return;
    if (latest.status === "running") {
      latest.status = input.status ?? (input.ok ? "completed" : "failed");
      latest.finishedAt = new Date().toISOString();
      latest.updatedAt = latest.finishedAt;
      latest.currentStep = undefined;
      latest.currentLabel = undefined;
      latest.currentFile = undefined;
      latest.currentSlug = undefined;
      if (input.status === "cancelled" || !input.ok) latest.error = input.message;
    }
    if (input.outputTail !== undefined) latest.outputTail = input.outputTail;
    await writeSnapshotAtomic(latest);
  }

  function markProcessFinished(input: {
    runId: string;
    ok: boolean;
    message: string;
    outputTail?: string;
    status?: "failed" | "cancelled";
  }): Promise<void> {
    return withLock(() => markProcessFinishedRaw(input));
  }

  return {
    start,
    resume,
    record,
    update,
    runStep,
    finish,
    markProcessFinished,
    readStatus,
    readEffectiveStatus,
    createRunId,
  };
}
