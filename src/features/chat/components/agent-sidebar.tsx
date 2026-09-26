"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, MessageSquarePlus, MoreHorizontal, Pencil, Pin, PinOff, Plug, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCan } from "@/components/app/shell-context";
import { cn } from "@/lib/utils";
import { deleteChatAction, pinChatAction, renameChatAction } from "../actions";
import { notifyChatsChanged } from "../lib/client";
import type { ChatSummary } from "../types";
import { ChatSearchDialog } from "./search-dialog";
import { UsageMeter } from "./usage-meter";
import { groupChats, useChatList } from "./use-chat-list";

function ChatItem({ chat, projectId, active }: { chat: ChatSummary; projectId: string; active: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(chat.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const href = `/p/${projectId}/agent/c/${chat.id}`;

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const saveTitle = () => {
    const t = title.trim();
    setEditing(false);
    if (!t || t === chat.title) {
      setTitle(chat.title);
      return;
    }
    notifyChatsChanged({ upsert: { ...chat, title: t } });
    startTransition(async () => {
      const res = await renameChatAction(projectId, chat.id, t);
      if (!res.ok) {
        toast.error(res.error);
        setTitle(chat.title);
      }
      notifyChatsChanged();
    });
  };

  const togglePin = () =>
    startTransition(async () => {
      notifyChatsChanged({ upsert: { ...chat, pinned: !chat.pinned } });
      const res = await pinChatAction(projectId, chat.id, !chat.pinned);
      if (!res.ok) toast.error(res.error);
      notifyChatsChanged();
    });

  const remove = () =>
    startTransition(async () => {
      const res = await deleteChatAction(projectId, chat.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      notifyChatsChanged({ removeId: chat.id });
      toast.success("Chat deleted");
      if (active) router.push(`/p/${projectId}/agent`);
    });

  if (editing) {
    return (
      <SidebarMenuItem>
        <input
          ref={inputRef}
          value={title}
          maxLength={120}
          aria-label="Chat name"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveTitle();
            if (e.key === "Escape") {
              setTitle(chat.title);
              setEditing(false);
            }
          }}
          className="h-8 w-full rounded-md border border-ring/50 bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={chat.title} className={cn(pending && "opacity-60")}>
        <Link href={href} onDoubleClick={() => setEditing(true)}>
          <span className="truncate">{chat.title}</span>
          {chat.streaming && <Loader2 className="ml-auto size-3.5 shrink-0 animate-spin text-brand" aria-label="Answering" />}
        </Link>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover aria-label={`Options for ${chat.title}`}>
            <MoreHorizontal />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-44">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={togglePin}>
            {chat.pinned ? <PinOff /> : <Pin />} {chat.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              “{chat.title}” and its messages and attachments will be removed permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarMenuItem>
  );
}

/** Sidebar content shown in Agent mode: new chat, search, integrations, recent chats, usage meter. */
export function AgentSidebarSection({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const can = useCan();
  const { data, error } = useChatList(projectId);
  const [searchOpen, setSearchOpen] = useState(false);
  const base = `/p/${projectId}/agent`;
  const activeId = pathname.startsWith(`${base}/c/`) ? pathname.slice(`${base}/c/`.length).split("/")[0] : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const groups = data ? groupChats(data.chats) : [];

  return (
    <>
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="New chat" isActive={pathname === base}>
              <Link href={base}>
                <MessageSquarePlus /> <span>New chat</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Search chats" onClick={() => setSearchOpen(true)}>
              <Search /> <span>Search chats</span>
              <kbd className="ml-auto hidden rounded border bg-background px-1 font-sans text-[10px] text-muted-foreground lg:inline">⇧⌘K</kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Integrations">
              <Link href={`/p/${projectId}/integrations`}>
                <Plug /> <span>Integrations</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>

      {!data && !error && (
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Recent</SidebarGroupLabel>
          <SidebarMenu>
            {Array.from({ length: 5 }).map((_, i) => (
              <SidebarMenuItem key={i}>
                <SidebarMenuSkeleton />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      )}
      {error && !data && <p className="px-4 text-xs text-destructive group-data-[collapsible=icon]:hidden">{error}</p>}
      {data && groups.length === 0 && (
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Recent</SidebarGroupLabel>
          <p className="px-2 text-xs text-muted-foreground">
            {data.canChat ? "No chats yet. Ask the agent anything to start one." : "No chats yet. You have read-only access to this project."}
          </p>
        </SidebarGroup>
      )}
      {groups.map((g) => (
        <SidebarGroup key={g.label} className="py-1 group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {g.chats.map((c) => (
                <ChatItem key={c.id} chat={c} projectId={projectId} active={c.id === activeId} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}

      {(!data || data.usage) && (
        <div className="mt-auto px-2 pt-3 pb-1 group-data-[collapsible=icon]:hidden">
          <UsageMeter usage={data?.usage ?? null} href={can("usage.view") ? "/settings/usage" : null} />
        </div>
      )}

      <ChatSearchDialog projectId={projectId} open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
