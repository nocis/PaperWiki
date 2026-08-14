import * as fs from "fs/promises";
import * as path from "path";
import { NextResponse } from "next/server";
import { DIAGRAMS_DIR_FOR, type DiagramMeta } from "@/lib/paper-knowledge";
import { DIAGRAM_ID_RE, SLUG_RE } from "@/lib/wiki-ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /diagrams/<slug>/<id>[-<briefHash12>].(svg|mmd) — serve a cached diagram
 * artifact.
 *
 * URLs are content-addressed: the diagram's cache key (brief hash + format +
 * renderer version) rides in the path, so browsers and proxy caches treat a
 * re-render as a brand-new resource. The hash is verified against the CURRENT
 * cache meta — a mismatch means the diagram was re-rendered (brief changed,
 * route switched, or renderer protocol bumped), and the stale content 404s
 * instead of being served for a year. Legacy un-hashed URLs (old tabs/
 * bookmarks) still serve, with a short cache lifetime so clients converge to
 * the hashed URL.
 */
export async function GET(_request: Request, { params }: { params: { slug: string; id: string } }) {
  const { slug } = params;
  // The dynamic segment carries the extension (.svg or .mmd) and, for
  // content-addressed URLs, the -<hash> suffix: strip both before validation.
  const extMatch = params.id.match(/\.(svg|mmd)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : "svg";
  const idWithSuffix = params.id.replace(/\.(?:svg|mmd)$/i, "");
  const suffixMatch = idWithSuffix.match(/^(.+)-([0-9a-f]{12})$/);
  const id = suffixMatch ? suffixMatch[1] : idWithSuffix;
  if (!SLUG_RE.test(slug) || !DIAGRAM_ID_RE.test(id)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const dir = DIAGRAMS_DIR_FOR(slug);
  const contentPath = path.join(dir, `${id}.${ext}`);
  if (path.relative(dir, contentPath).startsWith("..")) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const [data, metaRaw] = await Promise.all([
      fs.readFile(contentPath),
      fs.readFile(path.join(dir, `${id}.meta.json`)).catch(() => null),
    ]);
    let meta: DiagramMeta | null = null;
    if (metaRaw) {
      try {
        meta = JSON.parse(metaRaw.toString("utf8")) as DiagramMeta;
      } catch {
        meta = null;
      }
    }
    if (suffixMatch) {
      // Content-addressed URL: the hash must match the current cache entry.
      if (!meta || meta.briefHash !== suffixMatch[2]) {
        return new NextResponse("Not found", { status: 404 });
      }
      return new NextResponse(data, {
        headers: {
          "Content-Type": ext === "mmd" ? "text/plain; charset=utf-8" : "image/svg+xml",
          // The URL changes whenever the content changes, so this resource is
          // effectively immutable — long caching with zero staleness risk.
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
    // Legacy un-hashed URL: serve, but keep the cache short so clients move
    // to the content-addressed URL on the next page load.
    return new NextResponse(data, {
      headers: {
        "Content-Type": ext === "mmd" ? "text/plain; charset=utf-8" : "image/svg+xml",
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
