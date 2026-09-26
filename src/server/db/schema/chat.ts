// Schema for the "chat" module (Agent mode). Owned by that module; see docs/ARCHITECTURE.md.
import { pgTable, text, boolean, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt, ts } from "./_helpers";
import { projects, users } from "./core";
import type { ChatPart, ChatRuntimeInfo, ChatUsageInfo } from "@/features/chat/types";

/** One conversation of a user inside a project (chats are private to their author). */
export const chats = pgTable(
  "chats",
  {
    id: id("cht"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text().notNull().default("New chat"),
    /** "provisional" = derived from the first message (replaced by the AI title job), "auto" = AI, "user" = renamed. */
    titleSource: text({ enum: ["provisional", "auto", "user"] })
      .notNull()
      .default("provisional"),
    pinned: boolean().notNull().default(false),
    /** Last model selection used in this chat ("auto", "agent:claude", "api:anthropic", …). */
    modelSelection: text().notNull().default("auto"),
    messageCount: integer().notNull().default(0),
    lastMessageAt: ts().notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("chats_project_user_idx").on(t.projectId, t.userId, t.lastMessageAt)],
);

/** Messages with structured parts (text, thinking, tool calls + results, attachments, citations). */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: id("cmsg"),
    chatId: text()
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: text({ enum: ["user", "assistant"] }).notNull(),
    parts: jsonb().$type<ChatPart[]>().notNull().default([]),
    /** Plain text of the message (search + transcript replay). */
    content: text().notNull().default(""),
    status: text({ enum: ["streaming", "complete", "stopped", "error"] })
      .notNull()
      .default("complete"),
    error: text(),
    runtime: jsonb().$type<ChatRuntimeInfo | null>(),
    modelSelection: text(),
    usage: jsonb().$type<ChatUsageInfo | null>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("chat_messages_chat_idx").on(t.chatId, t.createdAt), index("chat_messages_project_idx").on(t.projectId)],
);

/** Uploaded files (stored under DATA_DIR/chat/<projectId>/). `messageId` is set once the file is sent. */
export const chatAttachments = pgTable(
  "chat_attachments",
  {
    id: id("catt"),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chatId: text().references(() => chats.id, { onDelete: "cascade" }),
    messageId: text().references(() => chatMessages.id, { onDelete: "set null" }),
    name: text().notNull(),
    mimeType: text().notNull(),
    kind: text({ enum: ["image", "pdf", "csv", "text"] }).notNull(),
    size: integer().notNull(),
    /** File name inside the project's chat upload folder (random, never user supplied). */
    storageName: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("chat_attachments_chat_idx").on(t.chatId), index("chat_attachments_user_idx").on(t.userId, t.createdAt)],
);

/** Thumbs up / down on assistant messages. */
export const chatFeedback = pgTable(
  "chat_feedback",
  {
    id: id("cfb"),
    messageId: text()
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    chatId: text()
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rating: text({ enum: ["up", "down"] }).notNull(),
    comment: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("chat_feedback_message_user_uq").on(t.messageId, t.userId), index("chat_feedback_project_idx").on(t.projectId)],
);
