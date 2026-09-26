import type { ChatCitation, ChatPart, ChatStreamEvent } from "../types";

/**
 * Applies one stream event to an assistant message's parts (immutable — returns a new array when
 * something changed). Used by the server to accumulate what it persists and by the client to
 * render the live message, so both always agree.
 */
export function applyChatEvent(parts: ChatPart[], ev: ChatStreamEvent): ChatPart[] {
  switch (ev.type) {
    case "text": {
      if (!ev.delta) return parts;
      const next = closeThinking(parts, Date.now());
      const last = next[next.length - 1];
      if (last?.type === "text") return [...next.slice(0, -1), { ...last, text: last.text + ev.delta }];
      return [...next, { type: "text", text: ev.delta }];
    }
    case "thinking": {
      const last = parts[parts.length - 1];
      if (last?.type === "thinking" && !last.done) return [...parts.slice(0, -1), { ...last, text: last.text + ev.delta }];
      return [...parts, { type: "thinking", text: ev.delta, startedAt: ev.at }];
    }
    case "thinking_end":
      return closeThinking(parts, ev.at);
    case "tool_call": {
      const next = closeThinking(parts, ev.at);
      if (next.some((p) => p.type === "tool_call" && p.id === ev.id)) {
        if (ev.input === undefined && !ev.title) return next;
        return next.map((p) =>
          p.type === "tool_call" && p.id === ev.id ? { ...p, input: ev.input ?? p.input, title: ev.title ?? p.title } : p,
        );
      }
      return [
        ...next,
        { type: "tool_call", id: ev.id, name: ev.name, title: ev.title, input: ev.input, state: "running", source: ev.source, startedAt: ev.at },
      ];
    }
    case "tool_result": {
      let found = false;
      const next = parts.map((p) => {
        if (p.type !== "tool_call" || p.id !== ev.id) return p;
        found = true;
        return {
          ...p,
          state: ev.isError ? ("error" as const) : ("success" as const),
          output: ev.output,
          data: ev.data,
          error: ev.isError ? (ev.error ?? ev.output ?? "The tool failed.") : undefined,
          durationMs: p.startedAt ? Math.max(0, ev.at - p.startedAt) : undefined,
        };
      });
      return found ? next : parts;
    }
    case "citations": {
      if (!ev.items.length) return parts;
      const idx = parts.findIndex((p) => p.type === "citations");
      if (idx === -1) return [...parts, { type: "citations", items: dedupeCitations(ev.items) }];
      const existing = parts[idx] as Extract<ChatPart, { type: "citations" }>;
      const merged = dedupeCitations([...existing.items, ...ev.items]);
      return [...parts.slice(0, idx), { type: "citations", items: merged }, ...parts.slice(idx + 1)];
    }
    case "notice":
      return [...parts, { type: "notice", tone: ev.tone, text: ev.text }];
    case "snapshot":
      return ev.message.parts;
    case "done":
      return ev.message.parts;
    default:
      return parts;
  }
}

/** Marks an open thinking part as finished (records its duration). */
export function closeThinking(parts: ChatPart[], at: number): ChatPart[] {
  const i = parts.findLastIndex((p) => p.type === "thinking" && !p.done);
  if (i === -1) return parts;
  const p = parts[i] as Extract<ChatPart, { type: "thinking" }>;
  const durationMs = p.startedAt ? Math.max(0, at - p.startedAt) : p.durationMs;
  return [...parts.slice(0, i), { ...p, done: true, durationMs }, ...parts.slice(i + 1)];
}

/** Marks every running tool call as failed (used when a run stops or errors mid-way). */
export function settleRunningTools(parts: ChatPart[], reason: string): ChatPart[] {
  if (!parts.some((p) => p.type === "tool_call" && p.state === "running")) return closeThinking(parts, Date.now());
  return closeThinking(
    parts.map((p) => (p.type === "tool_call" && p.state === "running" ? { ...p, state: "error" as const, error: reason } : p)),
    Date.now(),
  );
}

export function dedupeCitations(list: ChatCitation[]): ChatCitation[] {
  const seen = new Set<string>();
  const out: ChatCitation[] = [];
  for (const c of list) {
    if (!c?.url || seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
  }
  return out;
}

/** Plain answer text (text parts only) — used for copy, search and the transcript sent to models. */
export function partsText(parts: ChatPart[]): string {
  return parts
    .filter((p): p is Extract<ChatPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("")
    .trim();
}

export function partsAttachments(parts: ChatPart[]) {
  return parts.filter((p): p is Extract<ChatPart, { type: "attachment" }> => p.type === "attachment").map((p) => p.attachment);
}

/** Short tool name for display: strips MCP prefixes like `mcp__autoseo__` or `autoseo.`. */
export function displayToolName(name: string): string {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(name);
  if (m) return m[2]!;
  return name.replace(/^autoseo[.:/]/, "");
}

export function isAutoseoTool(name: string): boolean {
  return /^mcp__autoseo__/.test(name) || /^autoseo[.:/]/.test(name);
}
