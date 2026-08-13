/**
 * Knowledge storage layer: pieces (human-owned, Add-to-knowledge only) and
 * derived topic articles (Knowledge Compile only).
 *
 * Source of truth: knowledge/pieces/*.md (frontmatter + body).
 * knowledge/articles/ and knowledge/index.md are DERIVED — regenerated from
 * zero on every Knowledge Compile. The web UI derives its view live from the
 * markdown; no separate db file.
 *
 * Invariants (see wiki/SCHEMA.md — Knowledge layer):
 * - The pipeline never reads comments/; pieces exist only via Add-to-knowledge.
 * - Articles are never hand-edited.
 */
import matter from "gray-matter";
import * as fs from "fs/promises";
import * as path from "path";
import { loadDb, slugify, uniqueSlug, today, type WikiDb } from "./wiki";
import type { KnowledgeRunSnapshot } from "./runs";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const KNOWLEDGE_DIR = path.join(process.cwd(), "knowledge");
export const KNOWLEDGE_PIECES_DIR = path.join(KNOWLEDGE_DIR, "pieces");
export const KNOWLEDGE_ARTICLES_DIR = path.join(KNOWLEDGE_DIR, "articles");
export const KNOWLEDGE_INDEX_MD = path.join(KNOWLEDGE_DIR, "index.md");
export const KNOWLEDGE_LOG_MD = path.join(KNOWLEDGE_DIR, "log.md");

