import * as fs from "fs/promises";
import * as path from "path";
import matter from "gray-matter";
import { NextRequest, NextResponse } from "next/server";
import { buildAnswerMessages, queryRetrievePrompt, type QueryRetrieval } from "@/lib/prompts";
import { llmChat, llmJson, resolveModel, type ChatMessage } from "@/lib/llm";
import {
  INDEX_MD,
  WIKI_DIR,
  readPaperPages,
  readTopicPages,
} from "@/lib/wiki";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_HISTORY = 12;
const MAX_MESSAGE_CHARS = 8_000;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function validHistory(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((message): message is { role: "user" | "assistant"; content: string } => (
      typeof message === "object" && message !== null &&
      ((message as { role?: unknown }).role === "user" || (message as { role?: unknown }).role === "assistant") &&
      typeof (message as { content?: unknown }).content === "string"
    ))
    .slice(-MAX_HISTORY)
    .map((message) => ({ role: message.role, content: message.content.slice(0, MAX_MESSAGE_CHARS) }));
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("invalid JSON body");
  }

  const input = body as Record<string, unknown>;
  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (!question) return bad("question (non-empty string) is required");
  if (question.length > MAX_MESSAGE_CHARS) return bad("question is too long");

  try {
    const [index, schema, paperPages, topicPages] = await Promise.all([
      fs.readFile(INDEX_MD, "utf8"),
      fs.readFile(path.join(WIKI_DIR, "SCHEMA.md"), "utf8"),
      readPaperPages(),
      readTopicPages(),
    ]);
    const model = resolveModel(typeof input.model === "string" ? input.model : undefined);
    const retrieval = await llmJson<QueryRetrieval>({
      model,
      ...queryRetrievePrompt({ index, question }),
      maxTokens: 1200,
      temperature: 0.1,
    });
    const requestedPages = Array.isArray(retrieval?.pages) ? retrieval.pages.filter((slug): slug is string => typeof slug === "string") : [];
    const requestedPapers = Array.isArray(retrieval?.papers) ? retrieval.papers.filter((slug): slug is string => typeof slug === "string") : [];
    const paperBySlug = new Map(paperPages.map((page) => [page.fm.slug, page]));
    const topicBySlug = new Map(topicPages.map((page) => [page.fm.slug, page]));
    const pages = requestedPages
      .map((slug) => topicBySlug.get(slug))
      .filter(Boolean)
      .map((page) => ({ slug: page!.fm.slug, content: page!.body }));
    const papers = requestedPapers
      .map((slug) => paperBySlug.get(slug))
      .filter(Boolean)
      .map((page) => ({ slug: page!.fm.slug, content: page!.body }));
    const indexFrontmatter = matter(index).data;
    const messages = buildAnswerMessages({
      schema,
      contextPages: [...pages, ...papers].slice(0, 6),
      history: validHistory(input.history),
      language: typeof indexFrontmatter.wiki_language === "string" ? indexFrontmatter.wiki_language : "en",
    });
    const answer = await llmChat({ model, messages, maxTokens: 4096, temperature: 0.3 });
    return NextResponse.json({
      answer,
      retrieved: { pages: pages.map((page) => page.slug), papers: papers.map((paper) => paper.slug) },
      model,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "chat request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
