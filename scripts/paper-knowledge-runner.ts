/**
 * Paper Knowledge amend — background runner, spawned by the compile API route
 * (and awaited in-process by `yarn compile`). NOT an operator-facing command;
 * there is no package.json script for it.
 *
 * Usage: tsx scripts/paper-knowledge-runner.ts [--provider <id>] [--model <id>]
 *                                          [--slug <slug>] [--concurrency <n>]
 */
import { errorMessage, parseFlags } from "./lib/cli-utils";
import { resolveModel, resolveProvider } from "../src/lib/llm";
import { runPaperKnowledgeAmend } from "./paper-knowledge/amend";

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const provider = resolveProvider(flags.provider?.[0]);
  const model = resolveModel(provider, flags.model?.[0]);
  const slug = flags.slug?.[0];
  const concurrency = flags.concurrency?.[0] !== undefined ? Number(flags.concurrency[0]) : undefined;

  const summary = await runPaperKnowledgeAmend({ provider, model, slug, concurrency });
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`Paper Knowledge amend failed: ${errorMessage(err)}`);
  process.exit(1);
});
