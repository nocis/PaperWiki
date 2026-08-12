/**
 * PDF text extraction for the compile script (Node only — never imported by app code).
 * Uses the pdfjs-dist legacy build, which runs in Node with a fake worker.
 */
import { createRequire } from "module";
import * as fs from "fs/promises";

const require = createRequire(import.meta.url);
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");

export interface ExtractedPaper {
  numPages: number;
  metaTitle: string | null;
  /** Full extracted text: every page joined, truncated head-first only at FULL_MAX_CHARS. */
  text: string;
}

/**
 * Upper bound on extracted text (~250k tokens at ~4 chars/token). Covers
 * 200+ page papers with wide headroom under a 1M-token model context window;
 * truncation is head-first with an explicit marker (never a silent amputation).
 */
export const FULL_MAX_CHARS = 1_000_000;

export async function extractPdf(filePath: string): Promise<ExtractedPaper> {
  const buf = await fs.readFile(filePath);
  const doc = await pdfjs
    .getDocument({
      data: new Uint8Array(buf),
      isEvalSupported: false,
      disableFontFace: true,
      // Text extraction only — silence pdfjs warnings (incl. the harmless
      // "Cannot polyfill DOMMatrix/Path2D" canvas notices on Node).
      verbosity: 0,
    })
    .promise;

  try {
    const numPages: number = doc.numPages;

    let metaTitle: string | null = null;
    try {
      const meta = await doc.getMetadata();
      const title = meta?.info?.Title?.trim();
      if (title) metaTitle = title;
    } catch {
      /* metadata is best-effort */
    }

    const chunks: string[] = [];
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const text = content.items.map((item: { str: string }) => item.str).join(" ");
      chunks.push(`--- page ${pageNum} ---\n${text}`);
    }

    let text = chunks.join("\n\n");
    if (text.length > FULL_MAX_CHARS) {
      text = text.slice(0, FULL_MAX_CHARS) + "\n[...truncated]";
    }
    return { numPages, metaTitle, text };
  } finally {
    await doc.destroy();
  }
}
