"use client";

import { useEffect, useState } from "react";
import WikiMarkdown from "./WikiMarkdown";
import AddToKnowledgeButton from "./AddToKnowledgeButton";
import { useLlmPrefs } from "./LlmPrefsProvider";
import { availabilityMessage } from "@/lib/llm-availability";

type ChatRole = "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };

const STORAGE_MESSAGES = "paperwiki:chat:messages";

export default function ChatPanel({ paperSlugs, topicSlugs }: { paperSlugs: string[]; topicSlugs: string[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [savedSlugs, setSavedSlugs] = useState<string[]>([]);
  const { prefs, availabilityState, availability } = useLlmPrefs();

  function toggleSelected(index: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  const selectedMessages = messages.filter((_, index) => selected.has(index));
  const selectionText = selectedMessages
    .map((message) => `[${message.role}]\n${message.content}`)
    .join("\n\n---\n\n");

  useEffect(() => {
    try {
      const storedMessages = localStorage.getItem(STORAGE_MESSAGES);
      if (storedMessages) {
        const parsed = JSON.parse(storedMessages) as ChatMessage[];
        if (Array.isArray(parsed)) setMessages(parsed.filter((message) => message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string"));
      }
    } catch {
      // Local storage is optional; the chat remains usable when it is unavailable.
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(messages));
  }, [messages]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || loading || !prefs.provider || !prefs.model) return;
    setQuestion("");
    setError(null);
    setMessages((current) => [...current, { role: "user", content: text }]);
    setLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text, history: messages.slice(-12), provider: prefs.provider, model: prefs.model }),
      });
      const data = (await response.json()) as { answer?: string; error?: string };
      if (!response.ok || !data.answer) throw new Error(data.error ?? "Chat request failed");
      setMessages((current) => [...current, { role: "assistant", content: data.answer! }]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Chat request failed");
    } finally {
      setLoading(false);
    }
  }

  const unavailableHint =
    availabilityState === "unavailable" && availability
      ? availabilityMessage(availability.kind, availability.provider, availability.model)
      : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_14rem]">
      <section className="flex min-h-[70vh] flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex-1 space-y-6 p-5 sm:p-7">
          {messages.length === 0 && (
            <div className="max-w-xl py-12">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Research query</p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-gray-950">Ask the wiki</h1>
              <p className="mt-3 text-sm leading-6 text-gray-600">Ask about the papers and topic syntheses in this knowledge base. Answers are grounded in retrieved wiki pages and cite them inline.</p>
            </div>
          )}
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={message.role === "user" ? "ml-auto max-w-2xl" : "max-w-3xl"}>
              <div className="mb-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={`Select message ${index + 1} to save to knowledge`}
                  checked={selected.has(index)}
                  onChange={() => toggleSelected(index)}
                  className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 accent-blue-700"
                />
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{message.role === "user" ? "You" : "PaperWiki"}</p>
              </div>
              {message.role === "assistant" ? (
                <WikiMarkdown content={message.content} paperSlugs={paperSlugs} topicSlugs={topicSlugs} />
              ) : (
                <p className="rounded-xl bg-gray-950 px-4 py-3 text-sm leading-6 text-white">{message.content}</p>
              )}
            </div>
          ))}
          {loading && <p className="text-sm text-gray-500">Searching the wiki and composing an answer…</p>}
          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          {!error && unavailableHint && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{unavailableHint}</p>
          )}
        </div>
        <form onSubmit={sendMessage} className="border-t border-gray-200 p-4 sm:p-5">
          {selectedMessages.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
              <p className="text-xs text-blue-800">
                {selectedMessages.length} message{selectedMessages.length === 1 ? "" : "s"} selected — chat is temporal, save
                the exchange as a knowledge piece before it scrolls away.
              </p>
              <div className="flex items-center gap-3">
                {savedSlugs.length > 0 && (
                  <span className="text-xs text-emerald-700">saved: {savedSlugs.join(", ")}</span>
                )}
                <AddToKnowledgeButton
                  kind="chat"
                  source={`chat-${new Date().toISOString()}`}
                  content={selectionText}
                  title={`chat-${messages.length}-messages`}
                  label="Save selection"
                  onDone={(slug) => {
                    if (slug) setSavedSlugs((current) => [...current, slug]);
                    setSelected(new Set());
                  }}
                />
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-xs text-gray-500 hover:text-gray-800"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
          <label htmlFor="chat-question" className="sr-only">Ask a question</label>
          <div className="flex gap-3">
            <textarea
              id="chat-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
              placeholder="What would you like to understand?"
              rows={2}
              className="min-w-0 flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none ring-blue-600 placeholder:text-gray-400 focus:ring-2"
            />
            <button type="submit" disabled={loading || !question.trim() || !prefs.provider || !prefs.model} className="self-end rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">Ask</button>
          </div>
          <p className="mt-2 text-xs text-gray-400">Enter to send · Shift+Enter for a new line</p>
        </form>
      </section>
      <aside className="h-fit rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Model</p>
        <p className="mt-1 text-sm text-gray-700">
          {prefs.provider || "…"}/{prefs.model || "…"}
        </p>
        <button type="button" onClick={() => setMessages([])} className="mt-5 text-sm text-gray-500 hover:text-red-600">Clear conversation</button>
        <p className="mt-6 text-xs leading-5 text-gray-400">Provider and model are configured site-wide in the top bar. Conversation state stays in this browser only and is never written to the wiki.</p>
      </aside>
    </div>
  );
}

