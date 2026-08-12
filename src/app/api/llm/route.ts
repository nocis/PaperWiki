import { NextResponse } from "next/server";
import { publicCatalog } from "@/lib/llm-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/llm — provider/model catalog, models fetched live from provider APIs.
 * `?refresh=1` bypasses the server-side TTL cache (used after a successful re-check). */
export async function GET(request: Request) {
  try {
    const force = new URL(request.url).searchParams.get("refresh") === "1";
    return NextResponse.json(await publicCatalog(force));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to load model catalog" },
      { status: 502 }
    );
  }
}
