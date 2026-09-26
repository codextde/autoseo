import type { ChatAttachmentKind } from "../types";

/** Attachment limits shared by the upload endpoint and the composer (client-side pre-check). */
export const ATTACHMENT_LIMITS: { maxBytes: Record<ChatAttachmentKind, number>; accept: string } = {
  maxBytes: {
    image: 10 * 1024 * 1024,
    pdf: 20 * 1024 * 1024,
    csv: 5 * 1024 * 1024,
    text: 2 * 1024 * 1024,
  },
  accept: "image/png,image/jpeg,image/gif,image/webp,application/pdf,.pdf,.csv,.tsv,.txt,.md,.markdown,.json,text/csv,text/plain,text/markdown,application/json",
};

export const MAX_ATTACHMENTS_PER_MESSAGE = 6;
export const MAX_MESSAGE_CHARS = 32_000;

/** Best-effort client-side classification (the server re-checks the file content). */
export function guessAttachmentKind(file: { name: string; type: string }): ChatAttachmentKind | null {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (/^image\/(png|jpeg|gif|webp)$/.test(file.type) || ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  if (file.type === "application/pdf" || ext === "pdf") return "pdf";
  if (file.type === "text/csv" || ext === "csv" || ext === "tsv") return "csv";
  if (file.type.startsWith("text/") || file.type === "application/json" || ["txt", "md", "markdown", "json"].includes(ext)) return "text";
  return null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
