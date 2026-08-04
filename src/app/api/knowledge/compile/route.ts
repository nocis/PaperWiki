import { spawn } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import {
  createKnowledgeRunId,
  isStaleRunning,
  KNOWLEDGE_PROGRESS_LOG,
  KNOWLEDGE_STATUS_PATH,
  markKnowledgeProcessFinished,
  readEffectiveKnowledgeStatus,
  readKnowledgeStatus,
  startKnowledgeRun,
  type KnowledgeRunSnapshot,
} from "@/lib/runs";
import { resolveProvider, resolveModel, type LLMProviderDef } from "@/lib/llm";
import * as path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_OUTPUT_CHARS = 200_000;

type KnowledgeResult = {
  ok: boolean;
  exitCode: number | null;
  output: string;
};

type ActiveKnowledge = {
  runId: string;
  promise: Promise<KnowledgeResult>;
};

declare global {
  // Shared across route module reloads in dev to prevent concurrent compiles.
  // eslint-disable-next-line no-var
  var __paperwikiKnowledge: ActiveKnowledge | undefined;
}

function appendOutput(current: string, chunk: Buffer | string): string {
  return (current + chunk.toString()).slice(-MAX_OUTPUT_CHARS);
}

function runKnowledgeCompile(runId: string, provider: string, model: string): Promise<KnowledgeResult> {
  return new Promise((resolve) => {
    const tsx = path.join(process.cwd(), "node_modules", ".bin", "tsx");
    const child = spawn(tsx, ["scripts/compile-knowledge.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PAPERWIKI_KNOWLEDGE_RUN_ID: runId,
        WIKI_LLM_PROVIDER: provider,
        WIKI_LLM_MODEL: model,
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

function runningSnapshot(runId: string): KnowledgeRunSnapshot {
  const now = new Date().toISOString();
  return {
    runId,
    status: "running",
    source: "ui",
    startedAt: now,
    updatedAt: now,
    totals: { pieces: 0, articles: 0, compiled: 0, failed: 0 },
    events: [],
  };
}

/** GET /api/knowledge/compile — latest knowledge-compile run status for polling. */
export async function GET() {
  const active = globalThis.__paperwikiKnowledge;
  const snapshot = await readEffectiveKnowledgeStatus();
  const status = active && snapshot?.runId !== active.runId ? runningSnapshot(active.runId) : snapshot;

  return NextResponse.json({
    status: status ?? {
      runId: null,
      status: "idle",
      totals: { pieces: 0, articles: 0, compiled: 0, failed: 0 },
      events: [],
    },
    progressLog: KNOWLEDGE_PROGRESS_LOG,
    statusFile: KNOWLEDGE_STATUS_PATH,
  });
}

/** POST /api/knowledge/compile — start a from-zero knowledge compile in the background. */
export async function POST(request: NextRequest) {
  if (globalThis.__paperwikiKnowledge) {
    return NextResponse.json({ error: "knowledge compile is already running" }, { status: 409 });
  }

  // A stale "running" snapshot from a dead run must not block a new one.
  const staleSnapshot = isStaleRunning(await readKnowledgeStatus()) ? await readKnowledgeStatus() : null;
  if (staleSnapshot) {
    await markKnowledgeProcessFinished({
      runId: staleSnapshot.runId,
      ok: false,
      message: "Previous knowledge compile was interrupted (server restarted mid-run).",
    });
  }

  let providerId: string | undefined;
  let modelOverride: string | undefined;
  try {
    const body = (await request.json()) as { provider?: unknown; model?: unknown };
    providerId = typeof body.provider === "string" && body.provider.length > 0 ? body.provider : undefined;
    modelOverride = typeof body.model === "string" && body.model.length > 0 ? body.model : undefined;
  } catch {
    /* POST without a body is allowed — use env/default configuration */
  }

  let provider: LLMProviderDef;
  try {
    provider = resolveProvider(providerId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown provider" },
      { status: 400 }
    );
  }
  if (!process.env[provider.apiKeyEnv]) {
    return NextResponse.json(
      {
        error: `${provider.apiKeyEnv} is not set. Add it to .env.local and restart the server.`,
        kind: "missing-key",
      },
      { status: 503 }
    );
  }

  const model = resolveModel(provider, modelOverride);
  const runId = createKnowledgeRunId();
  await startKnowledgeRun({ runId, source: "ui", provider: provider.id, model });

  const compilePromise = runKnowledgeCompile(runId, provider.id, model);
  const active: ActiveKnowledge = { runId, promise: compilePromise };
  globalThis.__paperwikiKnowledge = active;

  void compilePromise
    .then(async (result) => {
      await markKnowledgeProcessFinished({
        runId,
        ok: result.ok,
        message: result.ok
          ? "Knowledge compiler process exited successfully."
          : `Knowledge compiler process exited with code ${result.exitCode ?? "unknown"}.`,
        outputTail: result.output,
      });
    })
    .catch((err) => {
      console.error("failed to finalize knowledge compile progress", err);
    })
    .finally(() => {
      if (globalThis.__paperwikiKnowledge === active) {
        globalThis.__paperwikiKnowledge = undefined;
      }
    });

  return NextResponse.json(
    {
      ok: true,
      runId,
      status: "running",
      progressLog: ".log/knowledge-progress.jsonl",
      statusFile: ".log/knowledge-status.json",
    },
    { status: 202 }
  );
}
