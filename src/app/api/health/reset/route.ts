import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import {
  PAPERS_COMPILED,
  PAPERS_DUPLICATES,
  PAPERS_NEW,
  WIKI_PAPERS_DIR,
  WIKI_TOPICS_DIR,
  WIKI_CONCEPTS_DIR,
  INDEX_MD,
  LOG_MD,
  PROPOSALS_MD,
  DB_PATH,
  ROOT,
} from "@/lib/wiki";
import { KNOWLEDGE_INDEX_MD, KNOWLEDGE_LOG_MD, readArticles } from "@/lib/knowledge";
import {
  readCitationsStatus,
  readCompileStatus,
  readKnowledgeStatus,
} from "@/lib/runs";
import { appendWikiJournal } from "@/lib/wiki-journal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIRM_TOKEN = "RESET";

const CITATIONS_MAP_PATH = path.join(ROOT, "data", "citations", "map.json");
const LOG_DIR = path.join(ROOT, ".log");

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function isAnyRunActive(): Promise<boolean> {
  const [compile, citations, knowledge] = await Promise.all([
    readCompileStatus(),
    readCitationsStatus(),
    readKnowledgeStatus(),
  ]);
  return (
    compile?.status === "running" ||
    citations?.status === "running" ||
    knowledge?.status === "running"
  );
}

/** Move a PDF into papers/new/ without overwriting an existing file. */
async function moveToInbox(filePath: string, moved: string[], skipped: string[]): Promise<void> {
  const target = path.join(PAPERS_NEW, path.basename(filePath));
  try {
    await fs.access(target);
    skipped.push(path.basename(filePath));
  } catch {
    await fs.rename(filePath, target);
    moved.push(path.basename(filePath));
  }
}

async function listPdfFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".pdf"))
    .map((e) => path.join(dir, e.name));
}

/**
 * POST /api/health/reset — wipe every compiled/generated artifact and return
 * the compiled papers to papers/new/ for a from-zero compile. Requires the
 * body token `{ confirm: "RESET" }`; refuses while any pipeline is running.
 * Kept: papers/new/, wiki/SCHEMA.md, wiki/journal/, knowledge/pieces/,
 * comments/, .env.local.
 */
export async function POST(request: NextRequest) {
  let confirm = "";
  try {
    const body = (await request.json()) as { confirm?: unknown };
    confirm = typeof body.confirm === "string" ? body.confirm : "";
  } catch {
    /* fall through to token check */
  }
  if (confirm !== CONFIRM_TOKEN) {
    return bad(`confirmation token required — send { "confirm": "${CONFIRM_TOKEN}" }`);
  }
  if (await isAnyRunActive()) {
    return bad("a compile/citations/knowledge run is active — wait for it to finish", 409);
  }

  const moved: string[] = [];
  const skipped: string[] = [];
  const removedDirs: string[] = [];
  const removedFiles: string[] = [];

  // 1. Sources back to the inbox (never deleted).
  await fs.mkdir(PAPERS_NEW, { recursive: true });
  for (const filePath of await listPdfFiles(PAPERS_COMPILED)) {
    await moveToInbox(filePath, moved, skipped);
  }
  for (const filePath of await listPdfFiles(PAPERS_DUPLICATES)) {
    await moveToInbox(filePath, moved, skipped);
  }

  // 2. Derived artifacts.
  for (const dir of [PAPERS_COMPILED, WIKI_PAPERS_DIR, WIKI_TOPICS_DIR, WIKI_CONCEPTS_DIR]) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      removedDirs.push(dir);
    } catch {
      /* already gone */
    }
  }
  for (const filePath of [INDEX_MD, LOG_MD, PROPOSALS_MD, DB_PATH, CITATIONS_MAP_PATH, KNOWLEDGE_INDEX_MD, KNOWLEDGE_LOG_MD]) {
    try {
      await fs.rm(filePath, { force: true });
      removedFiles.push(filePath);
    } catch {
      /* already gone */
    }
  }
  // Knowledge layer: wipe derived articles EXCEPT favorited ones (archived
  // human marks — they survive the compile wipe, so they survive the reset).
  const keptFavorites: string[] = [];
  for (const article of await readArticles()) {
    if (article.fm.favorite === true) {
      keptFavorites.push(article.fm.slug);
    } else {
      try {
        await fs.rm(article.filePath, { force: true });
        removedFiles.push(article.filePath);
      } catch {
        /* already gone */
      }
    }
  }

  // 3. Pipeline progress files (.log/*).
  let logEntries;
  try {
    logEntries = await fs.readdir(LOG_DIR);
  } catch {
    logEntries = [];
  }
  for (const name of logEntries) {
    if (/^(compile|citations|knowledge)-(status\.json|progress\.jsonl)$/.test(name)) {
      try {
        await fs.rm(path.join(LOG_DIR, name), { force: true });
        removedFiles.push(path.join(LOG_DIR, name));
      } catch {
        /* already gone */
      }
    }
  }

  await appendWikiJournal("reset", "State reset to zero", [
    `compiled papers moved to papers/new/: ${moved.length > 0 ? moved.join(", ") : "(none)"}`,
    `favorite articles kept: ${keptFavorites.length > 0 ? keptFavorites.join(", ") : "(none)"}`,
    `kept: wiki/SCHEMA.md, wiki/journal/, knowledge/pieces/, comments/`,
  ]);

  return NextResponse.json({
    ok: true,
    movedToInbox: moved,
    skippedInPlace: skipped,
    removedDirs,
    removedFiles,
  });
}
