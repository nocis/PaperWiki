import { NextRequest, NextResponse } from "next/server";
import * as path from "path";
import {
  createKnowledgeRunId,
  isStaleRunning,
  KNOWLEDGE_PROGRESS_LOG,
  KNOWLEDGE_STATUS_PATH,
  markKnowledgeProcessFinished,
  readEffectiveKnowledgeStatus,
  readKnowledgeStatus,
  startKnowledgeRun,
} from "@/lib/runs";
import { attachJobFinalize, parseProviderRequest, runningSnapshot, spawnJob, type ActiveJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

declare global {
  // Shared across route module reloads in dev to prevent concurrent compiles.
  // eslint-disable-next-line no-var
  var __paperwikiKnowledge: ActiveJob | undefined;
}

const KNOWLEDGE_IDLE_TOTALS = { pieces: 0, articles: 0, compiled: 0, failed: 0 };

/** GET /api/knowledge/compile — latest knowledge-compile run status for polling. */
export async function GET() {
  const active = globalThis.__paperwikiKnowledge;
  const snapshot = await readEffectiveKnowledgeStatus();
  const status = active && snapshot?.runId !== active.runId ? runningSnapshot(active.runId, KNOWLEDGE_IDLE_TOTALS) : snapshot;

  return NextResponse.json({
    status: status ?? {
      runId: null,
      status: "idle",
      totals: KNOWLEDGE_IDLE_TOTALS,
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

  const parsed = await parseProviderRequest(request);
  if (!parsed.ok) return parsed.response;
  const { provider, model } = parsed;

  const runId = createKnowledgeRunId();
  await startKnowledgeRun({ runId, source: "ui", provider: provider.id, model });

  const active = spawnJob({
    runId,
    command: path.join(process.cwd(), "node_modules", ".bin", "tsx"),
    args: ["scripts/compile-knowledge.ts"],
    env: {
      PAPERWIKI_KNOWLEDGE_RUN_ID: runId,
      WIKI_LLM_PROVIDER: provider.id,
      WIKI_LLM_MODEL: model,
    },
    shell: process.platform === "win32",
  });
  globalThis.__paperwikiKnowledge = active;

  attachJobFinalize(active, "__paperwikiKnowledge", "knowledge compile", (result) =>
    markKnowledgeProcessFinished({
      runId,
      ok: result.ok,
      message: result.ok
        ? "Knowledge compiler process exited successfully."
        : `Knowledge compiler process exited with code ${result.exitCode ?? "unknown"}.`,
      outputTail: result.output,
    })
  );

  return NextResponse.json(
    {
      ok: true,
      runId,
      status: "running",
      progressLog: KNOWLEDGE_PROGRESS_LOG,
      statusFile: KNOWLEDGE_STATUS_PATH,
    },
    { status: 202 }
  );
}
