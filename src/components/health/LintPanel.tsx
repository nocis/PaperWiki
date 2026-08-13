"use client";

import type { HealthReport } from "./types";

function severityClass(severity: string): string {
  return severity === "error"
    ? "border-red-200 bg-red-50 text-red-800"
    : "border-amber-200 bg-amber-50 text-amber-800";
}

/** The lint report: summary chips, empty state, and the issue list. */
export function LintPanel({ report }: { report: HealthReport }) {
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
          {report.ok ? "Healthy" : "Issues found"}
        </span>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
          {report.errors} error{report.errors === 1 ? "" : "s"}
        </span>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
          {report.warnings} warning{report.warnings === 1 ? "" : "s"}
        </span>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-500">
          checked {new Date(report.generatedAt).toLocaleTimeString()}
        </span>
      </div>

      {report.issues.length === 0 ? (
        <p className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50 p-8 text-emerald-800">
          No issues detected — wiki invariants, links, figures, and citations all check out.
        </p>
      ) : (
        <ul className="space-y-2">
          {report.issues.map((issue, index) => (
            <li
              key={`${issue.kind}-${issue.target}-${index}`}
              className={`flex flex-wrap items-baseline gap-2 rounded-lg border px-4 py-3 text-sm ${severityClass(issue.severity)}`}
            >
              <span className="font-semibold uppercase tracking-wide">{issue.severity}</span>
              <code className="rounded bg-white/60 px-1.5 py-0.5 font-mono text-xs">{issue.kind}</code>
              {issue.target && <span className="font-medium">{issue.target}</span>}
              <span className="flex-1 text-[13px]">{issue.message}</span>
              {issue.autoFixable && (
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium">auto-fixable</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
