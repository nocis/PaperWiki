/**
 * Figure extraction bridge: spawns the PyMuPDF bootstrap script and collects
 * the saved PNG filenames. Best-effort by design — figure extraction must
 * never abort a compile run (unlike LLM failures).
 */
import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "util";
import { PAPERS_COMPILED } from "./wiki";

const execFileAsync = promisify(execFile);

export interface FigureInfo {
  /** Filename inside the figures dir, e.g. "figure_1.png". */
  file: string;
  /** Absolute web URL served by the app, e.g. "/figures/<slug>/figure_1.png". */
  url: string;
}

export const FIGURES_SCRIPT = path.join(process.cwd(), "scripts", "figures.sh");
export const FIGURES_DIR_FOR = (slug: string): string =>
  path.join(PAPERS_COMPILED, `${slug}_figures`);

const MIN_DIM = 80;
const MAX_IMAGES = 12;
const MAX_DIM = 1600;
const TIMEOUT_MS = 180_000;

/** Descriptive label for a figure filename (alt text / caption fallback). */
export function figureLabel(file: string): string {
  const base = file.replace(/\.(png|jpe?g|webp)$/i, "").replace(/_/g, " ").trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * Run the extraction pipeline for a PDF. Returns the figure list (sorted,
 * embedded figures first, then page renders). Returns [] on any failure —
 * figure extraction is supplementary to the compile.
 */
export async function extractFigures(pdfPath: string, slug: string): Promise<FigureInfo[]> {
  const outDir = FIGURES_DIR_FOR(slug);
  try {
    await execFileAsync("bash", [
      FIGURES_SCRIPT,
      pdfPath,
      outDir,
      "--min-dim",
      String(MIN_DIM),
      "--max-images",
      String(MAX_IMAGES),
      "--max-dim",
      String(MAX_DIM),
      "--render-page1",
    ], { timeout: TIMEOUT_MS });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`  ! figures skipped for "${slug}": ${message}`);
    return [];
  }

  let files: string[];
  try {
    files = await fs.readdir(outDir);
  } catch {
    return [];
  }
  return files
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .sort()
    .map((file) => ({ file, url: `/figures/${slug}/${file}` }));
}
