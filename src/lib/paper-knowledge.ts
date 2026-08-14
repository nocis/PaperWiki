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
import { executeSvgJsCode, type SvgExecResult } from "./diagram-exec";
import {
  llmChatDetailed,
  type ChatMessage,
  type LLMProviderDef,
  type LlmChatDetailedResult,
} from "./llm";
import type { DiagramFormat, PaperKnowledge, PaperKnowledgeDiagramBrief } from "./prompts";
import { MERMAID_RENDER_SYSTEM, SVG_RENDER_SYSTEM, renderContinuePrompt, renderRewritePrompt } from "./prompts";
import { PAPER_KNOWLEDGE_SECTIONS } from "./templates";
import { PAPERS_COMPILED, readPaperPages } from "./wiki";
import { DIAGRAM_ID_IN_BODY_RE, DIAGRAM_ID_RE, SLUG_RE } from "./wiki-ids";

export const PAPER_KNOWLEDGE_STATUS_PATH = path.join(process.cwd(), ".log", "paper-knowledge-status.json");

/**
 * Persisted per-paper knowledge JSON (the structured block + a capped paper
 * text excerpt), written by the amend phase and consumed by the diagram-plan
 * phase — the planner never re-extracts the PDF.
 */
const KNOWLEDGE_DIR = path.join(process.cwd(), ".log", "paper-knowledge");
/** Cap for the persisted paper-text excerpt (chars). */
export const KNOWLEDGE_EXCERPT_CHARS = 12_000;

export const knowledgePathFor = (slug: string): string => path.join(KNOWLEDGE_DIR, `${slug}.json`);

export interface PaperKnowledgeStore {
  knowledge: PaperKnowledge;
  /** Capped slice of the extracted paper text for cross-checking facts. */
  textExcerpt: string;
}

