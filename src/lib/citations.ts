/**
 * Citation Map — the derived source of truth for paper citation links.
 *
 * data/citations/map.json holds, per compiled paper, the reference list the
 * analyze LLM extracted at compile time (rawReferences) plus only the
 * RESOLVED matches: { entry, matchedSlug } pairs pointing at positions in the
 * raw list. No normalization — the raw bibliography is displayed verbatim on
 * the paper page. cites[]/citedBy[] frontmatter, the paper page's
 * ## Citations section, and the citation coverage stats are derived from this
 * map. Rebuilds re-map the persisted rawReferences only — the PDF is never
 * re-read, and matching is LLM-only (an entry the LLM does not resolve stays
 * unlinked; papers never cited are simply left alone).
 */
import * as fs from "fs/promises";
import * as path from "path";
import { llmJson, type LLMProviderDef } from "./llm";
import { citationMapPrompt, type CitationMapResponse } from "./prompts";
import { writePage, type PaperPage } from "./wiki";

export const CITATIONS_DIR = path.join(process.cwd(), "data", "citations");
export const CITATION_MAP_PATH = path.join(CITATIONS_DIR, "map.json");

export interface CitationRecord {
  /** 1-based position of the entry in the paper's raw reference list. */
  entry: number;
  /** Compiled paper slug this entry resolves to. */
  matchedSlug: string;
}

export interface PaperCitationEntry {
  slug: string;
  /** The reference list extracted by the analyze LLM at compile time. */
  rawReferences: string[];
  /** When the entry was last built/refreshed. */
  generatedAt: string;
  /** Provider + model used for the last build. */
  provider: string | null;
  model: string | null;
  /** Resolved matches only: entry position → compiled slug. */
  citations: CitationRecord[];
}

export interface CitationMap {
  version: 1;
  updatedAt: string;
  papers: Record<string, PaperCitationEntry>;
}

// ---------------------------------------------------------------------------
// Map I/O
// ---------------------------------------------------------------------------

export async function readCitationMap(): Promise<CitationMap> {
  try {
    const parsed = JSON.parse(await fs.readFile(CITATION_MAP_PATH, "utf8")) as CitationMap;
    return {
      version: 1,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      papers: parsed.papers ?? {},
    };
  } catch {
    return { version: 1, updatedAt: new Date().toISOString(), papers: {} };
  }
}

