"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/wiki", label: "Wiki" },
  { href: "/knowledge", label: "Knowledge" },
  { href: "/chat", label: "Chat" },
  { href: "/citations", label: "Citations" },
  { href: "/health", label: "Health" },
];

export default function NavLinks({ pieceCount }: { pieceCount: number }) {
  const pathname = usePathname();

  const isActive = (href: string): boolean => {
    if (href === "/wiki") {
      return (
        pathname === "/" ||
        pathname.startsWith("/wiki") ||
        pathname.startsWith("/paper") ||
        pathname.startsWith("/pdfs") ||
        pathname.startsWith("/figures")
      );
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {LINKS.map((link) => {
        const active = isActive(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${
              active ? "bg-gray-900 font-medium text-white" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            }`}
          >
            {link.label}
            {link.href === "/knowledge" && pieceCount > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                  active ? "bg-white/20 text-white" : "bg-violet-100 text-violet-700"
                }`}
              >
                {pieceCount}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
