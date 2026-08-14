"use client";

import { useCallback, useEffect, useState } from "react";

function figureLabel(file: string): string {
  const base = file.replace(/\.(png|jpe?g|webp)$/i, "").replace(/_/g, " ").trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export default function FigureGallery({ slug, files }: { slug: string; files: string[] }) {
  const items = files.map((file) => ({ file, url: `/figures/${slug}/${file}` }));
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const close = useCallback(() => setOpenIndex(null), []);
  const step = useCallback((delta: number) => {
    setOpenIndex((current) => {
      if (current === null) return null;
      return (current + delta + items.length) % items.length;
    });
  }, [items.length]);

  useEffect(() => {
    if (openIndex === null) return;
    // Lock page scroll while the lightbox is open.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [openIndex, close, step]);

  return (
    <div>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500">No figures extracted for this paper.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item, index) => (
            <li key={item.file}>
              <button
                type="button"
                onClick={() => setOpenIndex(index)}
                className="group flex w-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white text-left shadow-sm transition hover:border-blue-300 hover:shadow"
              >
                <span className="flex aspect-[4/3] items-center justify-center bg-gray-50 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.url}
                    alt={figureLabel(item.file)}
                    loading="lazy"
                    className="max-h-full max-w-full object-contain transition group-hover:scale-[1.02]"
                  />
                </span>
                <span className="truncate border-t border-gray-100 px-2.5 py-1.5 text-xs text-gray-600">
                  {figureLabel(item.file)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {openIndex !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-black/90 p-2 sm:p-3"
          style={{ overscrollBehaviorY: "contain" }}
          role="dialog"
          aria-modal="true"
          onClick={close}
        >
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/20"
          >
            Esc ✕
          </button>
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); step(-1); }}
            aria-label="Previous figure"
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-xl text-white hover:bg-white/20"
          >
            ←
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={items[openIndex].url}
            alt={figureLabel(items[openIndex].file)}
            onClick={(event) => event.stopPropagation()}
            className="max-h-[85vh] max-w-[85vw] rounded-lg bg-white object-contain shadow-2xl"
          />
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); step(1); }}
            aria-label="Next figure"
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-xl text-white hover:bg-white/20"
          >
            →
          </button>
          <p className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-4 py-1.5 text-sm text-white">
            {figureLabel(items[openIndex].file)} · {openIndex + 1} / {items.length}
          </p>
        </div>
      )}
    </div>
  );
}
