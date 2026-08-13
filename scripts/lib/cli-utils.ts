/**
 * Shared CLI plumbing for the script pipelines (compile, citations, knowledge).
 *
 * Each pipeline parses the same `--flag value` / `--flag=value` argument style,
 * truncates bounded context lines, and formats unknown errors identically —
 * these live here so no script re-implements them.
 */

type FlagMap = Record<string, string[]>;

/** Tokenize `--flag value` and `--flag=value` arguments into a flag -> values map. */
export function parseFlags(argv: string[]): FlagMap {
  const out: FlagMap = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq >= 3) {
      const name = arg.slice(2, eq);
      (out[name] ??= []).push(arg.slice(eq + 1));
    } else if (arg.length > 2 && argv[i + 1] !== undefined) {
      const name = arg.slice(2);
      (out[name] ??= []).push(argv[i + 1]);
      i += 1;
    }
  }
  return out;
}

/** Provider/model flags shared by every pipeline. */
export function parseArgs(argv: string[]): { provider?: string; model?: string } {
  const flags = parseFlags(argv);
  return { provider: flags.provider?.[0], model: flags.model?.[0] };
}

/** Provider/model flags plus the citations pipeline's repeatable --slug. */
export function parseCitationsArgs(argv: string[]): { provider?: string; model?: string; slugs: string[] } {
  const flags = parseFlags(argv);
  return { provider: flags.provider?.[0], model: flags.model?.[0], slugs: flags.slug ?? [] };
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export { errorMessage } from "../../src/lib/errors";
