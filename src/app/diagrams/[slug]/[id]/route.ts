import * as fs from "fs/promises";
import * as path from "path";
import { NextResponse } from "next/server";
import { DIAGRAMS_DIR_FOR } from "@/lib/paper-knowledge";
import { DIAGRAM_ID_RE, SLUG_RE } from "@/lib/wiki-ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /diagrams/<slug>/<id>.svg — serve a cached lazy-rendered diagram SVG. */
export async function GET(_request: Request, { params }: { params: { slug: string; id: string } }) {
  const { slug } = params;
  // The URL is /diagrams/<slug>/<id>.svg — the dynamic segment carries the
  // extension; strip it before validation/file lookup.
  const id = params.id.replace(/\.svg$/i, "");
  if (!SLUG_RE.test(slug) || !DIAGRAM_ID_RE.test(id)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const dir = DIAGRAMS_DIR_FOR(slug);
  const contentPath = path.join(dir, `${id}.svg`);
  if (path.relative(dir, contentPath).startsWith("..")) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const data = await fs.readFile(contentPath);
    return new NextResponse(data, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
