import { NextRequest, NextResponse } from "next/server";
import { errorMessage } from "@/lib/errors";
import { resolveModel, resolveProvider, type LLMProviderDef } from "@/lib/llm";
import {
  listDiagramJobs,
  readDiagramLogs,
  readPaperKnowledgeStatus,
  setDiagramPlanEntry,
  setPaperKnowledgeEntry,
  spawnPaperKnowledgeAmend,
  startDiagramJob,
} from "@/lib/paper-knowledge";
import { DIAGRAM_ID_RE, SLUG_RE } from "@/lib/wiki-ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** True while an amend job child is alive. */
function amendRunning(): boolean {
  const g = globalThis as Record<string, unknown>;
  const active = g.__paperwikiPaperKnowledge as { settled?: boolean } | undefined;
  return active !== undefined && active.settled !== true;
}

/**
 * GET /api/paper-knowledge — per-paper Paper Knowledge status. Used by the
 * paper page (?slug=) and the health panel (all entries).
 */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");
  // Diagram render status poll (in-session background jobs). Branches early so
  // the cheap poll never reads the Paper Knowledge amend status file.
  if (request.nextUrl.searchParams.get("diagram-jobs") === "1") {
    return NextResponse.json({ jobs: listDiagramJobs(slug ?? undefined) });
  }
  // Render provenance logs for the health page (raw responses, executed code).
  if (request.nextUrl.searchParams.get("diagram-logs") === "1") {
    return NextResponse.json({ logsBySlug: await readDiagramLogs() });
  }
  const status = await readPaperKnowledgeStatus();
  const active = amendRunning();
  if (slug) {
    const entry = status.entries.find((e) => e.slug === slug);
    return NextResponse.json({ entry: entry ?? null, active });
  }
  return NextResponse.json({ entries: status.entries, active });
}

/**
 * POST /api/paper-knowledge — three actions:
 * - { action: "retry", slug }: re-run the AMEND for a FAILED paper only. A
 *   ready block is terminal (never regenerated without a recompile); retry is
 *   the sole regenerate affordance and it only exists for failed slugs.
 * - { action: "retry-diagrams", slug }: re-run ONLY the diagram-plan pass for
 *   a paper whose amend is ready but whose diagramPlan phase failed. The
 *   amend status stays untouched.
 * - { action: "render-diagram", slug, id }: render (or reuse the cached) SVG
 *   for a paper diagram brief. Click-driven, cached by brief hash.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("invalid JSON body");
  }

  let provider: LLMProviderDef;
  try {
    provider = resolveProvider(typeof body.provider === "string" && body.provider ? body.provider : undefined);
  } catch (err) {
    return bad(errorMessage(err), 400);
  }
  if (!process.env[provider.apiKeyEnv]) {
    return bad(`${provider.apiKeyEnv} is not set. Add it to .env.local and restart the server.`, 503);
  }
  const model = resolveModel(provider, typeof body.model === "string" && body.model ? body.model : undefined);

  const action =
    body.action === "retry"
      ? "retry"
      : body.action === "retry-diagrams"
        ? "retry-diagrams"
        : body.action === "render-diagram"
          ? "render-diagram"
          : null;
  if (!action) return bad("action must be \"retry\", \"retry-diagrams\" or \"render-diagram\"");
  const slug = typeof body.slug === "string" ? body.slug : "";
  if (!SLUG_RE.test(slug)) return bad("invalid slug");

  if (action === "retry" || action === "retry-diagrams") {
    const status = await readPaperKnowledgeStatus();
    const entry = status.entries.find((e) => e.slug === slug);
    if (action === "retry") {
      if (!entry || entry.status !== "failed") {
        return bad(`retry is only available for failed papers ("${slug}" is ${entry ? entry.status : "not tracked"})`, 409);
      }
      // Retries are allowed WHILE another paper's amend is running: the runner
      // drains pending entries and claims them atomically (no double-processing),
      // so a concurrently spawned runner is safe.
      await setPaperKnowledgeEntry(slug, "pending");
    } else {
      if (!entry || entry.status !== "ready" || entry.diagramPlan !== "failed") {
        return bad(
          `retry-diagrams is only available when the amend is ready and the diagram plan failed ("${slug}" is ${entry ? entry.status : "not tracked"}, plan ${entry?.diagramPlan ?? "n/a"})`,
          409
        );
      }
      await setDiagramPlanEntry(slug, "pending");
    }
    const runId = await spawnPaperKnowledgeAmend(provider, model, { force: true });
    return NextResponse.json({ ok: true, runId, status: "running" }, { status: 202 });
  }

  // render-diagram — enqueue (or reuse) a background render and return 202
  // immediately; the LLM call runs as an in-process promise and its status is
  // polled via GET ?diagram-jobs=1. Never block the POST on the LLM (≤300s).
  const id = typeof body.id === "string" ? body.id : "";
  if (!DIAGRAM_ID_RE.test(id)) return bad("invalid diagram id");
  const job = startDiagramJob({ slug, id, provider, model });
  return NextResponse.json(
    { ok: true, status: job.status, key: job.key, slug: job.slug, id: job.id, error: job.error },
    { status: 202 }
  );
}
