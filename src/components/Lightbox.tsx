"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface LightboxProps {
  children: ReactNode;
  alt?: string;
  className?: string;
}

/**
 * Click-to-fullscreen lightbox. Renders the children inline inside a button
 * (the trigger) and, when open, inside a fixed overlay portaled to
 * document.body. The overlay is position: fixed, so it is entirely out of the
 * document flow — opening it never moves or resizes the page. Background
 * scroll is locked via body overflow set directly in the click handlers.
 * Click the backdrop or the ✕ button to close.
 */
export default function Lightbox({ children, alt, className }: LightboxProps) {
  const [open, setOpen] = useState(false);

  const handleOpen = () => {
    setOpen(true);
    document.body.style.overflow = "hidden";
  };

  const handleClose = () => {
    setOpen(false);
    document.body.style.overflow = "";
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        aria-label="View fullscreen"
        title="Click to zoom in"
        className={className}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 cursor-zoom-out overflow-hidden overscroll-contain bg-black/10 px-1 py-12 backdrop-blur-md lg:p-24"
            onClick={handleClose}
            title="Click to zoom out"
            role="dialog"
            aria-modal="true"
            aria-label={alt ?? "Figure fullscreen"}
          >
            <div className="figure-lightbox-modal flex h-full w-full flex-col items-center justify-center">
              <button
                type="button"
                onClick={handleClose}
                aria-label="Close"
                className="absolute right-4 top-4 z-10 rounded-full bg-black/40 px-3 py-1.5 text-sm font-medium text-white hover:bg-black/60"
              >
                ✕
              </button>
              {children}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
