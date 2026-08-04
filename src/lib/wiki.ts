/**
 * Wiki storage layer: paths, frontmatter I/O, db derivation, index/log/proposals.
 *
 * Source of truth: markdown files under wiki/ (frontmatter + body).
 * data/wiki-db.json is a DERIVED index for the web app — rebuilt by scanning
 * wiki pages, never hand-edited.
 */
import matter from "gray-matter";
import type { Dirent } from "fs";
import * as fs from "fs/promises";
import * as path from "path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const ROOT = process.cwd();
export const PAPERS_NEW = path.join(ROOT, "papers", "new");
export const PAPERS_COMPILED = path.join(ROOT, "papers", "compiled");
export const PAPERS_DUPLICATES = path.join(ROOT, "papers", "duplicates");
export const COMMENTS_DIR = path.join(ROOT, "comments");
export const WIKI_DIR = path.join(ROOT, "wiki");
export const WIKI_PAPERS_DIR = path.join(WIKI_DIR, "papers");
export const WIKI_TOPICS_DIR = path.join(WIKI_DIR, "topics");
export const WIKI_CONCEPTS_DIR = path.join(WIKI_DIR, "concepts");
export const INDEX_MD = path.join(WIKI_DIR, "index.md");
export const LOG_MD = path.join(WIKI_DIR, "log.md");
export const PROPOSALS_MD = path.join(WIKI_DIR, "proposals.md");
export const DB_PATH = path.join(ROOT, "data", "wiki-db.json");