/** Persist the structured knowledge + capped text excerpt (atomic write). */
export async function writeKnowledgeJson(slug: string, store: PaperKnowledgeStore): Promise<void> {
  await fs.mkdir(KNOWLEDGE_DIR, { recursive: true });
  const tmp = `${knowledgePathFor(slug)}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store) + "\n");
  await fs.rename(tmp, knowledgePathFor(slug));
}

/** Read the persisted knowledge store, or null when missing/corrupt. */
export async function readKnowledgeJson(slug: string): Promise<PaperKnowledgeStore | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(knowledgePathFor(slug), "utf8")) as Partial<PaperKnowledgeStore>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.textExcerpt !== "string") return null;
    return { knowledge: parsed.knowledge as PaperKnowledge, textExcerpt: parsed.textExcerpt };
  } catch {
    return null;
  }
}

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

/** Phase-2 (diagram planning) state, tracked on the SAME entry as the amend. */
export type PaperKnowledgeDiagramPhase = "pending" | "running" | "ready" | "failed";

export interface PaperKnowledgeEntry {
  slug: string;
  status: PaperKnowledgeEntryStatus;
  error?: string;
  /** Diagram-plan phase state; absent until the amend reaches ready. */
  diagramPlan?: PaperKnowledgeDiagramPhase;
  diagramPlanError?: string;
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

/** Update one entry's status (create it if missing). Extra fields are merged
 *  on top of the preserved existing fields (a status flip never drops the
 *  diagram-plan state or the amend error). */
export async function setPaperKnowledgeEntry(
  slug: string,
  status: PaperKnowledgeEntryStatus,
  error?: string,
  extra?: Partial<Pick<PaperKnowledgeEntry, "diagramPlan" | "diagramPlanError">>
): Promise<void> {
  return withStatusLock(async () => {
    const now = new Date().toISOString();
    const file = await readPaperKnowledgeStatus();
    const existing = file.entries.find((e) => e.slug === slug);
    const entry: PaperKnowledgeEntry = {
      slug,
      status,
      updatedAt: now,
      ...(error ? { error } : {}),
      ...(existing?.diagramPlan !== undefined ? { diagramPlan: existing.diagramPlan } : {}),
      ...(existing?.diagramPlanError !== undefined ? { diagramPlanError: existing.diagramPlanError } : {}),
      ...extra,
    };
    const entries = existing
      ? file.entries.map((e) => (e.slug === slug ? entry : e))
      : [...file.entries, entry];
    await writePaperKnowledgeStatus({ entries, updatedAt: now });
  });
}

/** Update ONLY the diagram-plan phase fields of an entry (amend status untouched). */
export async function setDiagramPlanEntry(
  slug: string,
  diagramPlan: PaperKnowledgeDiagramPhase,
  error?: string
): Promise<void> {
  return withStatusLock(async () => {
    const now = new Date().toISOString();
    const file = await readPaperKnowledgeStatus();
    const existing = file.entries.find((e) => e.slug === slug);
    const entry: PaperKnowledgeEntry = {
      slug,
      status: existing?.status ?? "pending",
      updatedAt: now,
      ...(existing?.error ? { error: existing.error } : {}),
      diagramPlan,
      ...(error ? { diagramPlanError: error } : {}),
    };
    const entries = existing
      ? file.entries.map((e) => (e.slug === slug ? entry : e))
      : [...file.entries, entry];
    await writePaperKnowledgeStatus({ entries, updatedAt: now });
  });
}

/** True when any entry is mid-flight — used to refuse reset-to-zero. */
export async function isPaperKnowledgeRunning(): Promise<boolean> {
  const status = await readPaperKnowledgeStatus();
  return status.entries.some((e) => e.status === "running" || e.diagramPlan === "running");
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

/**
 * Atomically claim the next entry whose DIAGRAM-PLAN phase is pending (flip
 * diagramPlan pending -> running). Same lock file as claimNextPaperKnowledge,
 * so amend and plan claims serialize across processes. The amend status is
 * untouched — a plan claim only ever runs for a paper whose amend succeeded.
 */
export async function claimNextDiagramPlan(slug?: string): Promise<string | null> {
  for (let attempt = 0; attempt < CLAIM_RETRY_TRIES; attempt++) {
    let lock: fs.FileHandle | null = null;
    try {
      lock = await fs.open(CLAIM_LOCK_PATH, "wx");
    } catch {
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
        .filter((e) => e.diagramPlan === "pending")
        .map((e) => e.slug)
        .find((s) => !slug || s === slug);
      if (!target) return null;
      await setDiagramPlanEntry(target, "running");
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
const MAX_DIAGRAMS = 10;

/** Code-side diagram-plan validation (shared by the amend validator and the
 *  diagram-plan phase). Pushes human-readable problems; empty means valid. */
export function validateDiagrams(diagrams: unknown, problems: string[]): void {
  if (!Array.isArray(diagrams)) {
    problems.push("diagrams must be an array");
    return;
  }
  if (diagrams.length > MAX_DIAGRAMS) {
    problems.push(`diagrams has more than ${MAX_DIAGRAMS} entries`);
    return;
  }
  for (const d of diagrams) {
    if (typeof d !== "object" || d === null || Array.isArray(d)) {
      problems.push("diagrams[] must be objects");
      continue;
    }
    const entry = d as Record<string, unknown>;
    if (typeof entry.id !== "string" || !DIAGRAM_ID_RE.test(entry.id)) {
      problems.push(`diagrams[].id "${String(entry.id)}" is not a valid diagram id`);
    }
    if (
      typeof entry.section !== "string" ||
      !PAPER_KNOWLEDGE_SECTIONS.includes(entry.section as (typeof PAPER_KNOWLEDGE_SECTIONS)[number])
    ) {
      problems.push(`diagrams[].section "${String(entry.section)}" is not a Paper Knowledge section`);
    }
    if (typeof entry.brief !== "string" || entry.brief.trim().length === 0) {
      problems.push(`diagrams[].brief (${String(entry.id ?? "")}) must be a non-empty string`);
    }
    if (typeof entry.title !== "string" || entry.title.trim().length === 0 || entry.title.length > 80) {
      problems.push(`diagrams[].title (${String(entry.id ?? "")}) must be a non-empty string of at most 80 chars`);
    }
    if (entry.format !== "mermaid" && entry.format !== "svg") {
      problems.push(`diagrams[].format (${String(entry.id ?? "")}) must be "mermaid" or "svg"`);
    }
    if (entry.location !== undefined && entry.location !== null) {
      if (typeof entry.location !== "string" || entry.location.length > 120) {
        problems.push(`diagrams[].location (${String(entry.id ?? "")}) must be a string of at most 120 chars`);
      }
    }
  }
}

/**
 * Map the pre-diagrams[] fixed slots (overview_diagram, mechanism_chain.diagram)
 * onto the diagrams array. Runs on every blind-cast JSON before validation so
 * a stale-format LLM response can never crash the template or drop a diagram.
 * Mutates `knowledge.diagrams` in place.
 */
function normalizeLegacyDiagrams(knowledge: PaperKnowledge): void {
  const legacy = knowledge as unknown as {
    overview_diagram?: { id?: unknown; brief?: unknown } | null;
    mechanism_chain?: { diagram?: { id?: unknown; brief?: unknown } | null };
  };
  const out: PaperKnowledgeDiagramBrief[] = Array.isArray(knowledge.diagrams) ? [...knowledge.diagrams] : [];
  const add = (entry: { id?: unknown; brief?: unknown } | null | undefined, section: string): void => {
    if (entry && typeof entry.id === "string" && typeof entry.brief === "string") {
      out.push({ id: entry.id, section, brief: entry.brief });
    }
  };
  add(legacy.overview_diagram, "Overview");
  add(legacy.mechanism_chain?.diagram, "Mechanism");
  knowledge.diagrams = out;
}

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

  normalizeLegacyDiagrams(knowledge);
  validateDiagrams(knowledge.diagrams, problems);

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
  /** Rendering route the cached artifact belongs to (defaults to svg). */
  format?: DiagramFormat;
}

export interface DiagramCacheEntry {
  /** Content-addressed URL for the cached artifact (.svg or .mmd). */
  url: string;
  briefHash: string;
  format: DiagramFormat;
}

function hashBrief(brief: string): string {
  return createHash("sha256").update(brief).digest("hex").slice(0, 12);
}

/**
 * Renderer protocol version. Baked into the cache key so a prompt/library
 * bump invalidates every previously cached diagram (their hash no longer
 * matches, so readCachedDiagrams reports them stale and they re-render).
 */
export const RENDERER_VERSION = "svgjs-v3";

/** Cache key for a brief + format: content hash + route + renderer version. */
export function diagramCacheKey(brief: string, format: DiagramFormat): string {
  return hashBrief(`${brief}::${format}::${RENDERER_VERSION}`);
}

/** Extract the brief of a ```diagram <id> [<Section>] [<format>] fence from a paper body. */
export function extractDiagramBrief(body: string, id: string): string | null {
  const match = body.match(new RegExp("```diagram " + id + "(?: [^\\n]*)?\\n([\\s\\S]*?)```"));
  return match ? match[1].trim() : null;
}

/**
 * The section token in a ```diagram <id> <Section> [<format>] fence info line.
 * The trailing format token (mermaid|svg) is stripped; legacy fences without
 * it still resolve. Returns null when the fence has no info-line content.
 */
export function extractDiagramSection(body: string, id: string): string | null {
  const match = body.match(new RegExp("```diagram " + id + " ([^\\n]+)$", "m"));
  if (!match) return null;
  const rest = match[1].trim().replace(/\s+(mermaid|svg)$/, "");
  return rest.length > 0 ? rest : null;
}

/** The format token in a ```diagram <id> <Section> <format> fence info line (default svg). */
export function extractDiagramFormat(body: string, id: string): DiagramFormat {
  const match = body.match(new RegExp("```diagram " + id + " [^\\n]+ (mermaid|svg)$", "m"));
  return match && match[1] === "mermaid" ? "mermaid" : "svg";
}

/** The `**Title**: ...` first content line of a diagram fence, or null. */
export function extractDiagramTitle(body: string, id: string): string | null {
  const match = body.match(new RegExp("```diagram " + id + "[^\\n]*\\n\\*\\*Title\\*\\*:\\s*([^\\n]+)", "m"));
  return match ? match[1].trim() : null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Prose of the owning Paper Knowledge section (heading -> next heading) for a
 * diagram fence. Prefers the section token in the fence info line; falls back
 * to the nearest preceding `### ` heading for legacy fences. Diagram fences
 * inside the prose are stripped (the brief would be redundant input), and the
 * result is capped so the render prompt stays lean.
 */
export function extractSectionProse(body: string, id: string, section: string | null, cap = 1200): string {
  const sliceFor = (heading: string): string => {
    const re = new RegExp(`^### ${escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=^### |^## |$)`, "m");
    return body.match(re)?.[1] ?? "";
  };
  let prose = section ? sliceFor(section) : "";
  if (!prose) {
    const fenceIdx = body.search(new RegExp(`\`\`\`diagram ${escapeRegExp(id)}(?: [^\\n]*)?\\n`));
    if (fenceIdx !== -1) {
      const prevHeading = body.slice(0, fenceIdx).match(/^### (.+)$/m);
      if (prevHeading) prose = sliceFor(prevHeading[1].trim());
    }
  }
  const stripped = prose.replace(/```diagram [^\n]*\n[\s\S]*?```/g, "").trim();
  return stripped.length > cap ? stripped.slice(0, cap) : stripped;
}

/**
 * Cached diagram artifact info for a slug+id, or null when not rendered yet.
 * The URL is content-addressed: the brief hash (content + format + renderer
 * version) rides in the path, so the browser and any proxy caches treat a
 * re-render as a new resource (and the diagrams route verifies the hash
 * against the meta before serving).
 */
export async function readDiagramCache(slug: string, id: string): Promise<DiagramCacheEntry | null> {
  const dir = DIAGRAMS_DIR_FOR(slug);
  try {
    const meta = JSON.parse(await fs.readFile(path.join(dir, `${id}.meta.json`), "utf8")) as DiagramMeta;
    const format: DiagramFormat = meta.format === "mermaid" ? "mermaid" : "svg";
    const ext = format === "mermaid" ? "mmd" : "svg";
    await fs.access(path.join(dir, `${id}.${ext}`));
    return { url: `/diagrams/${slug}/${id}-${meta.briefHash}.${ext}`, briefHash: meta.briefHash, format };
  } catch {
    return null;
  }
}

/** Diagram fences currently embedded in a paper body (ids + cached artifact URLs). */
export async function readCachedDiagrams(
  slug: string,
  body: string
): Promise<{ id: string; title?: string; format?: DiagramFormat; svgUrl?: string; mmdUrl?: string }[]> {
  const ids = [...body.matchAll(DIAGRAM_ID_IN_BODY_RE)].map((m) => m[1]);
  const out: { id: string; title?: string; format?: DiagramFormat; svgUrl?: string; mmdUrl?: string }[] = [];
  for (const id of [...new Set(ids)]) {
    // A cached artifact is only "current" when its briefHash matches the
    // brief+format in this body — a retried amend may have rewritten the
    // brief (or the planner may have switched the route), and showing the
    // stale artifact (with the new brief as caption) would be a mismatch. The
    // versioned key also auto-invalidates caches from older renderer protocols.
    const brief = extractDiagramBrief(body, id);
    const format = extractDiagramFormat(body, id);
    const cached = await readDiagramCache(slug, id);
    const current = cached !== null && brief !== null && cached.briefHash === diagramCacheKey(brief, format);
    const entry = { id, title: extractDiagramTitle(body, id) ?? undefined, format };
    if (current && cached) {
      out.push(format === "mermaid" ? { ...entry, mmdUrl: cached.url } : { ...entry, svgUrl: cached.url });
    } else {
      out.push(entry);
    }
  }
  return out;
}

const SVG_RENDER_MAX_TOKENS = 65_536;
const MAX_RENDER_ATTEMPTS = 3;

/** Append one raw render response to the provenance log (<id>.raw.log). */
async function appendRenderLog(
  slug: string,
  id: string,
  attempt: number,
  res: LlmChatDetailedResult
): Promise<void> {
  try {
    const dir = DIAGRAMS_DIR_FOR(slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(
      path.join(dir, `${id}.raw.log`),
      `=== attempt ${attempt + 1} (finish_reason: ${res.finishReason ?? "n/a"}) ===\n${res.content ?? ""}\n\n`
    );
  } catch {
    /* logging is best-effort — never fail a render over it */
  }
}

// ---------------------------------------------------------------------------
// Render provenance logs (health UI)
// ---------------------------------------------------------------------------

const MAX_LOG_FIELD_CHARS = 16_000;

export interface DiagramLogEntry {
  id: string;
  rawLog?: string;
  codeJs?: string;
  mmd?: string;
}

async function readCapped(filePath: string, cap = MAX_LOG_FIELD_CHARS): Promise<string | undefined> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return text.length > cap ? `${text.slice(0, cap)}\n…(truncated)` : text;
  } catch {
    return undefined;
  }
}

/** Render provenance logs for every paper with a diagram dir (health UI). */
export async function readDiagramLogs(): Promise<Record<string, DiagramLogEntry[]>> {
  const out: Record<string, DiagramLogEntry[]> = {};
  let names: string[] = [];
  try {
    names = await fs.readdir(PAPERS_COMPILED);
  } catch {
    return out;
  }
  for (const name of names) {
    const m = name.match(/^(.+)_diagrams$/);
    if (!m) continue;
    const slug = m[1];
    const dir = path.join(PAPERS_COMPILED, name);
    let files: string[] = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    const ids = new Set<string>();
    for (const f of files) {
      const stem = f.match(/^(.*)\.(raw\.log|code\.js|mmd)$/);
      if (stem) ids.add(stem[1]);
    }
    const entries: DiagramLogEntry[] = [];
    for (const id of ids) {
      const entry: DiagramLogEntry = { id };
      entry.rawLog = await readCapped(path.join(dir, `${id}.raw.log`));
      entry.codeJs = await readCapped(path.join(dir, `${id}.code.js`));
      entry.mmd = await readCapped(path.join(dir, `${id}.mmd`));
      if (entry.rawLog || entry.codeJs || entry.mmd) entries.push(entry);
    }
    if (entries.length > 0) out[slug] = entries;
  }
  return out;
}

/**
 * Transport timeout for diagram-render calls (env-tunable). Reasoning models
 * can take several minutes on a single generation — the 300s global default
 * was timing out mid-generation. 600s here.
 */
const SVG_RENDER_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.LLM_DIAGRAM_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 600_000;
})();

