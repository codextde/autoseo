"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, Code2, Info, MousePointer2, Plug, TerminalSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Panel } from "@/components/app/page";
import { CopyButton } from "@/components/app/misc";
import { EngineIcon } from "@/components/app/engine-icon";
import { cn } from "@/lib/utils";
import { mcpClientGuides, type McpClientGuide } from "../setup-content";
import { CodeBlock } from "./code-block";

function ClientIcon({ id }: { id: string }) {
  if (id === "claude" || id === "claude-code") {
    return (
      <span className="relative">
        <EngineIcon id="claude" size="md" withTooltip={false} />
        {id === "claude-code" && (
          <TerminalSquare className="absolute -right-1 -bottom-1 size-3.5 rounded-sm bg-background p-px text-foreground" />
        )}
      </span>
    );
  }
  if (id === "chatgpt" || id === "codex") {
    return (
      <span className="relative">
        <EngineIcon id="chatgpt" size="md" withTooltip={false} />
        {id === "codex" && <TerminalSquare className="absolute -right-1 -bottom-1 size-3.5 rounded-sm bg-background p-px text-foreground" />}
      </span>
    );
  }
  const Icon = id === "cursor" ? MousePointer2 : Code2;
  return (
    <span className={cn("inline-flex size-7 items-center justify-center rounded-lg text-white shadow-xs", id === "cursor" ? "bg-neutral-900 dark:bg-neutral-700" : "bg-sky-600")}>
      <Icon className="size-4" />
    </span>
  );
}

function AuthBadge({ auth }: { auth: McpClientGuide["auth"] }) {
  const label = auth === "oauth" ? "OAuth" : auth === "bearer" ? "Bearer API key" : "OAuth or API key";
  return (
    <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px] font-medium", auth !== "bearer" && "border-brand/30 bg-brand/8 text-brand")}>
      {label}
    </Badge>
  );
}

export type McpToolGroup = { id: string; label: string; tools: { name: string; title: string; scope: string; paid: boolean }[] };

function ToolList({ groups, docsUrl }: { groups: McpToolGroup[]; docsUrl: string }) {
  const total = groups.reduce((n, g) => n + g.tools.length, 0);
  return (
    <details className="group rounded-xl border bg-muted/20">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm select-none">
        <span className="font-medium">
          {total} tools <span className="font-normal text-muted-foreground">in {groups.length} areas</span>
        </span>
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-3 border-t px-3 py-3">
        {groups.map((g) => (
          <div key={g.id} className="space-y-1.5">
            <Link href={`${docsUrl}#mcp-${g.id}`} className="text-xs font-medium text-muted-foreground hover:text-foreground">
              {g.label} · {g.tools.length}
            </Link>
            <div className="flex flex-wrap gap-1">
              {g.tools.map((t) => (
                <span
                  key={t.name}
                  title={`${t.title} — ${t.scope} scope${t.paid ? " + spend (can incur cost)" : ""}`}
                  className={cn(
                    "rounded-md border bg-background px-1.5 py-0.5 font-mono text-[10.5px]",
                    t.paid && "border-warning/40",
                    t.scope !== "read" && "border-brand/40",
                  )}
                >
                  {t.name}
                </span>
              ))}
            </div>
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground">
          <span className="text-brand">Green</span> = needs the write scope · <span className="text-warning">amber</span> = can incur cost (DataForSEO / AI) — needs the “Spend credits” scope plus the matching role permission.
        </p>
      </div>
    </details>
  );
}

export function McpPanel({ mcpUrl, docsUrl, toolGroups }: { mcpUrl: string; docsUrl: string; toolGroups: McpToolGroup[] }) {
  const guides = useMemo(() => mcpClientGuides(mcpUrl), [mcpUrl]);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = guides.find((g) => g.id === openId) ?? null;

  return (
    <Panel
      title="MCP Server"
      icon={<Plug className="size-4 text-brand" />}
      description="Connect Claude, ChatGPT, Cursor, VS Code or Codex to your AI visibility data."
      actions={
        <Button variant="outline" size="sm" asChild>
          <Link href={`${docsUrl}#mcp`}>
            <BookOpen className="size-3.5" /> Setup guide
          </Link>
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Server URL (Streamable HTTP)</span>
          <div className="flex min-w-0 items-center gap-2 rounded-xl border bg-muted/40 py-1.5 pr-1.5 pl-3">
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-success" aria-hidden />
            <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{mcpUrl}</code>
            <CopyButton value={mcpUrl} />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {guides.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setOpenId(g.id)}
              className="group flex min-w-0 items-center gap-3 rounded-xl border bg-background px-3 py-2.5 text-left transition-colors hover:border-foreground/20 hover:bg-muted/40"
            >
              <ClientIcon id={g.id} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium">{g.name}</span>
                <span className="mt-0.5 block">
                  <AuthBadge auth={g.auth} />
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
        <ToolList groups={toolGroups} docsUrl={docsUrl} />
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Info className="mt-px size-3 shrink-0" />
          OAuth clients register themselves automatically and ask you to approve access here. Bearer clients use an API key from the list above.
        </p>
      </div>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2.5">
                  <ClientIcon id={open.id} /> Connect {open.name}
                </DialogTitle>
                <DialogDescription>{open.summary}</DialogDescription>
              </DialogHeader>
              <ol className="space-y-2">
                {open.steps.map((s, i) => (
                  <li key={i} className="flex gap-2.5 text-sm">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular">{i + 1}</span>
                    <span className="pt-px">{s}</span>
                  </li>
                ))}
              </ol>
              <div className="space-y-2">
                {open.snippets.map((s, i) => (
                  <CodeBlock key={i} label={s.label} code={s.code} />
                ))}
              </div>
              {open.note && (
                <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
                  <Info className="mt-px size-3.5 shrink-0 text-warning" />
                  {open.note}
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
