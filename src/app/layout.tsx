import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { LlmPrefsProvider } from "@/components/LlmPrefsProvider";
import LlmStatusBanner from "@/components/LlmStatusBanner";
import NavLlmSelect from "@/components/NavLlmSelect";

export const metadata: Metadata = {
  title: "PaperWiki",
  description: "LLM-compiled personal research-paper knowledge base",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <LlmPrefsProvider>
          <header className="border-b border-gray-200 bg-white">
            <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
              <Link href="/" className="text-lg font-semibold">
                PaperWiki
              </Link>
              <Link href="/wiki" className="text-sm text-gray-600 hover:text-gray-900">
                Wiki
              </Link>
              <Link href="/chat" className="text-sm text-gray-600 hover:text-gray-900">
                Chat
              </Link>
              <Link href="/citations" className="text-sm text-gray-600 hover:text-gray-900">
                Citations
              </Link>
              <Link href="/health" className="text-sm text-gray-600 hover:text-gray-900">
                Health
              </Link>
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
