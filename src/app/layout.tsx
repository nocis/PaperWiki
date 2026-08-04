import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { LlmPrefsProvider } from "@/components/LlmPrefsProvider";
import LlmStatusBanner from "@/components/LlmStatusBanner";
import NavLlmSelect from "@/components/NavLlmSelect";
import NavLinks from "@/components/NavLinks";
import { readPieces } from "@/lib/knowledge";

export const metadata: Metadata = {
  title: "PaperWiki",
  description: "LLM-compiled personal research-paper knowledge base",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pieces = await readPieces();

  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <LlmPrefsProvider>
          <header className="border-b border-gray-200 bg-white">
            <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
              <Link href="/" className="text-lg font-semibold">
                PaperWiki
              </Link>
              <NavLinks pieceCount={pieces.length} />
              <div className="ml-auto">
                <NavLlmSelect />
              </div>
            </nav>
          </header>
          <LlmStatusBanner />
          <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        </LlmPrefsProvider>
      </body>
    </html>
  );
}
