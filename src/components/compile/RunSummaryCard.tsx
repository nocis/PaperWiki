"use client";

import type { CompileRunSnapshot } from "@/lib/runs";
import { formatTime, stateBadge } from "./view";

/** Run status header, progress bar, and error boxes. */
export function RunSummaryCard({
  status,
  starting,
  requestError,
  percentComplete,
  filesCount,
}: {
  status: CompileRunSnapshot | null;
  starting: boolean;
  requestError: string | null;
  percentComplete: number;
  filesCount: number;
}) {
  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium text-gray-900">
            {status?.status === "running" && (status.currentLabel ?? "Compile is starting…")}
            {status?.status === "completed" && "Compile completed"}
            {status?.status === "failed" && "Compile failed"}
            {status?.status === "cancelled" && "Compile cancelled"}
            {starting && !status && "Run is starting…"}
            {!status && !starting && "Compile status unavailable"}
          </p>
          {(status?.status === "completed" || status?.status === "cancelled") && (
            <p className="mt-1 text-xs text-gray-600">
              {status.totals.compiled} compiled · {status.totals.duplicates} duplicate
              {status.totals.duplicates === 1 ? "" : "s"} · {status.totals.failed} failed
            </p>
          )}
          <p className="text-xs text-gray-500">
            {status ? (
              <>
                run <code>{status.runId}</code> · {status.source}
                {status.provider || status.model ? (
                  <>
                    {" "}
                    ·{" "}
                    <code>
                      {status.provider ?? "default"}/{status.model ?? "default"}
                    </code>
                  </>
                ) : null}
                · updated {formatTime(status.updatedAt)}
                {status.currentFile ? ` · ${status.currentFile}` : ""}
              </>
            ) : (
              requestError
            )}
          </p>
        </div>
        {status && (
          <span
            className={`rounded-full px-2 py-1 text-xs font-medium ${
              stateBadge(
                status.status === "running"
                  ? "started"
                  : status.status === "idle"
                    ? "pending"
                    : status.status
              ).className
            }`}
          >
            {status.status}
          </span>
        )}
      </div>

      {status && (
        <>
          <div className="mt-3 h-2 overflow-hidden rounded bg-gray-100">
            <div
              className={`h-full transition-all ${status.status === "failed" ? "bg-red-500" : "bg-blue-600"}`}
              style={{ width: `${percentComplete}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
            <span>{percentComplete}% of known paper steps</span>
            <span>{status.totals.compiled}/{status.totals.papers || filesCount} compiled</span>
            <span>{status.totals.duplicates} duplicates</span>
            <span>{status.totals.failed} failed</span>
          </div>
        </>
      )}

      {requestError && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {requestError}
        </p>
      )}
      {status?.error && (
        <p
          className={`mt-3 rounded border p-2 text-sm ${
            status.status === "cancelled"
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {status.error}
        </p>
      )}
    </div>
  );
}
