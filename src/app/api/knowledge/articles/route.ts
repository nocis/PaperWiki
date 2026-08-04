import { NextRequest, NextResponse } from "next/server";
import matter from "gray-matter";
import * as fs from "fs/promises";
import * as path from "path";
import { KNOWLEDGE_ARTICLES_DIR } from "@/lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * PATCH /api/knowledge/articles — toggle the favorite flag on a compiled
 * article. Favorited articles survive the next Knowledge Compile wipe.
 */
export async function PATCH(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("invalid JSON body");
  }
  const b = body as Record<string, unknown>;
  const slug = typeof b.slug === "string" ? b.slug : "";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return bad("invalid slug");
  const favorite = b.favorite === true;

  const filePath = path.join(KNOWLEDGE_ARTICLES_DIR, `${slug}.md`);
  if (path.relative(KNOWLEDGE_ARTICLES_DIR, filePath).startsWith("..")) return bad("invalid slug");

  let parsed;
  try {
    parsed = matter(await fs.readFile(filePath, "utf8"));
  } catch {
    return bad("article not found", 404);
  }

  parsed.data.favorite = favorite;
  await fs.writeFile(filePath, matter.stringify(parsed.content, parsed.data));

  return NextResponse.json({ ok: true, slug, favorite });
}
