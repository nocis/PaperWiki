import ChatPanel from "@/components/ChatPanel";
import { loadDb } from "@/lib/wiki";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const db = await loadDb();
  return <ChatPanel paperSlugs={db.papers.map((paper) => paper.slug)} topicSlugs={db.topics.map((topic) => topic.slug)} />;
}
