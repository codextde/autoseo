import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireProject } from "@/server/auth/guards";
import { getAgentPageData } from "@/server/chat/page-data";
import { getChat, listMessages } from "@/server/chat/store";
import { ChatView } from "@/features/chat/components/chat-view";

export async function generateMetadata({ params }: PageProps<"/p/[projectId]/agent/c/[chatId]">): Promise<Metadata> {
  const { projectId, chatId } = await params;
  const ctx = await requireProject(projectId, "project.view");
  const chat = await getChat(projectId, ctx.user.id, chatId);
  return { title: chat ? chat.title : "Agent" };
}

export default async function ChatPage({ params }: PageProps<"/p/[projectId]/agent/c/[chatId]">) {
  const { projectId, chatId } = await params;
  const ctx = await requireProject(projectId, "project.view");
  const chat = await getChat(projectId, ctx.user.id, chatId);
  if (!chat) notFound();
  const [messages, data] = await Promise.all([listMessages(chat.id, ctx.user.id), getAgentPageData(ctx)]);
  return (
    <ChatView
      key={chat.id}
      projectId={projectId}
      chatId={chat.id}
      initialMessages={messages}
      initialModel={chat.modelSelection}
      modelOptions={data.modelOptions}
      canChat={data.canChat}
      placeholder={data.canChat ? "Ask a follow-up…" : "Read-only access"}
    />
  );
}