export interface RenderDiagramResult {
  ok: boolean;
  cached: boolean;
  svgUrl?: string;
  mmdUrl?: string;
  error?: string;
}

/** Leading directives that mark a valid Mermaid source. */
const MERMAID_DIRECTIVE_RE = /^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey)\b/;
const MAX_MERMAID_LENGTH = 8_000;

/**
 * Render (or reuse) the cached artifact for a paper's diagram brief. The brief
 * and its route (mermaid | svg) are read from the paper body; a matching
 * briefHash (content + format + renderer version) reuses the cache. A miss
 * asks the LLM for svg.js drawing code (executed headlessly, see
 * diagram-exec.ts) or Mermaid source, and ALWAYS persists the result to the
 * cache — whether the render was triggered at runtime or not.
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

  const format = extractDiagramFormat(page.body, id);
  const cached = await readDiagramCache(slug, id);
  if (cached && cached.briefHash === diagramCacheKey(brief, format)) {
    return format === "mermaid"
      ? { ok: true, cached: true, mmdUrl: cached.url }
      : { ok: true, cached: true, svgUrl: cached.url };
  }

  const section = extractDiagramSection(page.body, id);
  const sectionProse = extractSectionProse(page.body, id, section);

  if (format === "mermaid") {
    return renderMermaidDiagram({ slug, id, brief, sectionProse, provider: opts.provider, model: opts.model });
  }

  // Continuation loop: a reasoning model can spend the whole output budget on
  // reasoning_content and return empty or truncated code (finish_reason
  // "length"), or emit code that fails to execute. Every failure retries WITH
  // the full accumulated context — the partial content AND the model's
  // reasoning_content are echoed back, so the follow-up call continues the
  // same reasoning instead of restarting from scratch. Capped at
  // MAX_RENDER_ATTEMPTS; each attempt gets the full token budget.
  const messages: ChatMessage[] = [
    { role: "system", content: SVG_RENDER_SYSTEM },
    {
      role: "user",
      content: `DIAGRAM ID: ${id}
DIAGRAM BRIEF (draw this; it also becomes the "How to read this diagram" caption):
${brief}

OWNING SECTION CONTENT (labels and facts must stay faithful to this):
${sectionProse || "(none)"}`,
    },
  ];

  let working = "";
  let lastError = "";
  let executed: SvgExecResult | null = null;
  let acceptedCode = "";
  for (let attempt = 0; attempt < MAX_RENDER_ATTEMPTS; attempt++) {
    let res: LlmChatDetailedResult;
    try {
      res = await llmChatDetailed({
        provider: opts.provider,
        model: opts.model,
        messages,
        maxTokens: SVG_RENDER_MAX_TOKENS,
        temperature: 0.2,
        timeoutMs: SVG_RENDER_TIMEOUT_MS,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Some gateways reject reasoning_content on assistant messages — retry
      // once with it stripped rather than failing the whole render.
      if (!/reasoning_content/i.test(message)) {
        return { ok: false, cached: false, error: message };
      }
      try {
        res = await llmChatDetailed({
          provider: opts.provider,
          model: opts.model,
          messages: messages.map((m) => (m.reasoningContent ? { role: m.role, content: m.content } : m)),
          maxTokens: SVG_RENDER_MAX_TOKENS,
          temperature: 0.2,
          timeoutMs: SVG_RENDER_TIMEOUT_MS,
        });
      } catch (retryErr) {
        return { ok: false, cached: false, error: retryErr instanceof Error ? retryErr.message : String(retryErr) };
      }
    }

    // Provenance log: every raw response the render LLM returned, verbatim.
    await appendRenderLog(slug, id, attempt, res);

    const truncated = res.finishReason === "length";
    const latest = res.content ?? "";
    // Accumulate continuations; a full rewrite replaces the partial work.
    working = truncated ? working + latest : latest;

    const fenced = working.match(/^```(?:js|javascript|ts|svg)?\s*\n?([\s\S]*?)\n?```$/);
    const candidates = [fenced ? fenced[1].trim() : working.trim()];
    // A "continuation" that actually restarts the whole function still works
    // on its own — try it directly too.
    if (truncated && latest.trim().length > 0) candidates.push(latest.trim());

    for (const candidate of candidates) {
      executed = executeSvgJsCode(candidate);
      if (executed.ok) {
        acceptedCode = candidate;
        break;
      }
      lastError = executed.error;
    }
    if (executed && executed.ok) break;

    if (attempt === MAX_RENDER_ATTEMPTS - 1) {
      const cause = lastError || (truncated ? "output was truncated" : "empty response");
      return { ok: false, cached: false, error: `svg.js render failed after ${MAX_RENDER_ATTEMPTS} attempts: ${cause}` };
    }

    messages.push({ role: "assistant", content: latest, reasoningContent: res.reasoningContent });
    messages.push({
      role: "user",
      content: truncated ? renderContinuePrompt() : renderRewritePrompt(lastError),
    });
  }

  if (!executed || !executed.ok) {
    return { ok: false, cached: false, error: "svg.js render failed" };
  }

  const dir = DIAGRAMS_DIR_FOR(slug);
  await fs.mkdir(dir, { recursive: true });
  // Provenance: the exact svg.js program that produced the cached SVG, for
  // debugging/reproduction. Not served by the route.
  await fs.writeFile(path.join(dir, `${id}.code.js`), acceptedCode + "\n");
  await fs.writeFile(path.join(dir, `${id}.svg`), executed.svg);
  const meta: DiagramMeta = {
    briefHash: diagramCacheKey(brief, "svg"),
    model: opts.model,
    createdAt: new Date().toISOString(),
    format: "svg",
  };
  await fs.writeFile(path.join(dir, `${id}.meta.json`), JSON.stringify(meta, null, 2) + "\n");

  return { ok: true, cached: false, svgUrl: `/diagrams/${slug}/${id}-${meta.briefHash}.svg` };
}

/**
 * Mermaid route: one LLM call for the Mermaid source (cheap diagrams — simple
 * flows/comparisons with plain labels), one compact retry on empty/broken
 * output, then cache `<id>.mmd` unconditionally.
 */
