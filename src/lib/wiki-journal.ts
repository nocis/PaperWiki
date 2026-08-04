/**
 * Wiki journal — the cognitive timeline of the wiki (wiki/journal/YYYY-MM.md).
 *
 * Entries are appended per operation (compile runs, resets) and follow the
 * human-readable format `## [YYYY-MM-DD] | <operation> | <title>` with
 * `- detail` bullets. Monthly files are created on demand.
 */
import * as fs from "fs/promises";
import * as path from "path";
import { today, WIKI_DIR } from "./wiki";

export const WIKI_JOURNAL_DIR = path.join(WIKI_DIR, "journal");

export async function appendWikiJournal(
  operation: string,
  title: string,
  details: string[] = []
): Promise<string> {
  const month = today().slice(0, 7);
  const filePath = path.join(WIKI_JOURNAL_DIR, `${month}.md`);

  await fs.mkdir(WIKI_JOURNAL_DIR, { recursive: true });

  let header = "";
  try {
    header = await fs.readFile(filePath, "utf8");
  } catch {
    /* new month file */
  }

  const entry = [`## ${today()} | ${operation} | ${title}`, ...details.map((d) => `- ${d}`), ""].join("\n");
  const content = header.trim()
    ? `${header.replace(/\s+$/, "")}\n\n${entry}`
    : `# Journal — ${month}\n\n${entry}`;

  await fs.writeFile(filePath, content + "\n");
  return filePath;
}
