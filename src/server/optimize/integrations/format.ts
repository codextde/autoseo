/**
 * Markdown → provider rich-text formats (Jira ADF, Notion blocks). Pure: no server-only / alias imports.
 * Supports what task descriptions use: headings, paragraphs, bullet / numbered / checkbox lists, quotes,
 * fenced code, **bold**, *italic*, `code` and [links](https://…).
 */

export type MdBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullet"; items: string[] }
  | { type: "ordered"; items: string[] }
  | { type: "todo"; items: { text: string; done: boolean }[] }
  | { type: "quote"; text: string }
  | { type: "code"; text: string }
  | { type: "rule" };

export function parseMarkdownBlocks(md: string): MdBlock[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "paragraph", text: para.join(" ").trim() });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) code.push(lines[i++]!);
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    if (!trimmed) {
      flush();
      continue;
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1]!.length, text: heading[2]!.trim() });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      blocks.push({ type: "rule" });
      continue;
    }
    const todo = trimmed.match(/^[-*+]\s+\[( |x|X)\]\s+(.*)$/);
    if (todo) {
      flush();
      const last = blocks[blocks.length - 1];
      const item = { text: todo[2]!.trim(), done: todo[1] !== " " };
      if (last?.type === "todo") last.items.push(item);
      else blocks.push({ type: "todo", items: [item] });
      continue;
    }
    const bullet = trimmed.match(/^[-*+]\s+(.*)$/);
    if (bullet) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.type === "bullet") last.items.push(bullet[1]!.trim());
      else blocks.push({ type: "bullet", items: [bullet[1]!.trim()] });
      continue;
    }
    const ordered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (ordered) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.type === "ordered") last.items.push(ordered[1]!.trim());
      else blocks.push({ type: "ordered", items: [ordered[1]!.trim()] });
      continue;
    }
    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.type === "quote") last.text += ` ${quote[1]}`;
      else blocks.push({ type: "quote", text: quote[1]!.trim() });
      continue;
    }
    para.push(trimmed);
  }
  flush();
  return blocks;
}

export type InlineRun = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string };

const INLINE_RE = /(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*]+)\*)|(_([^_]+)_)/g;

export function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) runs.push({ text: text.slice(last, idx) });
    if (m[1]) runs.push({ text: m[2]!, href: m[3]! });
    else if (m[4]) runs.push({ text: m[5]!, bold: true });
    else if (m[6]) runs.push({ text: m[7]!, code: true });
    else if (m[8]) runs.push({ text: m[9]!, italic: true });
    else if (m[10]) runs.push({ text: m[11]!, italic: true });
    last = idx + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.filter((r) => r.text.length > 0);
}

/* ─────────────────────────── Jira ADF ─────────────────────────── */

type AdfNode = Record<string, unknown>;

function adfInline(text: string): AdfNode[] {
  const nodes = parseInline(text).map((r) => {
    const marks: AdfNode[] = [];
    if (r.bold) marks.push({ type: "strong" });
    if (r.italic) marks.push({ type: "em" });
    if (r.code) marks.push({ type: "code" });
    if (r.href) marks.push({ type: "link", attrs: { href: r.href } });
    return marks.length ? { type: "text", text: r.text, marks } : { type: "text", text: r.text };
  });
  return nodes.length ? nodes : [{ type: "text", text: " " }];
}

const listItem = (text: string): AdfNode => ({ type: "listItem", content: [{ type: "paragraph", content: adfInline(text) }] });

/** Atlassian Document Format (Jira Cloud REST v3 `description`). */
export function markdownToAdf(md: string): AdfNode {
  const content: AdfNode[] = [];
  for (const b of parseMarkdownBlocks(md)) {
    switch (b.type) {
      case "heading":
        content.push({ type: "heading", attrs: { level: Math.min(6, Math.max(1, b.level)) }, content: adfInline(b.text) });
        break;
      case "paragraph":
        content.push({ type: "paragraph", content: adfInline(b.text) });
        break;
      case "bullet":
        content.push({ type: "bulletList", content: b.items.map(listItem) });
        break;
      case "ordered":
        content.push({ type: "orderedList", content: b.items.map(listItem) });
        break;
      case "todo":
        content.push({ type: "bulletList", content: b.items.map((i) => listItem(`${i.done ? "☑" : "☐"} ${i.text}`)) });
        break;
      case "quote":
        content.push({ type: "blockquote", content: [{ type: "paragraph", content: adfInline(b.text) }] });
        break;
      case "code":
        content.push({ type: "codeBlock", content: b.text ? [{ type: "text", text: b.text }] : [] });
        break;
      case "rule":
        content.push({ type: "rule" });
        break;
    }
  }
  if (!content.length) content.push({ type: "paragraph", content: [{ type: "text", text: " " }] });
  return { type: "doc", version: 1, content };
}

/* ─────────────────────────── Notion blocks ─────────────────────────── */

function notionRichText(text: string) {
  // Notion limits a single text object to 2000 chars.
  return parseInline(text).flatMap((r) => {
    const chunks: string[] = [];
    for (let i = 0; i < r.text.length; i += 1900) chunks.push(r.text.slice(i, i + 1900));
    return chunks.map((chunk) => ({
      type: "text",
      text: { content: chunk, ...(r.href ? { link: { url: r.href } } : {}) },
      annotations: { bold: !!r.bold, italic: !!r.italic, code: !!r.code },
    }));
  });
}

/** Notion block children (max 100 per request — callers slice). */
export function markdownToNotionBlocks(md: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const block = (type: string, body: Record<string, unknown>) => ({ object: "block", type, [type]: body });
  for (const b of parseMarkdownBlocks(md)) {
    switch (b.type) {
      case "heading": {
        const t = b.level <= 1 ? "heading_1" : b.level === 2 ? "heading_2" : "heading_3";
        out.push(block(t, { rich_text: notionRichText(b.text) }));
        break;
      }
      case "paragraph":
        out.push(block("paragraph", { rich_text: notionRichText(b.text) }));
        break;
      case "bullet":
        for (const i of b.items) out.push(block("bulleted_list_item", { rich_text: notionRichText(i) }));
        break;
      case "ordered":
        for (const i of b.items) out.push(block("numbered_list_item", { rich_text: notionRichText(i) }));
        break;
      case "todo":
        for (const i of b.items) out.push(block("to_do", { rich_text: notionRichText(i.text), checked: i.done }));
        break;
      case "quote":
        out.push(block("quote", { rich_text: notionRichText(b.text) }));
        break;
      case "code":
        out.push(block("code", { rich_text: [{ type: "text", text: { content: b.text.slice(0, 1900) } }], language: "plain text" }));
        break;
      case "rule":
        out.push(block("divider", {}));
        break;
    }
  }
  return out;
}

/** Plain text with light markdown kept (for tools without rich text, e.g. Asana notes, Trello desc). */
export function markdownToPlain(md: string): string {
  return md
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/^#{1,6}\s+(.*)$/gm, (_, t: string) => t.toUpperCase())
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