async function renderMermaidDiagram(opts: {
  slug: string;
  id: string;
  brief: string;
  sectionProse: string;
  provider: LLMProviderDef;
  model: string;
}): Promise<RenderDiagramResult> {
  const { slug, id } = opts;
  const messages: ChatMessage[] = [
    { role: "system", content: MERMAID_RENDER_SYSTEM },
    {
      role: "user",
      content: `DIAGRAM ID: ${id}
DIAGRAM BRIEF (draw this; it also becomes the "How to read this diagram" caption):
${opts.brief}

OWNING SECTION CONTENT (labels and facts must stay faithful to this):
${opts.sectionProse || "(none)"}`,
    },
  ];

  let lastError = "";
  let source = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: LlmChatDetailedResult;
    try {
      res = await llmChatDetailed({
        provider: opts.provider,
        model: opts.model,
        messages,
        maxTokens: SVG_RENDER_MAX_TOKENS,
        temperature: 0.2,
        timeoutMs: SVG_RENDER_TIMEOUT_MS,
      });
    } catch (err) {
      return { ok: false, cached: false, error: err instanceof Error ? err.message : String(err) };
    }

    await appendRenderLog(slug, id, attempt, res);

    const latest = (res.content ?? "").trim();
    const fenced = latest.match(/^```(?:mermaid)?\s*\n?([\s\S]*?)\n?```$/);
    source = fenced ? fenced[1].trim() : latest;
    if (source.length === 0 || source.length > MAX_MERMAID_LENGTH || !MERMAID_DIRECTIVE_RE.test(source)) {
      lastError =
        source.length === 0
          ? "empty response"
          : source.length > MAX_MERMAID_LENGTH
            ? `output too large (${source.length} chars)`
            : "output is not a Mermaid diagram (missing flowchart/graph/… directive)";
      if (attempt === 1) {
        return { ok: false, cached: false, error: `mermaid render failed after 2 attempts: ${lastError}` };
      }
      messages.push({ role: "assistant", content: res.content ?? "", reasoningContent: res.reasoningContent });
      messages.push({
        role: "user",
        content: renderRewritePrompt(lastError, "the Mermaid source (flowchart/graph/… — Mermaid syntax only)"),
      });
      continue;
    }
    break;
  }

  const dir = DIAGRAMS_DIR_FOR(slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.mmd`), source + "\n");
  const meta: DiagramMeta = {
    briefHash: diagramCacheKey(opts.brief, "mermaid"),
    model: opts.model,
    createdAt: new Date().toISOString(),
    format: "mermaid",
  };
  await fs.writeFile(path.join(dir, `${id}.meta.json`), JSON.stringify(meta, null, 2) + "\n");

  return { ok: true, cached: false, mmdUrl: `/diagrams/${slug}/${id}-${meta.briefHash}.mmd` };
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
