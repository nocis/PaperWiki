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
  /** Capped text: first HEAD_PAGES + last TAIL_PAGES, joined, truncated to MAX_CHARS. */
  text: string;
}

const HEAD_PAGES = 12;
const TAIL_PAGES = 4;
const MAX_CHARS = 60_000;

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

    const all = Array.from({ length: numPages }, (_, i) => i + 1);
    const wanted = [...new Set([...all.slice(0, HEAD_PAGES), ...all.slice(-TAIL_PAGES)])];

    const chunks: string[] = [];
    for (const pageNum of wanted) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const text = content.items.map((item: { str: string }) => item.str).join(" ");
      chunks.push(`--- page ${pageNum} ---\n${text}`);
    }

    let text = chunks.join("\n\n");
    if (text.length > MAX_CHARS) {
      text = text.slice(0, MAX_CHARS) + "\n[...truncated]";
    }
    return { numPages, metaTitle, text };
  } finally {
    await doc.destroy();
  }
}