export async function ensureKnowledgeDirs(): Promise<void> {
  for (const dir of [KNOWLEDGE_PIECES_DIR, KNOWLEDGE_ARTICLES_DIR]) {
    await fs.mkdir(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KnowledgePieceFrontmatter {
  slug: string;
  kind: "note" | "chat";
  /** Where the piece came from: comment id (note) or chat-<timestamp> (chat). */
  source: string;
  addedAt: string; // ISO date
  /** ISO date of the last content/topic edit (chat pieces are content-editable). */
  updatedAt: string;
  tags: string[];
  /** Optional topic hints — nudge the clustering; never binding. */
  topics: string[];
}

export interface KnowledgePiece {
  fm: KnowledgePieceFrontmatter;
  body: string;
  filePath: string;
}

export interface KnowledgeArticleFrontmatter {
  slug: string;
  title: string;
  compiledAt: string; // ISO date of the compile run
  pieceSlugs: string[];
  paperSlugs: string[];
  relatedArticles: string[];
  /** User favorite — exempts the article from the compile wipe (archived). */
  favorite?: boolean;
}

export interface KnowledgeArticle {
  fm: KnowledgeArticleFrontmatter;
  body: string;
  filePath: string;
}

interface KnowledgeDb {
  compiledAt: string | null;
  /** wiki-db updatedAt at the time of the last knowledge compile (staleness). */
  wikiUpdatedAt: string | null;
  pieces: {
    slug: string;
    kind: "note" | "chat";
    source: string;
    addedAt: string;
    updatedAt: string;
    tags: string[];
    topics: string[];
    preview: string;
  }[];
  articles: {
    slug: string;
    title: string;
    compiledAt: string;
    definition: string;
    pieceSlugs: string[];
    pieceCount: number;
    paperCount: number;
    relatedArticles: string[];
    favorite: boolean;
  }[];
}

/** Payload view of a knowledge piece — the flat shape the UI renders. */
export type KnowledgePiecePayload = KnowledgeDb["pieces"][number];
/** Payload view of a knowledge article — the flat shape the UI renders. */
export type KnowledgeArticlePayload = KnowledgeDb["articles"][number];

/**
 * Staleness: the wiki changed OR any piece was added/edited since the last
 * knowledge compile. Never compiled (null) => not stale.
 */
export function computeKnowledgeStaleness(db: KnowledgeDb, wikiDb: WikiDb): boolean {
  return (
    db.compiledAt !== null &&
    ((db.wikiUpdatedAt !== null &&
      wikiDb.updatedAt !== null &&
      new Date(db.wikiUpdatedAt) < new Date(wikiDb.updatedAt)) ||
      db.pieces.some((p) => new Date(p.updatedAt ?? p.addedAt) > new Date(db.compiledAt!)))
  );
}

/** Wire contract for the knowledge dashboard payload (API GET + server page). */
export interface KnowledgeApiPayload {
  pieces: KnowledgePiecePayload[];
  articles: KnowledgeArticlePayload[];
  compiledAt: string | null;
  wikiUpdatedAt: string | null;
  stale: boolean;
  runStatus: KnowledgeRunSnapshot | null;
}

// ---------------------------------------------------------------------------
// Piece I/O
// ---------------------------------------------------------------------------

async function listMarkdownFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(path.join(dir, entry.name));
  }
  return files;
}

export async function readPieces(): Promise<KnowledgePiece[]> {
  const files = await listMarkdownFiles(KNOWLEDGE_PIECES_DIR);
  const pieces: KnowledgePiece[] = [];
  for (const filePath of files) {
    const parsed = matter(await fs.readFile(filePath, "utf8"));
    pieces.push({ fm: parsed.data as KnowledgePieceFrontmatter, body: parsed.content.trim(), filePath });
  }
  return pieces.sort((a, b) => String(a.fm.addedAt).localeCompare(String(b.fm.addedAt)));
}

export async function writePiece(
  frontmatter: KnowledgePieceFrontmatter,
  body: string
): Promise<string> {
  await fs.mkdir(KNOWLEDGE_PIECES_DIR, { recursive: true });
  const filePath = path.join(KNOWLEDGE_PIECES_DIR, `${frontmatter.slug}.md`);
  await fs.writeFile(filePath, matter.stringify(body.trim() + "\n", frontmatter));
  return filePath;
}

/** Update an existing piece, preserving identity/provenance; stamps updatedAt. */
export async function updatePiece(slug: string, patch: { content?: string; topics?: string[] }): Promise<KnowledgePiece> {
  const filePath = path.join(KNOWLEDGE_PIECES_DIR, `${slug}.md`);
  const parsed = matter(await fs.readFile(filePath, "utf8"));
  const fm = parsed.data as KnowledgePieceFrontmatter;
  const body = patch.content !== undefined ? patch.content.trim() : parsed.content.trim();
  if (patch.topics !== undefined) {
    fm.topics = [...new Set(patch.topics.filter((t) => t.trim().length > 0))].slice(0, 10);
  }
  fm.updatedAt = new Date().toISOString();
  await writePiece(fm, body);
  return { fm, body, filePath };
}

export async function deletePiece(slug: string): Promise<void> {
  await fs.rm(path.join(KNOWLEDGE_PIECES_DIR, `${slug}.md`), { force: true });
}

export async function readArticles(): Promise<KnowledgeArticle[]> {
  const files = await listMarkdownFiles(KNOWLEDGE_ARTICLES_DIR);
  const articles: KnowledgeArticle[] = [];
  for (const filePath of files) {
    const parsed = matter(await fs.readFile(filePath, "utf8"));
    articles.push({ fm: parsed.data as KnowledgeArticleFrontmatter, body: parsed.content.trim(), filePath });
  }
  return articles.sort((a, b) => a.fm.slug.localeCompare(b.fm.slug));
}

// ---------------------------------------------------------------------------
// Derived db
// ---------------------------------------------------------------------------

function firstParagraphOfSection(body: string, heading: string): string {
  const re = new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |$)`, "m");
  const match = body.match(re);
  if (!match) return "";
  return match[1].split(/\n\s*\n/)[0].trim();
}

export async function deriveKnowledgeDb(): Promise<KnowledgeDb> {
  const [pieces, articles, wikiDb] = await Promise.all([readPieces(), readArticles(), loadDb()]);
  const db: KnowledgeDb = {
    compiledAt: articles.length > 0 ? articles[0].fm.compiledAt : null,
    wikiUpdatedAt: wikiDb.updatedAt,
    pieces: pieces.map((p) => ({
      slug: p.fm.slug,
      kind: p.fm.kind,
      source: p.fm.source,
      addedAt: p.fm.addedAt,
      updatedAt: p.fm.updatedAt ?? p.fm.addedAt,
      tags: p.fm.tags ?? [],
      topics: p.fm.topics ?? [],
      preview: p.body.slice(0, 220),
    })),
    articles: articles.map((a) => ({
      slug: a.fm.slug,
      title: a.fm.title,
      compiledAt: a.fm.compiledAt,
      definition: firstParagraphOfSection(a.body, "Definition"),
      pieceSlugs: a.fm.pieceSlugs,
      pieceCount: a.fm.pieceSlugs.length,
      paperCount: a.fm.paperSlugs.length,
      relatedArticles: a.fm.relatedArticles ?? [],
      favorite: a.fm.favorite === true,
    })),
  };
  return db;
}

// ---------------------------------------------------------------------------
// Derived files: index.md / log.md
// ---------------------------------------------------------------------------
/** Wikipedia-style article navigation (the "knowledge base" home of the tree). */
export async function regenKnowledgeIndex(db: KnowledgeDb, wiki: WikiDb): Promise<void> {
  const lines: string[] = [];
  lines.push("# Knowledge", "");
  lines.push(
    `Your own knowledge, compiled into topic articles and reviewed against the literature wiki (${db.pieces.length} pieces · ${db.articles.length} article${db.articles.length === 1 ? "" : "s"}).`
  );
  lines.push("", "## Articles", "");
  if (db.articles.length === 0) {
    lines.push("_No articles yet — add knowledge pieces, then run a Knowledge Compile._");
  }
  for (const a of db.articles) {
    const pieces = a.pieceSlugs.map((s) => `[[${s}]]`).join(", ");
    lines.push(`- [[${a.slug}]] — ${a.definition} (${a.pieceCount} piece${a.pieceCount === 1 ? "" : "s"}${a.paperCount > 0 ? `, ${a.paperCount} paper${a.paperCount === 1 ? "" : "s"} grounded` : ""})`);
    if (pieces) lines.push(`  - pieces: ${pieces}`);
  }
  lines.push("", "## Pieces", "");
  if (db.pieces.length === 0) {
    lines.push("_No pieces yet — use Add to knowledge on a reading note or chat message._");
  }
  for (const p of db.pieces) {
    lines.push(`- [[${p.slug}]] — (${p.kind}, ${p.addedAt}) ${p.preview}`);
  }
  lines.push("", "## Literature wiki", "");
  const roots = wiki.topics.filter((t) => !t.parentSlug);
  if (roots.length === 0) {
    lines.push("_The wiki has no topics yet._");
  }
  for (const t of roots) {
    lines.push(`- [[${t.slug}]] — ${t.definition}`);
    for (const child of t.children) {
      const childTopic = wiki.topics.find((c) => c.slug === child);
      if (childTopic) lines.push(`  - [[${childTopic.slug}]] — ${childTopic.definition}`);
    }
  }
  lines.push("", "_Regenerated from zero on every Knowledge Compile — do not hand-edit._");
  const frontmatter = { type: "index", last_compiled: db.compiledAt ?? null, last_updated: today() };
  await fs.writeFile(KNOWLEDGE_INDEX_MD, matter.stringify(lines.join("\n") + "\n", frontmatter));
}

export async function appendKnowledgeLog(operation: string, title: string, details: string[] = []): Promise<void> {
  const entry = [`## [${today()}] ${operation} | ${title}`, ...details.map((d) => `- ${d}`), ""].join("\n");
  await fs.mkdir(KNOWLEDGE_DIR, { recursive: true });
  await fs.appendFile(KNOWLEDGE_LOG_MD, "\n" + entry);
}

// ---------------------------------------------------------------------------
// Slug helpers (piece-friendly: longer limit than paper slugs)
// ---------------------------------------------------------------------------

export function pieceSlugBase(input: string): string {
  return slugify(input).slice(0, 100) || `piece-${Date.now()}`;
}

export async function uniquePieceSlug(base: string): Promise<string> {
  const pieces = await readPieces();
  return uniqueSlug(base, new Set(pieces.map((p) => p.fm.slug)));
}
