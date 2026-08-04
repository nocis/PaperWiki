"use client";

import type { ReactNode } from "react";
import { useState } from "react";

export default function PaperTabs({
  annotate,
  wiki,
  figures,
}: {
  annotate: ReactNode;
  wiki: ReactNode;
  figures?: ReactNode;
}) {
  const tabs: { value: string; label: string; node: ReactNode }[] = [
    { value: "annotate", label: "Annotate", node: annotate },
    ...(figures ? [{ value: "figures", label: "Figures", node: figures }] : []),
    { value: "wiki", label: "Wiki", node: wiki },
  ];
  const [tab, setTab] = useState<string>(tabs[0].value);

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200" role="tablist" aria-label="Paper views">
        {tabs.map(({ value, label }) => (
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
      <div className="pt-6">{tabs.find((t) => t.value === tab)?.node}</div>
    </div>
  );
}
