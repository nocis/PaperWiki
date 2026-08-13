/**
 * Paper Knowledge — per-paper status + lazy diagram machinery for the
 * structured research-pickup block added to compiled Paper pages.
 *
 * App-safe module: no PDF extraction here (the amend worker pool lives in
 * scripts/paper-knowledge/ — pdfjs is never imported by app code).
 *
 * Semantics (see wiki/SCHEMA.md):
 * - A paper's status entry is created by enqueuePaperKnowledge at compile
 *   persist time. `ready` is TERMINAL: the block is never regenerated except
 *   by a full reset-to-zero + recompile. `failed` can be retried (UI only).
 * - Diagrams are TEXT BRIEFS stored in the paper body; the raw SVG is rendered
 *   on demand by renderPaperDiagram and cached under papers/compiled/<slug>_diagrams/.
 */
import { createHash } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { llmChat, type LLMProviderDef } from "./llm";
import type { PaperKnowledge } from "./prompts";
import { PAPER_KNOWLEDGE_SECTIONS } from "./templates";
import { PAPERS_COMPILED, readPaperPages } from "./wiki";
import { DIAGRAM_ID_IN_BODY_RE, DIAGRAM_ID_RE, SLUG_RE } from "./wiki-ids";

export const PAPER_KNOWLEDGE_STATUS_PATH = path.join(process.cwd(), ".log", "paper-knowledge-status.json");

/** Cross-process exclusive lock for claiming pending entries. */
const CLAIM_LOCK_PATH = path.join(process.cwd(), ".log", "paper-knowledge-claim.lock");
const CLAIM_LOCK_STALE_MS = 10_000;
const CLAIM_RETRY_TRIES = 10;
const CLAIM_RETRY_WAIT_MS = 50;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Lazy-rendered SVG diagram cache for a paper slug (sibling of <slug>_figures). */
export const DIAGRAMS_DIR_FOR = (slug: string): string =>
  path.join(PAPERS_COMPILED, `${slug}_diagrams`);

export type PaperKnowledgeEntryStatus = "pending" | "running" | "ready" | "failed";

export interface PaperKnowledgeEntry {
  slug: string;
  status: PaperKnowledgeEntryStatus;
  error?: string;
  updatedAt: string;
}

