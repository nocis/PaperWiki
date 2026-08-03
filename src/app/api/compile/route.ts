import { spawn } from "child_process";
import { NextResponse } from "next/server";
import {
  COMPILE_STEP_CATALOG,
  createCompileRunId,
  markCompileProcessFinished,
  readCompileStatus,
  startCompileRun,
  type CompileRunSnapshot,
} from "@/lib/compile-progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_OUTPUT_CHARS = 200_000;

type CompileResult = {
  ok: boolean;
  exitCode: number | null;
  output: string;
};

type ActiveCompile = {
  runId: string;
  promise: Promise<CompileResult>;
};

declare global {
  // Shared across route module reloads in dev to prevent concurrent compiles.
  // eslint-disable-next-line no-var
  var __paperwikiCompile: ActiveCompile | undefined;
}

function appendOutput(current: string, chunk: Buffer | string): string {
  return (current + chunk.toString()).slice(-MAX_OUTPUT_CHARS);
}

function runCompile(runId: string): Promise<CompileResult> {
  return new Promise((resolve) => {
    const child = spawn("yarn", ["compile"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PAPERWIKI_COMPILE_RUN_ID: runId,
        PAPERWIKI_COMPILE_SOURCE: "ui",
      },
      shell: process.platform === "win32",
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      output = appendOutput(output, chunk);
    });
    child.stderr.on("data", (chunk) => {
      output = appendOutput(output, chunk);
    });
    child.on("error", (err) => {
      resolve({ ok: false, exitCode: null, output: appendOutput(output, `${err.message}\n`) });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, exitCode: code, output });
    });
  });
}

function runningSnapshot(runId: string): CompileRunSnapshot {
  const now = new Date().toISOString();
  return {
    runId,
    status: "running",
    source: "ui",
    startedAt: now,
    updatedAt: now,
    totals: { papers: 0, compiled: 0, duplicates: 0, failed: 0 },
    events: [],
  };
}

/** GET /api/compile — latest persistent compile-run status for dashboard polling. */
export async function GET() {
  const active = globalThis.__paperwikiCompile;
  const snapshot = await readCompileStatus();
  const status = active && snapshot?.runId !== active.runId ? runningSnapshot(active.runId) : snapshot;

  return NextResponse.json({
    status: status ?? {
      runId: null,
      status: "idle",
      totals: { papers: 0, compiled: 0, duplicates: 0, failed: 0 },
      events: [],
    },
    stepCatalog: COMPILE_STEP_CATALOG,
    progressLog: "data/compile-progress.jsonl",
    statusFile: "data/compile-status.json",
  });
}

/** POST /api/compile — start the fixed `yarn compile` command in the background. */
export async function POST() {
  if (globalThis.__paperwikiCompile) {
    return NextResponse.json({ error: "compile is already running" }, { status: 409 });
  }

  const runId = createCompileRunId();
  await startCompileRun({ runId, source: "ui" });

  const compilePromise = runCompile(runId);
  const active: ActiveCompile = { runId, promise: compilePromise };
  globalThis.__paperwikiCompile = active;

  void compilePromise
    .then(async (result) => {
      await markCompileProcessFinished({
        runId,
        ok: result.ok,
        message: result.ok
          ? "Compiler process exited successfully."
          : `Compiler process exited with code ${result.exitCode ?? "unknown"}.`,
        outputTail: result.output,
      });
    })
    .catch((err) => {
      console.error("failed to finalize compile progress", err);
    })
    .finally(() => {
      if (globalThis.__paperwikiCompile === active) {
        globalThis.__paperwikiCompile = undefined;
      }
    });

  return NextResponse.json(
    {
      ok: true,
      runId,
      status: "running",
      progressLog: "data/compile-progress.jsonl",
      statusFile: "data/compile-status.json",
    },
    { status: 202 }
  );
}
