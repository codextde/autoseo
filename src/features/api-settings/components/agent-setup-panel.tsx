"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bot, Check, ClipboardCopy, FileArchive, Info, Package, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/app/page";
import { cn } from "@/lib/utils";
import { agentSetupPrompt, agentUpdatePrompt, pluginInstallGuides, type PluginUrls } from "../setup-content";
import { CodeBlock } from "./code-block";

function CopyPromptButton({ value, label, variant = "default" }: { value: string; label: string; variant?: "default" | "outline" }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant={variant}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <Check className="size-4" /> : <ClipboardCopy className="size-4" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

function PromptPreview({ text }: { text: string }) {
  return (
    <details className="group rounded-xl border bg-muted/30 px-3 py-2 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground select-none">Preview prompt</summary>
      <pre className="mt-2 max-h-64 overflow-auto font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">{text}</pre>
    </details>
  );
}

/** open-seo "Agent setup": setup + update prompts and plugin installation per agent. */
export function AgentSetupPanel({ urls, appName, skillCount }: { urls: PluginUrls; appName: string; skillCount: number }) {
  const setup = useMemo(() => agentSetupPrompt(urls, appName), [urls, appName]);
  const update = useMemo(() => agentUpdatePrompt(urls, appName), [urls, appName]);
  const guides = useMemo(() => pluginInstallGuides(urls), [urls]);
  const [guideId, setGuideId] = useState(guides[0]!.id);
  const guide = guides.find((g) => g.id === guideId) ?? guides[0]!;

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
        <Panel
          title="Set up your agent"
          icon={<Bot className="size-4 text-brand" />}
          description="The most powerful way to use AutoSEO is through the AI agent you already use. Set it up once, then ask it anything."
        >
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Paste the setup prompt into Claude Code, Codex, Cursor or another agent. It installs the AutoSEO plugin (MCP server + {skillCount} skills), falls back to the
              MCP URL and skills where plugins are unsupported, signs in, and verifies the connection.
            </p>
            <CopyPromptButton value={setup} label="Copy setup prompt" />
            <PromptPreview text={setup} />
          </div>
        </Panel>
        <Panel
          title="Update your skills"
          icon={<RefreshCw className="size-4 text-brand" />}
          description="Pull the latest AutoSEO skills into an agent that already has them, keeping your sign-in and personal edits."
        >
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Paste this into the agent after an AutoSEO update. It updates only AutoSEO, in the scope it was installed, and checks the skills are discoverable.
            </p>
            <CopyPromptButton value={update} label="Copy update prompt" variant="outline" />
            <PromptPreview text={update} />
          </div>
        </Panel>
      </div>

      <Panel
        title="Install the plugin"
        icon={<Package className="size-4 text-brand" />}
        description="Pre-configured for this instance — the MCP URL is built in and sign-in uses OAuth."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={urls.bundleZip} download>
                <FileArchive className="size-3.5" /> Marketplace bundle
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={urls.pluginZip} download>
                <Package className="size-3.5" /> Plugin
              </a>
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1">
            {guides.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGuideId(g.id)}
                className={cn(
                  "shrink-0 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                  g.id === guide.id ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {g.name}
              </button>
            ))}
          </div>
          <ol className="space-y-2">
            {guide.steps.map((s, i) => (
              <li key={i} className="flex gap-2.5 text-sm">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular">{i + 1}</span>
                <span className="pt-px">{s}</span>
              </li>
            ))}
          </ol>
          {guide.snippets.map((s, i) => (
            <CodeBlock key={i} label={s.label} code={s.code} />
          ))}
          {guide.note && (
            <p className="flex items-start gap-2 rounded-xl border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <Info className="mt-px size-3.5 shrink-0" />
              {guide.note}
            </p>
          )}
        </div>
      </Panel>

      <Link
        href="/settings/api?tab=skills"
        className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3 shadow-soft transition-colors hover:bg-muted/40"
      >
        <Sparkles className="size-4 shrink-0 text-brand" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Browse the {skillCount} skills</span>
          <span className="block text-xs text-muted-foreground">SEO audits, keyword research, local SEO, AI visibility reports — read, copy or download each SKILL.md.</span>
        </span>
      </Link>
    </div>
  );
}