export async function ensureDirs(): Promise<void> {
  for (const dir of [
    PAPERS_NEW,
    PAPERS_COMPILED,
    COMMENTS_DIR,
    WIKI_PAPERS_DIR,
    WIKI_TOPICS_DIR,
    WIKI_CONCEPTS_DIR,
    path.dirname(DB_PATH),
  ]) {
    await fs.mkdir(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TopicMode = "standalone" | "merged" | "split";

export interface PaperFrontmatter {
  slug: string;
  title: string;
  authors: string[];
  venue: string;
  publishedAt: string; // YYYY-MM
  tags: string[];
  milestone: string; // topic slug
  subtopic: string | null;
  numPages: number;
  addedAt: string; // ISO date
  rawPath: string; // papers/compiled/<slug>.pdf
  pdfUrl: string; // /pdfs/<slug>.pdf
  figures: string[]; // extracted figure filenames, e.g. ["figure_1.png"]
  cites: string[]; // paper slugs
  citedBy: string[]; // paper slugs
}

export interface TopicFrontmatter {
  slug: string;
  name: string;
  definition: string;
  mode: TopicMode;
  parent_milestone: string | null;
  children: string[];
  subtopics: string[];
  tags: string[];
}

export interface PaperPage {
  fm: PaperFrontmatter;
  body: string;
  filePath: string;
}

export interface TopicPage {
  fm: TopicFrontmatter;
  body: string;
  filePath: string; // absolute
  relPath: string; // relative to wiki/topics, e.g. "parent/child.md"
}

export interface DbPaper {
  slug: string;
  title: string;
  authors: string[];
  venue: string;
  publishedAt: string;
  tags: string[];
  milestone: string;
  subtopic: string | null;
  numPages: number;
  addedAt: string;
  url: string;
  essence: string; // first paragraph of ## Essence, for cards/one-liners
  figures: string[]; // figure filenames, derived from frontmatter
  cites: string[];
  citedBy: string[];
}

export interface DbTopic {
  slug: string;
  name: string;
  definition: string;
  mode: TopicMode;
  parentSlug: string | null;
  children: string[];
  subtopics: string[];
  tags: string[];
  sources: string[]; // paper slugs, derived
  path: string; // md path relative to wiki/, e.g. topics/parent/child.md
}

export interface Proposal {
  status: "pending" | "applied" | "rejected";
  date: string;
  type: string; // promote-subtopic | split-topic | tag-to-parent
  topic: string;
  subtopic: string | null;
  reason: string;
}

export interface WikiDb {
  version: 1;
  updatedAt: string | null;
  topics: DbTopic[];
  papers: DbPaper[];
  proposals: Proposal[];
}

export interface LogEntry {
  date: string;
  operation: string;
  title: string;
  details: string[];
}

// ---------------------------------------------------------------------------
// Slugs & text helpers
// ---------------------------------------------------------------------------

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  let slug = base || "paper";
  let n = 2;
  while (taken.has(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Wiki page I/O
// ---------------------------------------------------------------------------

async function listMarkdownFiles(dir: string, recursive: boolean): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) {
      files.push(...(await listMarkdownFiles(full, true)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

export async function readPaperPages(): Promise<PaperPage[]> {
  const files = await listMarkdownFiles(WIKI_PAPERS_DIR, false);
  const pages: PaperPage[] = [];
  for (const filePath of files) {
    const parsed = matter(await fs.readFile(filePath, "utf8"));
    pages.push({ fm: parsed.data as PaperFrontmatter, body: parsed.content, filePath });
  }
  return pages;
}

export async function readTopicPages(): Promise<TopicPage[]> {
  const files = await listMarkdownFiles(WIKI_TOPICS_DIR, true);
  const pages: TopicPage[] = [];
  for (const filePath of files) {
    const parsed = matter(await fs.readFile(filePath, "utf8"));
    pages.push({
      fm: parsed.data as TopicFrontmatter,
      body: parsed.content,
      filePath,
      relPath: path.relative(WIKI_TOPICS_DIR, filePath),
    });
  }
  return pages;
}

export async function writePage(filePath: string, frontmatter: object, body: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, matter.stringify(body.trim() + "\n", frontmatter));
}

// ---------------------------------------------------------------------------
// DB derivation (with invariant validation)
// ---------------------------------------------------------------------------

function firstParagraphOfSection(body: string, heading: string): string {
  const re = new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |$)`, "m");
  const match = body.match(re);
  if (!match) return "";
  return match[1].split(/\n\s*\n/)[0].trim();
}

export async function deriveDb(): Promise<WikiDb> {
  const [paperPages, topicPages, proposals] = await Promise.all([
    readPaperPages(),
    readTopicPages(),
    readProposals(),
  ]);

  const topicSlugs = new Set(topicPages.map((t) => t.fm.slug));
  const paperSlugs = new Set(paperPages.map((p) => p.fm.slug));

  const errors: string[] = [];

  // Invariant: every paper's milestone (and subtopic) must exist.
  for (const p of paperPages) {
    if (!topicSlugs.has(p.fm.milestone)) {
      errors.push(`paper "${p.fm.slug}" has milestone "${p.fm.milestone}" which is not a topic`);
    }
    const parent = topicPages.find((t) => t.fm.slug === p.fm.milestone);
    if (p.fm.subtopic && parent && !parent.fm.subtopics.includes(p.fm.subtopic)) {
      errors.push(
        `paper "${p.fm.slug}" claims subtopic "${p.fm.subtopic}" not listed in topic "${parent.fm.slug}"`
      );
    }
  }

  // Invariant: parent/child bidirectionality + depth <= 3.
  const depthOf = (slug: string, seen: Set<string> = new Set()): number => {
    if (seen.has(slug)) return 99; // cycle guard
    const t = topicPages.find((tp) => tp.fm.slug === slug);
    if (!t || !t.fm.parent_milestone) return 1;
    return 1 + depthOf(t.fm.parent_milestone, new Set([...seen, slug]));
  };
  for (const t of topicPages) {
    if (t.fm.parent_milestone) {
      const parent = topicPages.find((tp) => tp.fm.slug === t.fm.parent_milestone);
      if (!parent) {
        errors.push(`topic "${t.fm.slug}" has parent_milestone "${t.fm.parent_milestone}" which does not exist`);
      } else if (!parent.fm.children.includes(t.fm.slug)) {
        errors.push(`topic "${t.fm.slug}" claims parent "${parent.fm.slug}" but is not in its children[]`);
      }
    }
    for (const child of t.fm.children) {
      const childPage = topicPages.find((tp) => tp.fm.slug === child);
      if (!childPage) {
        errors.push(`topic "${t.fm.slug}" lists child "${child}" which does not exist`);
      } else if (childPage.fm.parent_milestone !== t.fm.slug) {
        errors.push(`topic "${t.fm.slug}" lists child "${child}" whose parent_milestone is "${childPage.fm.parent_milestone}"`);
      }
    }
    if (depthOf(t.fm.slug) > 3) {
      errors.push(`topic "${t.fm.slug}" exceeds max depth 3`);
    }
  }

  // Invariant: cites/citedBy bidirectionality.
  for (const p of paperPages) {
    for (const target of p.fm.cites) {
      if (!paperSlugs.has(target)) {
        errors.push(`paper "${p.fm.slug}" cites unknown paper "${target}"`);
        continue;
      }
      const targetPage = paperPages.find((tp) => tp.fm.slug === target)!;
      if (!targetPage.fm.citedBy.includes(p.fm.slug)) {
        errors.push(`paper "${p.fm.slug}" cites "${target}" but is not in its citedBy[]`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`wiki invariant violations:\n- ${errors.join("\n- ")}`);
  }

  const topics: DbTopic[] = topicPages.map((t) => ({
    slug: t.fm.slug,
    name: t.fm.name,
    definition: t.fm.definition,
    mode: t.fm.mode,
    parentSlug: t.fm.parent_milestone,
    children: t.fm.children,
    subtopics: t.fm.subtopics,
    tags: t.fm.tags ?? [],
    sources: paperPages.filter((p) => p.fm.milestone === t.fm.slug).map((p) => p.fm.slug),
    path: path.relative(WIKI_DIR, t.filePath),
  }));

  const papers: DbPaper[] = paperPages.map((p) => ({
    slug: p.fm.slug,
    title: p.fm.title,
    authors: p.fm.authors,
    venue: p.fm.venue,
    publishedAt: p.fm.publishedAt,
    tags: p.fm.tags ?? [],
    milestone: p.fm.milestone,
    subtopic: p.fm.subtopic,
    numPages: p.fm.numPages,
    addedAt: p.fm.addedAt,
    url: p.fm.pdfUrl,
    essence: firstParagraphOfSection(p.body, "Essence"),
    figures: p.fm.figures ?? [],
    cites: p.fm.cites,
    citedBy: p.fm.citedBy,
  }));

  const db: WikiDb = {
    version: 1,
    updatedAt: new Date().toISOString(),
    topics: topics.sort((a, b) => a.slug.localeCompare(b.slug)),
    papers: papers.sort((a, b) => a.addedAt.localeCompare(b.addedAt)),
    proposals,
  };
  return db;
}

export async function writeDbAtomic(db: WikiDb): Promise<void> {
  const tmp = `${DB_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2) + "\n");
  await fs.rename(tmp, DB_PATH);
}

export async function loadDb(): Promise<WikiDb> {
  try {
    return JSON.parse(await fs.readFile(DB_PATH, "utf8")) as WikiDb;
  } catch {
    return { version: 1, updatedAt: null, topics: [], papers: [], proposals: [] };
  }
}

// ---------------------------------------------------------------------------
// index.md / log.md / proposals.md
// ---------------------------------------------------------------------------

export async function regenIndex(db: WikiDb, language = "en"): Promise<void> {
  const topicBySlug = new Map(db.topics.map((t) => [t.slug, t]));
  const lines: string[] = [];

  const renderTopic = (slug: string, indent: number): void => {
    const t = topicBySlug.get(slug);
    if (!t) return;
    const pad = "  ".repeat(indent);
    lines.push(`${pad}- [[${t.slug}]] — ${t.definition} (${t.sources.length} paper${t.sources.length === 1 ? "" : "s"})`);
    for (const child of t.children) renderTopic(child, indent + 1);
  };

  lines.push("# PaperWiki Index", "", "## Topics", "");
  const roots = db.topics.filter((t) => !t.parentSlug);
  if (roots.length === 0) lines.push("_No topics yet._");
  for (const root of roots) renderTopic(root.slug, 0);

  lines.push("", "## Papers", "");
  if (db.papers.length === 0) lines.push("_No papers yet._");
  for (const p of db.papers) {
    lines.push(`- [[${p.slug}]] — "${p.title}" (${p.venue}, ${p.publishedAt}) → topic [[${p.milestone}]]`);
  }

  const frontmatter = { type: "index", wiki_language: language, last_updated: today() };
  await fs.writeFile(INDEX_MD, matter.stringify(lines.join("\n") + "\n", frontmatter));
}

export async function appendLog(operation: string, title: string, details: string[] = []): Promise<void> {
  const entry = [`## [${today()}] ${operation} | ${title}`, ...details.map((d) => `- ${d}`), ""].join("\n");
  await fs.appendFile(LOG_MD, "\n" + entry);
}

export async function readLog(): Promise<LogEntry[]> {
  let content: string;
  try {
    content = await fs.readFile(LOG_MD, "utf8");
  } catch {
    return [];
  }

  const entries: LogEntry[] = [];
  const header = /^## \[([^\]]+)\] ([^|]+) \| (.+)$/;
  let current: LogEntry | null = null;
  for (const line of content.split("\n")) {
    const match = line.trim().match(header);
    if (match) {
      if (current) entries.push(current);
      current = { date: match[1], operation: match[2].trim(), title: match[3].trim(), details: [] };
    } else if (current && line.trim().startsWith("- ")) {
      current.details.push(line.trim().slice(2));
    }
  }
  if (current) entries.push(current);
  return entries.reverse();
}

const PROPOSAL_RE = /^- \[(pending|applied|rejected)\] (\d{4}-\d{2}-\d{2}) \| ([^|]+) \| topic: ([^|]+) \| subtopic: ([^|]+) \| reason: (.*)$/;

export async function readProposals(): Promise<Proposal[]> {
  let content: string;
  try {
    content = await fs.readFile(PROPOSALS_MD, "utf8");
  } catch {
    return [];
  }
  const proposals: Proposal[] = [];
  for (const line of content.split("\n")) {
    const m = line.trim().match(PROPOSAL_RE);
    if (m) {
      proposals.push({
        status: m[1] as Proposal["status"],
        date: m[2],
        type: m[3].trim(),
        topic: m[4].trim(),
        subtopic: m[5].trim() === "-" ? null : m[5].trim(),
        reason: m[6].trim(),
      });
    }
  }
  return proposals;
}

export async function appendProposal(p: Omit<Proposal, "status" | "date">): Promise<void> {
  const line = `- [pending] ${today()} | ${p.type} | topic: ${p.topic} | subtopic: ${p.subtopic ?? "-"} | reason: ${p.reason}\n`;
  await fs.appendFile(PROPOSALS_MD, line);
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

/** Recursively find PDFs in papers/new/ (handles nested drops). */
export async function findInboxPdfs(): Promise<string[]> {
  const walk = async (dir: string): Promise<string[]> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...(await walk(full)));
      else if (e.isFile() && e.name.toLowerCase().endsWith(".pdf")) out.push(full);
    }
    return out;
  };
  return walk(PAPERS_NEW);
}

/** Hard gate: verify a PDF basename is gone from the inbox (any depth). */
export async function assertRemovedFromInbox(basename: string): Promise<void> {
  const remaining = await findInboxPdfs();
  if (remaining.some((f) => path.basename(f) === basename)) {
    throw new Error(`hard gate failed: "${basename}" is still present in papers/new/`);
  }
}
