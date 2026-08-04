/**
 * Wiki health linter CLI.
 *
 * Usage: yarn lint:wiki [--check-only] [--no-proposals]
 *
 * Default run applies mechanical auto-fixes and queues structural proposals.
 * --check-only performs no writes at all (report only).
 * --no-proposals skips proposal queueing but still applies auto-fixes.
 *
 * Exit code: 0 when no errors remain (warnings are non-fatal), 1 otherwise.
 */
import { runLint, summarize } from "../src/lib/lint-wiki";

function parseArgs(argv: string[]): { checkOnly: boolean; queueProposals: boolean } {
  const flags = new Set(argv);
  return {
    checkOnly: flags.has("--check-only"),
    queueProposals: !flags.has("--no-proposals"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.checkOnly ? "check-only (no writes)" : args.queueProposals ? "check + auto-fix + proposals" : "check + auto-fix";
  console.log(`PaperWiki lint — ${mode}\n`);

  const result = await runLint({ applyFixes: !args.checkOnly, queueProposals: !args.checkOnly && args.queueProposals });
  const { errors, warnings, ok } = summarize(result);

  const issues = result.issues;
  if (issues.length === 0) {
    console.log("✓ No issues found — wiki is healthy.");
  }
  for (const issue of issues) {
    const tag = issue.severity === "error" ? "✗ ERROR" : "! warn ";
    console.log(`[${tag}] ${issue.kind} ${issue.target ? `(${issue.target})` : ""} — ${issue.message}`);
  }

  if (result.fixed.length > 0) {
    console.log(`\n✓ ${result.fixed.length} issue(s) auto-fixed:`);
    for (const fix of result.fixed) console.log(`  - ${fix.message}`);
  }
  if (result.proposalsAdded > 0) {
    console.log(`\n${result.proposalsAdded} structural proposal(s) queued in wiki/proposals.md`);
  }
  if (!args.checkOnly && result.fixed.length === 0 && result.proposalsAdded === 0 && issues.length === 0) {
    console.log("\nNo fixes or proposals needed.");
  }

  console.log(`\nSummary: ${errors} error(s), ${warnings} warning(s)`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`✗ lint failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