export interface PaperKnowledgeStatus {
  entries: PaperKnowledgeEntry[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Status file IO (serialized read-modify-write; parallel workers share the file)
// ---------------------------------------------------------------------------

let lockChain: Promise<void> = Promise.resolve();
function withStatusLock<T>(work: () => Promise<T>): Promise<T> {
  const result = lockChain.then(work);
  lockChain = result.then(() => undefined, () => undefined);
  return result;
}

export async function readPaperKnowledgeStatus(): Promise<PaperKnowledgeStatus> {
  try {
    return JSON.parse(await fs.readFile(PAPER_KNOWLEDGE_STATUS_PATH, "utf8")) as PaperKnowledgeStatus;
  } catch {
    return { entries: [], updatedAt: new Date().toISOString() };
  }
}

async function writePaperKnowledgeStatus(status: PaperKnowledgeStatus): Promise<void> {
  await fs.mkdir(path.dirname(PAPER_KNOWLEDGE_STATUS_PATH), { recursive: true });
  const tmp = `${PAPER_KNOWLEDGE_STATUS_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(status, null, 2) + "\n");
  await fs.rename(tmp, PAPER_KNOWLEDGE_STATUS_PATH);
}

/**
 * Add `pending` entries for slugs that have NO entry yet. Existing entries are
 * untouched — a `ready` block is terminal, a `failed` slug waits for an
 * explicit retry, a pending/running slug is already in flight.
 */
export async function enqueuePaperKnowledge(slugs: string[]): Promise<number> {
  const unique = [...new Set(slugs)];
  if (unique.length === 0) return 0;
  return withStatusLock(async () => {
    const status = await readPaperKnowledgeStatus();
    const existing = new Set(status.entries.map((e) => e.slug));
    const now = new Date().toISOString();
    const added: PaperKnowledgeEntry[] = [];
    for (const slug of unique) {
      if (!existing.has(slug)) {
        added.push({ slug, status: "pending", updatedAt: now });
      }
    }
    if (added.length === 0) return 0;
    await writePaperKnowledgeStatus({
      entries: [...status.entries, ...added],
      updatedAt: now,
    });
    return added.length;
  });
}

/** Update one entry's status (create it if missing). */
export async function setPaperKnowledgeEntry(
  slug: string,
  status: PaperKnowledgeEntryStatus,
  error?: string
): Promise<void> {
  return withStatusLock(async () => {
    const now = new Date().toISOString();
    const file = await readPaperKnowledgeStatus();
    const existing = file.entries.find((e) => e.slug === slug);
    const entry: PaperKnowledgeEntry = { slug, status, updatedAt: now, ...(error ? { error } : {}) };
    const entries = existing
      ? file.entries.map((e) => (e.slug === slug ? entry : e))
      : [...file.entries, entry];
    await writePaperKnowledgeStatus({ entries, updatedAt: now });
  });
}

/** True when any entry is mid-flight — used to refuse reset-to-zero. */
export async function isPaperKnowledgeRunning(): Promise<boolean> {
  const status = await readPaperKnowledgeStatus();
  return status.entries.some((e) => e.status === "running");
}

/**
 * Atomically claim the next pending Paper Knowledge entry (flip pending ->
 * running). Cross-process safe via an exclusive lock file, so concurrent
 * amend runners (post-compile job + retries) never double-process a slug.
 * Returns null when nothing is pending (or the lock stayed contended).
 */
export async function claimNextPaperKnowledge(slug?: string): Promise<string | null> {
  for (let attempt = 0; attempt < CLAIM_RETRY_TRIES; attempt++) {
    let lock: fs.FileHandle | null = null;
    try {
      lock = await fs.open(CLAIM_LOCK_PATH, "wx");
    } catch {
      // Lock held — steal it when stale (a crashed process may have left it).
      try {
        const stat = await fs.stat(CLAIM_LOCK_PATH);
        if (Date.now() - stat.mtimeMs > CLAIM_LOCK_STALE_MS) {
          await fs.unlink(CLAIM_LOCK_PATH);
          continue;
        }
      } catch {
        /* lock vanished — retry */
      }
      await sleep(CLAIM_RETRY_WAIT_MS);
      continue;
    }
    try {
      const status = await readPaperKnowledgeStatus();
      const target = status.entries
        .filter((e) => e.status === "pending")
        .map((e) => e.slug)
        .find((s) => !slug || s === slug);
      if (!target) return null;
      await setPaperKnowledgeEntry(target, "running");
      return target;
    } finally {
      await lock.close();
      await fs.unlink(CLAIM_LOCK_PATH).catch(() => {});
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Background amend job (spawned by the compile API route after a successful
// compile, and by the per-paper retry action; CLI `yarn compile` runs the
// amend in-process instead)
// ---------------------------------------------------------------------------

const AMEND_OUTPUT_LOG = path.join(process.cwd(), ".log", "paper-knowledge-output.log");

/**
 * Spawn the amend runner as a background job (no package.json script — this
 * is a spawn target only). Returns the run id, or null when an amend job is
 * already active and force is off (the active job drains pending entries
 * continuously). With force (per-paper retry), a runner is always spawned —
 * cross-process claiming makes concurrent runners safe.
 */
export async function spawnPaperKnowledgeAmend(
  provider: LLMProviderDef,
  model: string,
  opts: { slug?: string; force?: boolean } = {}
): Promise<string | null> {
  const g = globalThis as Record<string, unknown>;
  const active = g.__paperwikiPaperKnowledge as { settled?: boolean } | undefined;
  if (!opts.force && active !== undefined && active.settled !== true) return null;

  const runId = `paper-knowledge-${Date.now()}`;
  const args = ["--import", "tsx", path.join(process.cwd(), "scripts", "paper-knowledge-runner.ts")];
  if (opts.slug) args.push("--slug", opts.slug);
  // Lazy import: jobs.ts pulls in next/server — keep plain-node scripts free of it.
  const { spawnJob } = await import("./jobs");
  const job = spawnJob({
    runId,
    command: process.execPath,
    args,
    env: {
      WIKI_LLM_PROVIDER: provider.id,
      WIKI_LLM_MODEL: model,
    },
    banner: `\n===== paper knowledge amend ${runId} @ ${new Date().toISOString()} =====\n`,
    outputLog: AMEND_OUTPUT_LOG,
    forwardToStdout: true,
  });
  g.__paperwikiPaperKnowledge = job;
  void job.promise
    .catch(() => {})
    .finally(() => {
      if (g.__paperwikiPaperKnowledge === job) g.__paperwikiPaperKnowledge = undefined;
    });
  return runId;
}

// ---------------------------------------------------------------------------
// Validation (code-side, applied before any body write)
// ---------------------------------------------------------------------------

const MAX_CURATED_FIGURES = 6;

/** Returns human-readable problems; empty array means the knowledge is valid. */
export function validatePaperKnowledge(
  knowledge: PaperKnowledge,
  opts: { allowedFigureFiles?: Set<string> } = {}
): string[] {
  const problems: string[] = [];
  const nonEmpty = (v: unknown, label: string): boolean => {
    if (typeof v !== "string" || v.trim().length === 0) {
      problems.push(`${label} must be a non-empty string`);
      return false;
    }
    return true;
  };
  const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

  // The LLM output is a blind cast (`extractJson<T>`) — guard the top-level
  // shape so a malformed response surfaces as field problems, not a crash.
  if (knowledge === null || typeof knowledge !== "object" || Array.isArray(knowledge)) {
    return ["knowledge must be a JSON object"];
  }

  if (!nonEmpty(knowledge.research_purpose?.target, "research_purpose.target")) return problems;
  nonEmpty(knowledge.research_purpose?.old_bottleneck, "research_purpose.old_bottleneck");
  nonEmpty(knowledge.research_purpose?.usable_benefit, "research_purpose.usable_benefit");

  if (knowledge.overview_diagram !== null && knowledge.overview_diagram !== undefined) {
    if (!isObject(knowledge.overview_diagram)) {
      problems.push("overview_diagram must be an object");
    } else {
      if (knowledge.overview_diagram.id !== "overview") {
        problems.push("overview_diagram.id must be \"overview\"");
      }
      nonEmpty(knowledge.overview_diagram.brief, "overview_diagram.brief");
    }
  }

  if (!Array.isArray(knowledge.key_actions) || knowledge.key_actions.length === 0) {
    problems.push("key_actions must be a non-empty array");
  } else {
    for (const a of knowledge.key_actions) nonEmpty(a, "key_actions[]");
  }

  if (!Array.isArray(knowledge.core_concepts) || knowledge.core_concepts.length === 0) {
    problems.push("core_concepts must be a non-empty array");
  } else if (knowledge.core_concepts.length > 10) {
    problems.push("core_concepts has more than 10 entries");
  } else {
    for (const c of knowledge.core_concepts) {
      nonEmpty(c.term, "core_concepts[].term");
      nonEmpty(c.definition, `core_concepts[].definition (${c.term})`);
      nonEmpty(c.problem_solved, `core_concepts[].problem_solved (${c.term})`);
      nonEmpty(c.relationship, `core_concepts[].relationship (${c.term})`);
    }
  }

  const mechanism = knowledge.mechanism_chain;
  if (!isObject(mechanism)) {
    problems.push("mechanism_chain must be an object");
  } else {
    if (typeof mechanism.explanation !== "string" || mechanism.explanation.trim().length === 0) {
      problems.push("mechanism_chain.explanation must be a non-empty string");
    }
    if (mechanism.diagram !== null && mechanism.diagram !== undefined) {
      if (!isObject(mechanism.diagram)) {
        problems.push("mechanism_chain.diagram must be an object");
      } else {
        if (mechanism.diagram.id !== "mechanism") {
          problems.push("mechanism_chain.diagram.id must be \"mechanism\"");
        }
        nonEmpty(mechanism.diagram.brief, "mechanism_chain.diagram.brief");
      }
    }
  }

  if (!Array.isArray(knowledge.core_formulas) || knowledge.core_formulas.length > 5) {
    problems.push("core_formulas must be an array of at most 5 entries");
  } else {
    for (const f of knowledge.core_formulas) {
      nonEmpty(f.formula, "core_formulas[].formula");
      nonEmpty(f.question_answered, "core_formulas[].question_answered");
      nonEmpty(f.intuition, "core_formulas[].intuition");
      if (!Array.isArray(f.variables)) {
        problems.push("core_formulas[].variables must be an array");
      } else {
        for (const v of f.variables) {
          nonEmpty(v.symbol, "core_formulas[].variables[].symbol");
          nonEmpty(v.meaning, "core_formulas[].variables[].meaning");
        }
      }
    }
  }

  if (!Array.isArray(knowledge.comprehensive_qa) || knowledge.comprehensive_qa.length < 3) {
    problems.push("comprehensive_qa must contain at least 3 questions");
  } else if (knowledge.comprehensive_qa.length > 10) {
    problems.push("comprehensive_qa has more than 10 entries");
  } else {
    for (const qa of knowledge.comprehensive_qa) {
      nonEmpty(qa.question, "comprehensive_qa[].question");
      nonEmpty(qa.answer, "comprehensive_qa[].answer");
    }
  }

  nonEmpty(knowledge.boundaries_and_debt?.evidence_chain, "boundaries_and_debt.evidence_chain");
  nonEmpty(knowledge.boundaries_and_debt?.technical_debt, "boundaries_and_debt.technical_debt");
  nonEmpty(knowledge.boundaries_and_debt?.boundaries, "boundaries_and_debt.boundaries");

  const figureFiles = opts.allowedFigureFiles;
  if (figureFiles && figureFiles.size === 0 && Array.isArray(knowledge.figures) && knowledge.figures.length > 0) {
    problems.push("figures must be empty when the paper has no extracted figures");
  } else if (!Array.isArray(knowledge.figures) || knowledge.figures.length > MAX_CURATED_FIGURES) {
    problems.push(`figures must be an array of at most ${MAX_CURATED_FIGURES} entries`);
  } else {
    for (const f of knowledge.figures) {
      nonEmpty(f.caption, "figures[].caption");
      if (figureFiles && !figureFiles.has(f.file)) {
        problems.push(`figures[].file "${f.file}" is not an extracted figure`);
      }
      if (!PAPER_KNOWLEDGE_SECTIONS.includes(f.section as (typeof PAPER_KNOWLEDGE_SECTIONS)[number])) {
        problems.push(`figures[].section "${f.section}" is not a valid Paper Knowledge section`);
      }
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Lazy diagrams: text brief (in the paper body) -> cached SVG on demand
// ---------------------------------------------------------------------------

export interface DiagramMeta {
  briefHash: string;
  model: string;
  createdAt: string;
}

function hashBrief(brief: string): string {
  return createHash("sha256").update(brief).digest("hex").slice(0, 12);
}

/** Extract the brief of a ```diagram <id> fence from a paper body. */
export function extractDiagramBrief(body: string, id: string): string | null {
  const match = body.match(new RegExp("```diagram " + id + "\\s*\\n([\\s\\S]*?)```"));
  return match ? match[1].trim() : null;
}

/** Cached SVG info for a slug+id, or null when not rendered yet. */
export async function readDiagramCache(
  slug: string,
  id: string
): Promise<{ svgUrl: string; briefHash: string } | null> {
  const dir = DIAGRAMS_DIR_FOR(slug);
  try {
    const meta = JSON.parse(await fs.readFile(path.join(dir, `${id}.meta.json`), "utf8")) as DiagramMeta;
    await fs.access(path.join(dir, `${id}.svg`));
    return { svgUrl: `/diagrams/${slug}/${id}.svg`, briefHash: meta.briefHash };
  } catch {
    return null;
  }
}

/** Diagram fences currently embedded in a paper body (ids only). */
export async function readCachedDiagrams(slug: string, body: string): Promise<{ id: string; hasSvg: boolean }[]> {
  const ids = [...body.matchAll(DIAGRAM_ID_IN_BODY_RE)].map((m) => m[1]);
  const out: { id: string; hasSvg: boolean }[] = [];
  for (const id of [...new Set(ids)]) {
    // A cached SVG is only "current" when its briefHash matches the brief in
    // this body — a retried amend may have rewritten the brief, and showing
    // the stale SVG (with the new brief as caption) would be a mismatch.
    const cached = await readDiagramCache(slug, id);
    const brief = extractDiagramBrief(body, id);
    out.push({ id, hasSvg: cached !== null && brief !== null && cached.briefHash === hashBrief(brief) });
  }
  return out;
}

const SVG_RENDER_SYSTEM = `You convert a short text brief into ONE self-contained SVG diagram for a research paper wiki page. Strict rules:
- Output the raw <svg>...</svg> only. No markdown fences, no XML prolog, no explanation before or after.
- Draw only the necessary structure: Input/Premise -> Key Actions -> Intermediate Constraints -> Output/Result as labeled boxes with arrows.
- Concise labels only (at most ~6 words per label). Never stuff long explanatory paragraphs into the SVG.
- Prefer action chains for processes; side-by-side boxes for contrasts; draw variable relationships when the brief involves formulas.
- Use a neutral palette (grays + one accent color), a readable sans-serif font (12-14px), and a viewBox sized to the content (roughly 800x520, width 100%).
- The diagram is part of the main text explanation, not a decoration.`;

export interface RenderDiagramResult {
  ok: boolean;
  cached: boolean;
  svgUrl?: string;
  error?: string;
}

/**
 * Render (or reuse) the cached SVG for a paper's diagram brief. The brief is
 * read from the paper body; a matching briefHash reuses the cache.
 */
export async function renderPaperDiagram(opts: {
  slug: string;
  id: string;
  provider: LLMProviderDef;
  model: string;
}): Promise<RenderDiagramResult> {
  const { slug, id } = opts;
  if (!SLUG_RE.test(slug) || !DIAGRAM_ID_RE.test(id)) {
    return { ok: false, cached: false, error: "invalid slug or diagram id" };
  }
  const pages = await readPaperPages();
  const page = pages.find((p) => p.fm.slug === slug);
  if (!page) return { ok: false, cached: false, error: "paper page not found" };
  const brief = extractDiagramBrief(page.body, id);
  if (!brief) return { ok: false, cached: false, error: `no diagram brief "${id}" in the paper body` };

  const cached = await readDiagramCache(slug, id);
  if (cached && cached.briefHash === hashBrief(brief)) {
    return { ok: true, cached: true, svgUrl: cached.svgUrl };
  }

  let raw: string;
  try {
    raw = await llmChat({
      provider: opts.provider,
      model: opts.model,
      messages: [
        { role: "system", content: SVG_RENDER_SYSTEM },
        { role: "user", content: `DIAGRAM BRIEF:\n${brief}` },
      ],
      // Headroom for reasoning models that spend output tokens on
      // reasoning_content first — too small a budget returns empty content.
      maxTokens: 32_768,
      temperature: 0.2,
    });
  } catch (err) {
    return { ok: false, cached: false, error: err instanceof Error ? err.message : String(err) };
  }

  let svg = raw.trim();
  const fenced = svg.match(/^```(?:svg)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenced) svg = fenced[1].trim();
  if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>/i.test(svg)) {
    return { ok: false, cached: false, error: "LLM output was not a valid SVG (missing <svg> root)" };
  }

  const dir = DIAGRAMS_DIR_FOR(slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.svg`), svg);
  const meta: DiagramMeta = { briefHash: hashBrief(brief), model: opts.model, createdAt: new Date().toISOString() };
  await fs.writeFile(path.join(dir, `${id}.meta.json`), JSON.stringify(meta, null, 2) + "\n");

  return { ok: true, cached: false, svgUrl: `/diagrams/${slug}/${id}.svg` };
}

// ---------------------------------------------------------------------------
// In-memory diagram render job registry (background, navigation-persistent
// within a single server session). Mirrors the amend-job globalThis pattern:
// the render is an in-process promise; the API GET and server-rendered pages
// read the registry directly. Survives client navigation; lost on server
// restart (in-flight jobs reset to idle; completed SVGs persist on disk). No
// disk status file/lock is needed — the render is in-process and JS is
// single-threaded, so the Map mutation is race-free.
//
// Lifecycle: a job is `queued` (waiting for a concurrency slot) -> `rendering`
// (LLM call in flight) -> deleted on success (done state lives on disk via
// readDiagramCache / the `cached` prop) or `failed` (kept so the user can see
// the error on return and retry). `listDiagramJobs` therefore returns only
// queued/rendering/failed entries; an absent key means done/idle.
// ---------------------------------------------------------------------------

export type DiagramJobStatus = "queued" | "rendering" | "done" | "failed";

export interface DiagramJobSnapshot {
  key: string;
  slug: string;
  id: string;
  status: DiagramJobStatus;
  error?: string;
}

interface DiagramJob extends DiagramJobSnapshot {
  /** LLM settings needed to (re)start a queued job once a slot frees. Excluded from snapshots. */
  provider: LLMProviderDef;
  model: string;
}

interface DiagramJobRegistry {
  byKey: Map<string, DiagramJob>;
  runningCount: number;
}

const MAX_CONCURRENT_DIAGRAM_RENDERS = 3;

declare global {
  // Shared across route module reloads in dev, like __paperwikiCompile.
  // eslint-disable-next-line no-var
  var __paperwikiDiagramJobs: DiagramJobRegistry | undefined;
}

function diagramRegistry(): DiagramJobRegistry {
  if (!globalThis.__paperwikiDiagramJobs) {
    globalThis.__paperwikiDiagramJobs = { byKey: new Map(), runningCount: 0 };
  }
  return globalThis.__paperwikiDiagramJobs;
}

function snapshotJob(job: DiagramJob): DiagramJobSnapshot {
  const { provider: _provider, model: _model, ...rest } = job;
  return rest;
}

/** Read the effective render status for a paper's diagrams (in-session only). */
export function listDiagramJobs(slug?: string): DiagramJobSnapshot[] {
  const reg = diagramRegistry();
  const jobs = [...reg.byKey.values()];
  const filtered = slug ? jobs.filter((j) => j.slug === slug) : jobs;
  return filtered.map(snapshotJob);
}

/**
 * Start (or reuse) a background diagram render. Idempotent per slug+id: a
 * second call while one is queued/rendering returns the existing job instead
 * of spawning another LLM call — the root-cause fix for duplicate renders
 * when the button is clicked again (issue #1). A stale `failed` entry is
 * cleared and retried. `done` is not stored (disk cache is authoritative) so
 * a brief change after recompile correctly re-renders instead of short-circuiting.
 */
export function startDiagramJob(opts: {
  slug: string;
  id: string;
  provider: LLMProviderDef;
  model: string;
}): DiagramJobSnapshot {
  const { slug, id, provider, model } = opts;
  const key = `${slug}:${id}`;
  const reg = diagramRegistry();
  const existing = reg.byKey.get(key);
  if (existing && (existing.status === "queued" || existing.status === "rendering")) {
    return snapshotJob(existing);
  }

  const startNow = reg.runningCount < MAX_CONCURRENT_DIAGRAM_RENDERS;
  const job: DiagramJob = { key, slug, id, status: startNow ? "rendering" : "queued", provider, model };
  reg.byKey.set(key, job);
  if (startNow) {
    reg.runningCount += 1;
    runDiagramJob(job);
  }
  return snapshotJob(job);
}

function runDiagramJob(job: DiagramJob): void {
  const reg = diagramRegistry();
  void (async () => {
    try {
      const result = await renderPaperDiagram({
        slug: job.slug,
        id: job.id,
        provider: job.provider,
        model: job.model,
      });
      if (result.ok) {
        // Success: drop the entry — done state lives on disk (readDiagramCache).
        reg.byKey.delete(job.key);
      } else {
        job.status = "failed";
        job.error = result.error ?? "diagram render failed";
      }
    } catch (err) {
      job.status = "failed";
      job.error = err instanceof Error ? err.message : String(err);
    } finally {
      reg.runningCount = Math.max(0, reg.runningCount - 1);
      drainQueuedDiagramJobs(reg);
    }
  })();
}

/** Promote the oldest queued job once a concurrency slot frees. */
function drainQueuedDiagramJobs(reg: DiagramJobRegistry): void {
  if (reg.runningCount >= MAX_CONCURRENT_DIAGRAM_RENDERS) return;
  let next: DiagramJob | null = null;
  for (const job of reg.byKey.values()) {
    if (job.status === "queued") {
      next = job;
      break;
    }
  }
  if (!next) return;
  next.status = "rendering";
  reg.runningCount += 1;
  runDiagramJob(next);
}
