"use client";

import { useEffect, useState } from "react";
import WikiMarkdown from "./WikiMarkdown";

type ChatRole = "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };

const STORAGE_MESSAGES = "paperwiki:chat:messages";
const STORAGE_MODEL = "paperwiki:chat:model";
const MODELS = [
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "glm-5.1",
  "glm-5.2",
  "gpt-5.6-luna",
  "grok-4.5",
  "kimi-k2.6",
  "kimi-k2.7-code",
  "kimi-k3",
  "minimax-m2.7",
  "minimax-m3",
  "qwen3.6",
  "qwen3.7",
  "hy3",
  "mimo-v2.5",
  "mimo-v2.5-pro",
];

export default function ChatPanel({ paperSlugs, topicSlugs }: { paperSlugs: string[]; topicSlugs: string[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [model, setModel] = useState(MODELS[0]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const storedMessages = localStorage.getItem(STORAGE_MESSAGES);
      const storedModel = localStorage.getItem(STORAGE_MODEL);
      if (storedMessages) {
        const parsed = JSON.parse(storedMessages) as ChatMessage[];
        if (Array.isArray(parsed)) setMessages(parsed.filter((message) => message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string"));
      }
      if (storedModel && MODELS.includes(storedModel)) setModel(storedModel);
    } catch {
      // Local storage is optional; the chat remains usable when it is unavailable.
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    localStorage.setItem(STORAGE_MODEL, model);
  }, [model]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || loading) return;
    setQuestion("");
    setError(null);
    setMessages((current) => [...current, { role: "user", content: text }]);
    setLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text, history: messages.slice(-12), model }),
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
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{message.role === "user" ? "You" : "PaperWiki"}</p>
              {message.role === "assistant" ? (
                <WikiMarkdown content={message.content} paperSlugs={paperSlugs} topicSlugs={topicSlugs} />
              ) : (
                <p className="rounded-xl bg-gray-950 px-4 py-3 text-sm leading-6 text-white">{message.content}</p>
              )}
            </div>
          ))}
          {loading && <p className="text-sm text-gray-500">Searching the wiki and composing an answer…</p>}
          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        </div>
        <form onSubmit={sendMessage} className="border-t border-gray-200 p-4 sm:p-5">
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
            <button type="submit" disabled={loading || !question.trim()} className="self-end rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">Ask</button>
          </div>
          <p className="mt-2 text-xs text-gray-400">Enter to send · Shift+Enter for a new line</p>
        </form>
      </section>
      <aside className="h-fit rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <label htmlFor="chat-model" className="text-xs font-semibold uppercase tracking-wider text-gray-500">Model</label>
        <select id="chat-model" value={model} onChange={(event) => setModel(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm">
          {MODELS.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}
        </select>
        <button type="button" onClick={() => setMessages([])} className="mt-5 text-sm text-gray-500 hover:text-red-600">Clear conversation</button>
        <p className="mt-6 text-xs leading-5 text-gray-400">Conversation state stays in this browser only and is never written to the wiki.</p>
      </aside>
    </div>
  );
}
