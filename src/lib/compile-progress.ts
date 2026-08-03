/**
 * Persistent compile-run progress tracking.
 *
 * .log/compile-progress.jsonl is the append-only event log (source of truth
 * for history). .log/compile-status.json is the atomically-updated latest
 * snapshot consumed by the dashboard.
 */
import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";

const LOG_DIR = path.join(process.cwd(), ".log");
export const COMPILE_PROGRESS_LOG = path.join(LOG_DIR, "compile-progress.jsonl");
export const COMPILE_STATUS_PATH = path.join(LOG_DIR, "compile-status.json");

export type CompileRunStatus = "idle" | "running" | "completed" | "failed";
export type CompileEventStatus = "started" | "completed" | "failed" | "skipped";
export type CompileRunSource = "cli" | "ui";

export interface CompileStepInfo {
  id: string;
  label: string;
}

export const COMPILE_SYSTEM_STEPS: CompileStepInfo[] = [
  { id: "prepare-dirs", label: "Prepare workspace directories" },
  { id: "llm-preflight", label: "Check LLM connectivity" },
  { id: "scan-inbox", label: "Scan papers/new inbox" },
  { id: "consolidation-checks", label: "Check topic consolidation proposals" },
];

export const COMPILE_PAPER_STEPS: CompileStepInfo[] = [
  { id: "load-state", label: "Load current wiki state" },
  { id: "duplicate-check", label: "Check for duplicate paper" },
  { id: "extract-pdf", label: "Extract PDF text" },
  { id: "analyze-paper", label: "Analyze paper with LLM" },
  { id: "resolve-title-slug", label: "Resolve canonical title slug" },
  { id: "classify-topic", label: "Classify topic with LLM" },
  { id: "apply-topic-classification", label: "Apply topic classification" },
  { id: "resolve-citations", label: "Resolve citation links" },
  { id: "write-paper-page", label: "Write paper wiki page" },
  { id: "update-cited-by", label: "Update cited-by links" },
  { id: "synthesize-topic", label: "Synthesize topic with LLM" },
  { id: "write-topic-page", label: "Write topic wiki page" },
  { id: "move-pdf", label: "Move PDF to compiled archive" },
  { id: "create-comments-dir", label: "Create comments directory" },
  { id: "rebuild-derived-files", label: "Rebuild index, log, and database" },
];

export const COMPILE_STEP_CATALOG = {
  system: COMPILE_SYSTEM_STEPS,
  paper: COMPILE_PAPER_STEPS,
};

export interface CompileTotals {
  papers: number;
  compiled: number;
  duplicates: number;
  failed: number;
}

export interface CompileProgressEvent {
  runId: string;
  timestamp: string;
  scope: "run" | "paper" | "process";
  step: string;
  label: string;
  status: CompileEventStatus;
  message?: string;
  durationMs?: number;
  paperIndex?: number;
  paperTotal?: number;
  file?: string;
  slug?: string;
}

export interface CompileRunSnapshot {
  runId: string;
  status: CompileRunStatus;
  source: CompileRunSource;
  model?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  currentStep?: string;
  currentLabel?: string;
  currentFile?: string;
  error?: string;
  totals: CompileTotals;
  events: CompileProgressEvent[];
  outputTail?: string;
}

type EventInput = Omit<CompileProgressEvent, "runId" | "timestamp"> & { runId?: string };

let currentRunId: string | undefined;

export function createCompileRunId(): string {
  return `compile-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

async function writeSnapshotAtomic(snapshot: CompileRunSnapshot): Promise<void> {
  await fs.mkdir(LOG_DIR, { recursive: true });
  const tmp = `${COMPILE_STATUS_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2) + "\n");
  await fs.rename(tmp, COMPILE_STATUS_PATH);
}

async function appendEventLine(event: CompileProgressEvent): Promise<void> {
  await fs.mkdir(LOG_DIR, { recursive: true });
  await fs.appendFile(COMPILE_PROGRESS_LOG, JSON.stringify(event) + "\n");
}

export async function readCompileStatus(): Promise<CompileRunSnapshot | null> {
  try {
    return JSON.parse(await fs.readFile(COMPILE_STATUS_PATH, "utf8")) as CompileRunSnapshot;
  } catch {
    return null;
  }
}

function newSnapshot(runId: string, source: CompileRunSource, model?: string): CompileRunSnapshot {
  const now = new Date().toISOString();
  return {
    runId,
    status: "running",
    source,
    model,
    startedAt: now,
    updatedAt: now,
    totals: { papers: 0, compiled: 0, duplicates: 0, failed: 0 },
    events: [],
  };
}

