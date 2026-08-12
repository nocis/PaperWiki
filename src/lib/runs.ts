/**
 * The three pipeline trackers, instantiated from the generic progress factory.
 * Exports keep the historical names so call sites read naturally.
 */
import { createProgress, isStaleRunning, STALE_RUN_MS } from "./progress";
export { isStaleRunning, STALE_RUN_MS };
import type { ProgressEvent, RunSnapshot } from "./progress";

export const COMPILE_PROGRESS_LOG = ".log/compile-progress.jsonl";
export const COMPILE_STATUS_PATH = ".log/compile-status.json";
export const CITATIONS_PROGRESS_LOG = ".log/citations-progress.jsonl";
export const CITATIONS_STATUS_PATH = ".log/citations-status.json";
export const KNOWLEDGE_PROGRESS_LOG = ".log/knowledge-progress.jsonl";
export const KNOWLEDGE_STATUS_PATH = ".log/knowledge-status.json";

export const COMPILE_STEP_CATALOG = {
  system: [
    { id: "prepare-dirs", label: "Prepare workspace directories" },
    { id: "llm-preflight", label: "Check LLM connectivity" },
    { id: "scan-inbox", label: "Scan papers/new inbox" },
    { id: "finalize-citations", label: "Finalize citation relations with LLM" },
    { id: "consolidation-checks", label: "Check topic consolidation proposals" },
  ],
  paper: [
    { id: "load-state", label: "Load current wiki state" },
    { id: "duplicate-check", label: "Check for duplicate paper (filename)" },
    { id: "extract-pdf", label: "Extract PDF text" },
    { id: "extract-title-essence", label: "Extract title and essence with LLM" },
    { id: "resolve-title-slug", label: "Resolve canonical title slug" },
    { id: "dedup-screen", label: "Screen against compiled papers with LLM" },
    { id: "analyze-classify", label: "Analyze and classify with LLM" },
    { id: "write-citation-map", label: "Persist reference list to citation map" },
    { id: "extract-figures", label: "Extract figures" },
    { id: "apply-topic-classification", label: "Apply topic classification" },
    { id: "write-paper-page", label: "Write paper wiki page" },
    { id: "synthesize-topic", label: "Synthesize topic with LLM" },
    { id: "write-topic-page", label: "Write topic wiki page" },
    { id: "move-pdf", label: "Move PDF to compiled archive" },
    { id: "create-comments-dir", label: "Create comments directory" },
    { id: "rebuild-derived-files", label: "Rebuild index, log, and database" },
  ],
};

const compileRun = createProgress({
  name: "compile",
  initialTotals: { papers: 0, compiled: 0, duplicates: 0, failed: 0 },
  eventScope: true,
});

const citationsRun = createProgress({
  name: "citations",
  initialTotals: { papers: 0, rebuilt: 0, skipped: 0, failed: 0 },
  totalsOnEvent: { "paper-finished": { completed: "rebuilt", skipped: "skipped" } },
});

const knowledgeRun = createProgress({
  name: "knowledge",
  initialTotals: { pieces: 0, articles: 0, compiled: 0, failed: 0 },
  totalsOnEvent: { "article-finished": { completed: "compiled", failed: "failed" } },
});

// --- compile ----------------------------------------------------------------
export const startCompileRun = compileRun.start;
export const resumeCompileRun = compileRun.resume;
export const recordCompileEvent = compileRun.record;
export const updateCompileRun = compileRun.update;
export const runCompileStep = compileRun.runStep;
export const finishCompileRun = compileRun.finish;
export const markCompileProcessFinished = compileRun.markProcessFinished;
export const readCompileStatus = compileRun.readStatus;
export const readEffectiveCompileStatus = compileRun.readEffectiveStatus;
export const createCompileRunId = compileRun.createRunId;
export type CompileRunSnapshot = RunSnapshot;
export type CompileProgressEvent = ProgressEvent;

// --- citations --------------------------------------------------------------
export const startCitationsRun = citationsRun.start;
export const resumeCitationsRun = citationsRun.resume;
export const recordCitationsEvent = citationsRun.record;
export const updateCitationsRun = citationsRun.update;
export const finishCitationsRun = citationsRun.finish;
export const markCitationsProcessFinished = citationsRun.markProcessFinished;
export const readCitationsStatus = citationsRun.readStatus;
export const createCitationsRunId = citationsRun.createRunId;
export type CitationsRunSnapshot = RunSnapshot;
export type CitationsEvent = ProgressEvent;

// --- knowledge --------------------------------------------------------------
export const startKnowledgeRun = knowledgeRun.start;
export const resumeKnowledgeRun = knowledgeRun.resume;
export const recordKnowledgeEvent = knowledgeRun.record;
export const updateKnowledgeRun = knowledgeRun.update;
export const finishKnowledgeRun = knowledgeRun.finish;
export const markKnowledgeProcessFinished = knowledgeRun.markProcessFinished;
export const readKnowledgeStatus = knowledgeRun.readStatus;
export const readEffectiveKnowledgeStatus = knowledgeRun.readEffectiveStatus;
export const createKnowledgeRunId = knowledgeRun.createRunId;
export type KnowledgeRunSnapshot = RunSnapshot;
export type KnowledgeEvent = ProgressEvent;
