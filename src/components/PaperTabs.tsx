"use client";

import type { ReactNode } from "react";
import { useState } from "react";

export default function PaperTabs({ annotate, wiki }: { annotate: ReactNode; wiki: ReactNode }) {
  const [tab, setTab] = useState<"annotate" | "wiki">("annotate");

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200" role="tablist" aria-label="Paper views">
        {([
          ["annotate", "Annotate"],
          ["wiki", "Wiki"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`border-b-2 px-4 py-3 text-sm font-medium transition ${
              tab === value
                ? "border-blue-700 text-blue-700"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="pt-6">{tab === "annotate" ? annotate : wiki}</div>
    </div>
  );
}