async function writeCitationMapAtomic(map: CitationMap): Promise<void> {
  await fs.mkdir(CITATIONS_DIR, { recursive: true });
  const tmp = `${CITATION_MAP_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(map, null, 2) + "\n");
  await fs.rename(tmp, CITATION_MAP_PATH);
}

/** Read-modify-write a single paper's entry (atomic per-paper update). */
export async function updatePaperCitations(
  slug: string,
  input: { rawReferences: string[]; provider: string | null; model: string | null; citations: CitationRecord[] }
): Promise<void> {
  const map = await readCitationMap();
  map.papers[slug] = {
    slug,
    rawReferences: input.rawReferences,
    generatedAt: new Date().toISOString(),
    provider: input.provider,
    model: input.model,
    citations: input.citations,
  };
  map.updatedAt = new Date().toISOString();
  await writeCitationMapAtomic(map);
}

// ---------------------------------------------------------------------------
// Validation & derived helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize raw LLM output into valid Citation Records: entry must be an
 * in-bounds, unique position in the raw list; matchedSlug must be a known
 * compiled slug (never invented, never the paper itself). Everything else is
 * dropped.
 */
export function validateCitationRecords(
  records: unknown,
  rawCount: number,
  knownSlugs: ReadonlySet<string>,
  selfSlug: string
): CitationRecord[] {
  if (!Array.isArray(records)) return [];
  const out: CitationRecord[] = [];
  const seenEntries = new Set<number>();
  for (const record of records) {
    if (typeof record !== "object" || record === null) continue;
    const r = record as Record<string, unknown>;
    const entry = typeof r.entry === "number" ? Math.trunc(r.entry) : NaN;
    const matchedSlug = typeof r.matchedSlug === "string" ? r.matchedSlug.trim() : "";
    if (!Number.isInteger(entry) || entry < 1 || entry > rawCount) continue;
    if (seenEntries.has(entry)) continue;
    if (!matchedSlug || !knownSlugs.has(matchedSlug) || matchedSlug === selfSlug) continue;
    seenEntries.add(entry);
    out.push({ entry, matchedSlug });
  }
  return out.sort((a, b) => a.entry - b.entry);
}

/** Unique, sorted slugs referenced by a paper's resolved matches. */
export function matchedSlugsOf(records: CitationRecord[]): string[] {
  return [...new Set(records.map((r) => r.matchedSlug))].sort();
}

// ---------------------------------------------------------------------------
// Shared remap machinery (used by compile's finalize AND rebuild)
// ---------------------------------------------------------------------------

export interface CitationIndexEntry {
  slug: string;
  title: string;
  publishedAt: string;
}

function citationIndexText(index: CitationIndexEntry[]): string {
  return index.map((p) => `- ${p.slug} — "${p.title}" (${p.publishedAt})`).join("\n");
}

/**
 * The slim citation call: match one paper's persisted raw reference list
 * against the compiled index in ONE LLM call, then persist the map entry and
 * rewrite the page's ## Citations section + cites[] frontmatter. The output is
 * match-only (a few tokens), so no batching is needed. The reference list is
 * the one the analyze LLM extracted at compile time — the PDF is never re-read.
 */
export async function remapPaperCitations(opts: {
  slug: string;
  rawReferences: string[];
  index: CitationIndexEntry[];
  provider: LLMProviderDef;
  model: string;
  pagesBySlug?: Map<string, PaperPage>;
}): Promise<{ records: CitationRecord[]; matched: number; total: number }> {
  const { system, user } = citationMapPrompt({ references: opts.rawReferences, index: citationIndexText(opts.index) });
  const raw = await llmJson<CitationMapResponse>({
    provider: opts.provider,
    model: opts.model,
    system,
    user,
    maxTokens: 4096,
    temperature: 0.1,
  });
  const records = validateCitationRecords(
    raw.citations,
    opts.rawReferences.length,
    new Set(opts.index.map((p) => p.slug)),
    opts.slug
  );

  await updatePaperCitations(opts.slug, {
    rawReferences: opts.rawReferences,
    provider: opts.provider.id,
    model: opts.model,
    citations: records,
  });

  const page = opts.pagesBySlug?.get(opts.slug);
  if (page) {
    const body = replaceCitationsSection(page.body, opts.rawReferences, records);
    page.fm.cites = matchedSlugsOf(records).filter((s) => s !== opts.slug);
    await writePage(page.filePath, page.fm, body);
    page.body = body;
  }

  return { records, matched: records.length, total: opts.rawReferences.length };
}

/** Recompute every paper's citedBy[] from all cites[] (deterministic). Returns change count. */
export async function recomputeCitedBy(pages: PaperPage[]): Promise<number> {
  let changed = 0;
  for (const page of pages) {
    const expected = pages
      .filter((p) => p.fm.cites.includes(page.fm.slug) && p.fm.slug !== page.fm.slug)
      .map((p) => p.fm.slug)
      .sort();
    const current = [...page.fm.citedBy].sort();
    if (current.join("|") === expected.join("|")) continue;
    page.fm.citedBy = expected;
    await writePage(page.filePath, page.fm, page.body);
    changed += 1;
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Markdown rendering (paper page ## Citations section — raw list + link markers)
// ---------------------------------------------------------------------------

/** Strip a leading "[n]"/"n." marker the PDF's bibliography carried — the code-side numbering is authoritative. */
function stripLeadingEntryMarker(raw: string): string {
  return raw.replace(/^\s*(?:\[\d+\]|\d{1,3}[.)])\s+/, "");
}

export function renderCitationsSection(rawReferences: string[], matches: CitationRecord[]): string {
  if (rawReferences.length === 0) {
    return "## Citations\n_No citations extracted._";
  }
  const matchedByEntry = new Map(matches.map((m) => [m.entry, m.matchedSlug]));
  const lines = [
    "## Citations",
    `_${matches.length} of ${rawReferences.length} citations linked to compiled papers._`,
    "",
  ];
  rawReferences.forEach((raw, i) => {
    const entry = i + 1;
    const slug = matchedByEntry.get(entry);
    lines.push(`${entry}. ${stripLeadingEntryMarker(raw)}${slug ? ` → [[${slug}]]` : ""}`);
  });
  return lines.join("\n");
}

const SECTION_HEADING_RE = /^## (Citations|References)\s*\n/m;

/**
 * Replace (or insert) the paper body's citation section. Handles both the new
 * `## Citations` heading and legacy `## References` blocks, and appends before
 * `## Feeds` (or at the end) when neither exists.
 */
export function replaceCitationsSection(body: string, rawReferences: string[], matches: CitationRecord[]): string {
  const section = renderCitationsSection(rawReferences, matches);
  const heading = body.match(SECTION_HEADING_RE);
  if (heading && heading.index !== undefined) {
    const start = heading.index;
    const afterHeading = body.slice(start + heading[0].length);
    const nextHeading = afterHeading.match(/^## /m);
    const end = nextHeading && nextHeading.index !== undefined ? start + heading[0].length + nextHeading.index : body.length;
    return `${body.slice(0, start).replace(/\s+$/, "")}\n\n${section}\n${body.slice(end)}`;
  }
  const feedsIndex = body.indexOf("## Feeds");
  if (feedsIndex !== -1) {
    return `${body.slice(0, feedsIndex).replace(/\s+$/, "")}\n\n${section}\n\n${body.slice(feedsIndex).trim()}\n`;
  }
  return `${body.replace(/\s+$/, "")}\n\n${section}\n`;
}

// ---------------------------------------------------------------------------
// Coverage stats (health page + citations page)
// ---------------------------------------------------------------------------

export interface CitationCoverageRow {
  slug: string;
  missing: boolean;
  total: number;
  matched: number;
  unlinked: number;
  stale: boolean;
}

export function citationCoverage(map: CitationMap, paperSlugs: string[]): CitationCoverageRow[] {
  return paperSlugs.map((slug) => {
    const entry = map.papers[slug];
    if (!entry) {
      return { slug, missing: true, total: 0, matched: 0, unlinked: 0, stale: false };
    }
    return {
      slug,
      missing: false,
      total: entry.rawReferences.length,
      matched: entry.citations.length,
      unlinked: entry.rawReferences.length - entry.citations.length,
      stale: entry.rawReferences.length === 0,
    };
  });
}

export interface CitationCoverageSummary {
  papers: number;
  withMap: number;
  missingMap: number;
  citations: number;
  matched: number;
  unlinked: number;
}

export function citationCoverageSummary(map: CitationMap, paperSlugs: string[]): CitationCoverageSummary {
  const rows = citationCoverage(map, paperSlugs);
  return {
    papers: rows.length,
    withMap: rows.filter((r) => !r.missing).length,
    missingMap: rows.filter((r) => r.missing).length,
    citations: rows.reduce((sum, r) => sum + r.total, 0),
    matched: rows.reduce((sum, r) => sum + r.matched, 0),
    unlinked: rows.reduce((sum, r) => sum + r.unlinked, 0),
  };
}
