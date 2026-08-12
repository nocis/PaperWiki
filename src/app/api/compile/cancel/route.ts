import { NextResponse } from "next/server";
import { markCompileProcessFinished } from "@/lib/runs";
import type { ActiveCompile } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

declare global {
  // Shared with api/compile/route.ts — the in-memory active compile handle.
  // eslint-disable-next-line no-var
  var __paperwikiCompile: ActiveCompile | undefined;
}

/**
 * POST /api/compile/cancel — stop the running compile. The run is marked
 * "cancelled" (terminal, with a message) BEFORE the child is killed, so the
 * cancelled state wins deterministically over the child's own close-handler.
 * The slot frees immediately: a retry starts even while the process dies.
 */
export async function POST() {
  const active = globalThis.__paperwikiCompile;
  if (!active) {
    return NextResponse.json({ error: "no compile is running" }, { status: 409 });
  }
  const alive =
    !active.settled &&
    active.child.exitCode === null &&
    active.child.signalCode === null;
  if (!alive) {
    return NextResponse.json({ error: "no compile is running" }, { status: 409 });
  }

  await markCompileProcessFinished({
    runId: active.runId,
    ok: false,
    status: "cancelled",
    message: "Compile cancelled by user.",
  });

  active.child.kill("SIGTERM");
  const killTimer = setTimeout(() => {
    if (active.child.exitCode === null) {
      active.child.kill("SIGKILL");
    }
  }, 5000);
  killTimer.unref();

  return NextResponse.json({ ok: true, runId: active.runId, status: "cancelled" });
}
