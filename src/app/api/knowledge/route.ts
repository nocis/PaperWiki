import { NextRequest, NextResponse } from "next/server";
import {
  deletePiece,
  deriveKnowledgeDb,
  pieceSlugBase,
  readPieces,
  uniquePieceSlug,
  updatePiece,
  writePiece,
} from "@/lib/knowledge";
import { readKnowledgeStatus } from "@/lib/runs";
import { loadDb } from "@/lib/wiki";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * GET /api/knowledge — pieces + articles + run status + staleness summary.
 * Stale = the wiki changed OR any piece was added/edited since the last
 * knowledge compile.
 */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");
  if (slug) {
    const pieces = await readPieces();
    const piece = pieces.find((p) => p.fm.slug === slug);
    if (!piece) return bad("piece not found", 404);
    return NextResponse.json({ piece: { ...piece.fm, content: piece.body } });
  }
  const [db, wikiDb, runStatus] = await Promise.all([deriveKnowledgeDb(), loadDb(), readKnowledgeStatus()]);
  const stale =
    db.compiledAt !== null &&
    (db.wikiUpdatedAt !== null &&
      wikiDb.updatedAt !== null &&
      new Date(db.wikiUpdatedAt) < new Date(wikiDb.updatedAt) ||
      db.pieces.some((p) => new Date(p.updatedAt ?? p.addedAt) > new Date(db.compiledAt!)));
  return NextResponse.json({
    pieces: db.pieces,
    articles: db.articles,
    compiledAt: db.compiledAt,
    wikiUpdatedAt: db.wikiUpdatedAt,
    stale,
    runStatus,
    piecesDir: "knowledge/pieces",
    articlesDir: "knowledge/articles",
  });
}

/**
 * POST /api/knowledge — Add-to-knowledge: create a piece from a reading note
 * or a selected chat range. This is the ONLY sanctioned path for user
 * knowledge to enter the pipeline (comments stay quarantined).
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("invalid JSON body");
  }
  const b = body as Record<string, unknown>;
  const kind = b.kind === "chat" ? "chat" : "note";
  const source = typeof b.source === "string" ? b.source.slice(0, 200) : "";
  const content = typeof b.content === "string" ? b.content.trim() : "";
  if (!content) return bad("content (non-empty string) is required");
  const title = typeof b.title === "string" && b.title.trim() ? b.title.trim() : content.slice(0, 80);
  const tags = Array.isArray(b.tags)
    ? (b.tags as unknown[]).filter((t): t is string => typeof t === "string" && t.length > 0).slice(0, 20)
    : [];
  const topics = Array.isArray(b.topics)
    ? (b.topics as unknown[]).filter((t): t is string => typeof t === "string" && t.length > 0).slice(0, 10)
    : [];

  const slug = await uniquePieceSlug(pieceSlugBase(title));
  await writePiece(
    {
      slug,
      kind,
      source: source || (kind === "chat" ? "chat" : "note"),
      addedAt: new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString(),
      tags,
      topics,
    },
    content
  );
  const db = await deriveKnowledgeDb();
  return NextResponse.json({ piece: db.pieces.find((p) => p.slug === slug) ?? null, ok: true }, { status: 201 });
}

/**
 * PATCH /api/knowledge — two piece operations, separate from each other:
 * - edit-content: rewrite the body. Chat pieces only — note pieces are
 *   immutable (delete + re-add is their edit path).
 * - set-topics: update topic hints. Allowed for both kinds.
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
  const op = b.op === "edit-content" ? "edit-content" : b.op === "set-topics" ? "set-topics" : null;
  if (!op) return bad("op must be \"edit-content\" or \"set-topics\"");

  const pieces = await readPieces();
  const piece = pieces.find((p) => p.fm.slug === slug);
  if (!piece) return bad("piece not found", 404);

  if (op === "edit-content") {
    if (piece.fm.kind !== "chat") {
      return bad(`note pieces are immutable — delete and re-add instead (piece "${slug}" is a ${piece.fm.kind})`, 403);
    }
    const content = typeof b.content === "string" ? b.content.trim() : "";
    if (!content) return bad("content (non-empty string) is required");
    await updatePiece(slug, { content });
  } else {
    const topics = Array.isArray(b.topics)
      ? (b.topics as unknown[]).filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim())
      : [];
    await updatePiece(slug, { topics });
  }

  const db = await deriveKnowledgeDb();
  return NextResponse.json({ piece: db.pieces.find((p) => p.slug === slug) ?? null, ok: true });
}

/** DELETE /api/knowledge?slug=<slug> — delete a knowledge piece. */
export async function DELETE(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug") ?? "";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return bad("invalid slug");
  const pieces = await readPieces();
  if (!pieces.some((p) => p.fm.slug === slug)) return bad("piece not found", 404);
  await deletePiece(slug);
  return NextResponse.json({ ok: true });
}
