import { NextRequest, NextResponse } from "next/server";
import * as path from "path";
import {
  COMPILE_STEP_CATALOG,
  createCompileRunId,
  isStaleRunning,
  markCompileProcessFinished,
  readCompileStatus,
  readEffectiveCompileStatus,
  startCompileRun,
} from "@/lib/runs";
import { attachJobFinalize, parseProviderRequest, runningSnapshot, spawnJob, type ActiveJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMPILE_OUTPUT_LOG = path.join(process.cwd(), ".log", "compile-output.log");

declare global {
  // Shared across route module reloads in dev to prevent concurrent compiles.
  // eslint-disable-next-line no-var
  var __paperwikiCompile: ActiveJob | undefined;
}

const COMPILE_IDLE_TOTALS = { papers: 0, compiled: 0, duplicates: 0, failed: 0 };

/** GET /api/compile — latest persistent compile-run status for dashboard polling. */
export async function GET() {
  const active = globalThis.__paperwikiCompile;
  const snapshot = await readEffectiveCompileStatus();
  // Only a genuinely alive child is reported as "running"; a dead/hung one
  // must surface its persisted (terminal) status instead of a fake running.
  const activeAlive =
    active !== undefined &&
    !active.settled &&
    active.child.exitCode === null &&
    active.child.signalCode === null;
  const status =
    activeAlive && snapshot?.runId !== active.runId ? runningSnapshot(active.runId, COMPILE_IDLE_TOTALS) : snapshot;

  return NextResponse.json({
    status: status ?? {
      runId: null,
      status: "idle",
      totals: COMPILE_IDLE_TOTALS,
      events: [],
    },
    stepCatalog: COMPILE_STEP_CATALOG,
    progressLog: ".log/compile-progress.jsonl",
    statusFile: ".log/compile-status.json",
  });
}

/** POST /api/compile — start the fixed compile command in the background. */
export async function POST(request: NextRequest) {
  // Only a genuinely alive process keeps the slot. A dead/hung child (exited,
  // or never started) must not block retries: formally fail its run if the
  // persisted snapshot still claims "running", then clear and proceed.
  const existingActive = globalThis.__paperwikiCompile;
  if (existingActive) {
    const alive =
      !existingActive.settled &&
      existingActive.child.exitCode === null &&
      existingActive.child.signalCode === null;
    const snapshot = await readCompileStatus();
    const snapshotTerminal = snapshot !== null && snapshot.status !== "running";
    if (alive && !snapshotTerminal) {
      return NextResponse.json({ error: "compile is already running" }, { status: 409 });
    }
    if (!snapshotTerminal) {
      await markCompileProcessFinished({
        runId: existingActive.runId,
        ok: false,
        message: "The previous compile process ended before it could mark the run complete.",
      });
    }
    globalThis.__paperwikiCompile = undefined;
  }

  // A stale "running" snapshot from a dead run must not block a new one.
  const stale = isStaleRunning(await readCompileStatus());
  if (stale) {
    const staleSnapshot = await readCompileStatus();
    await markCompileProcessFinished({
      runId: staleSnapshot!.runId,
      ok: false,
      message: "Previous compile run was interrupted (server restarted mid-run).",
    });
  }

  const parsed = await parseProviderRequest(request);
  if (!parsed.ok) return parsed.response;
  const { provider, model } = parsed;

  const runId = createCompileRunId();
  await startCompileRun({ runId, source: "ui", provider: provider.id, model });

  // Spawn the compiler directly with node --import tsx — no `yarn` indirection
  // (no PATH dependence, works identically on all platforms without a shell).
  const active = spawnJob({
    runId,
    command: process.execPath,
    args: ["--import", "tsx", path.join(process.cwd(), "scripts", "compile.ts")],
    env: {
      PAPERWIKI_COMPILE_RUN_ID: runId,
      PAPERWIKI_COMPILE_SOURCE: "ui",
      WIKI_LLM_PROVIDER: provider.id,
      WIKI_LLM_MODEL: model,
    },
    banner: `\n===== compile run ${runId} @ ${new Date().toISOString()} =====\n`,
    outputLog: COMPILE_OUTPUT_LOG,
    forwardToStdout: true,
  });
  globalThis.__paperwikiCompile = active;

  attachJobFinalize(active, "__paperwikiCompile", "compile", (result) =>
    markCompileProcessFinished({
      runId,
      ok: result.ok,
      message: result.ok
        ? "Compiler process exited successfully."
        : `Compiler process exited with code ${result.exitCode ?? "unknown"}.`,
      outputTail: result.output,
    })
  );

  return NextResponse.json(
    {
      ok: true,
      runId,
      status: "running",
      progressLog: ".log/compile-progress.jsonl",
      statusFile: ".log/compile-status.json",
    },
    { status: 202 }
  );
}