export async function startCompileRun(input: {
  runId?: string;
  source: CompileRunSource;
  model?: string;
}): Promise<string> {
  const runId = input.runId ?? createCompileRunId();
  currentRunId = runId;
  const snapshot = newSnapshot(runId, input.source, input.model);
  await writeSnapshotAtomic(snapshot);
  await recordCompileEvent({
    runId,
    scope: "run",
    step: "run-started",
    label: "Compile run started",
    status: "started",
    message: input.model ? `Model: ${input.model}` : undefined,
  });
  return runId;
}

export async function recordCompileEvent(input: EventInput): Promise<void> {
  const runId = input.runId ?? currentRunId;
  if (!runId) return;

  let snapshot = await readCompileStatus();
  if (!snapshot || snapshot.runId !== runId) {
    snapshot = newSnapshot(runId, "cli");
  }

  const { runId: _ignored, ...eventInput } = input;
  const event: CompileProgressEvent = {
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
  }
  if (event.status === "failed" && !snapshot.error) {
    snapshot.error = event.message ?? event.label;
  }

  await appendEventLine(event);
  await writeSnapshotAtomic(snapshot);
}

export async function updateCompileRun(patch: {
  totals?: Partial<CompileTotals>;
  model?: string;
  outputTail?: string;
}): Promise<void> {
  if (!currentRunId) return;
  const snapshot = await readCompileStatus();
  if (!snapshot || snapshot.runId !== currentRunId) return;
  if (patch.totals) snapshot.totals = { ...snapshot.totals, ...patch.totals };
  if (patch.model) snapshot.model = patch.model;
  if (patch.outputTail !== undefined) snapshot.outputTail = patch.outputTail;
  snapshot.updatedAt = new Date().toISOString();
  await writeSnapshotAtomic(snapshot);
}

export async function runCompileStep<T>(
  step: string,
  label: string,
  work: () => Promise<T>,
  context: Partial<Pick<CompileProgressEvent, "scope" | "paperIndex" | "paperTotal" | "file" | "slug">> = {}
): Promise<T> {
  const startedAt = Date.now();
  await recordCompileEvent({ scope: "run", ...context, step, label, status: "started" });
  try {
    const result = await work();
    await recordCompileEvent({
      scope: "run",
      ...context,
      step,
      label,
      status: "completed",
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (err) {
    await recordCompileEvent({
      scope: "run",
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

export async function finishCompileRun(
  status: Exclude<CompileRunStatus, "idle" | "running">,
  message: string,
  outputTail?: string
): Promise<void> {
  if (!currentRunId) return;
  await recordCompileEvent({
    scope: "run",
    step: status === "completed" ? "run-completed" : "run-failed",
    label: status === "completed" ? "Compile run completed" : "Compile run failed",
    status: status === "completed" ? "completed" : "failed",
    message,
  });

  const snapshot = await readCompileStatus();
  if (!snapshot || snapshot.runId !== currentRunId) return;
  snapshot.status = status;
  snapshot.finishedAt = new Date().toISOString();
  snapshot.updatedAt = snapshot.finishedAt;
  snapshot.currentStep = undefined;
  snapshot.currentLabel = undefined;
  snapshot.currentFile = undefined;
  if (status === "failed") snapshot.error = message;
  if (outputTail !== undefined) snapshot.outputTail = outputTail;
  await writeSnapshotAtomic(snapshot);
}

/** Terminal fallback used by the API parent process if the child exits early. */
export async function markCompileProcessFinished(input: {
  runId: string;
  ok: boolean;
  message: string;
  outputTail?: string;
}): Promise<void> {
  const snapshot = await readCompileStatus();
  if (!snapshot || snapshot.runId !== input.runId) return;

  if (snapshot.status === "running") {
    await recordCompileEvent({
      runId: input.runId,
      scope: "process",
      step: input.ok ? "compiler-process-completed" : "compiler-process-failed",
      label: input.ok ? "Compiler process completed" : "Compiler process failed",
      status: input.ok ? "completed" : "failed",
      message: input.message,
    });
  }

  const latest = await readCompileStatus();
  if (!latest || latest.runId !== input.runId) return;
  if (latest.status === "running") {
    latest.status = input.ok ? "completed" : "failed";
    latest.finishedAt = new Date().toISOString();
    latest.updatedAt = latest.finishedAt;
    latest.currentStep = undefined;
    latest.currentLabel = undefined;
    latest.currentFile = undefined;
    if (!input.ok) latest.error = input.message;
  }
  if (input.outputTail !== undefined) latest.outputTail = input.outputTail;
  await writeSnapshotAtomic(latest);
}
