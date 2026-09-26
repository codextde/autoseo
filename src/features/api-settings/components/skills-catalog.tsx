"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Download, FileArchive, Package, Search, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/app/page";
import { CopyButton } from "@/components/app/misc";
import { useUrlState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block";
import { SkillMarkdown } from "./skill-markdown";

export type SkillView = {
  slug: string;
  title: string;
  description: string;
  group: string;
  groupLabel: string;
  body: string;
  bytes: number;
};

/** Skills tab: catalog of all agent skills with a detail view, copy and downloads. */
export function SkillsCatalog({ skills, downloads }: { skills: SkillView[]; downloads: { skillsZip: string; pluginZip: string } }) {
  const [selected, setSelected] = useUrlState("skill", "");
  const [query, setQuery] = useState("");
  const [raw, setRaw] = useState(false);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? skills.filter((s) => `${s.slug} ${s.title} ${s.description}`.toLowerCase().includes(q)) : skills;
  }, [skills, query]);
  const groups = useMemo(() => {
    const map = new Map<string, SkillView[]>();
    for (const s of filtered) map.set(s.groupLabel, [...(map.get(s.groupLabel) ?? []), s]);
    return [...map.entries()];
  }, [filtered]);
  const current = skills.find((s) => s.slug === selected) ?? null;
  const shown = current ?? skills[0] ?? null;

  if (!skills.length) {
    return (
      <Panel title="Skills">
        <p className="text-sm text-muted-foreground">The skills catalog was not found on this server (expected in plugins/autoseo/skills).</p>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Agent skills"
        icon={<Sparkles className="size-4 text-brand" />}
        description={`${skills.length} skills teach your agent complete SEO and AI-visibility workflows on top of the MCP tools. They ship with the AutoSEO plugin, or copy them into your agent's skills folder.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={downloads.skillsZip} download>
                <FileArchive className="size-3.5" /> All skills (.zip)
              </a>
            </Button>
            <Button size="sm" asChild>
              <a href={downloads.pluginZip} download>
                <Package className="size-3.5" /> Plugin (.zip)
              </a>
            </Button>
          </div>
        }
      >
        <p className="text-xs text-muted-foreground">
          In Claude Code the plugin namespaces skills as <code className="font-mono">/autoseo:&lt;skill&gt;</code>; installed standalone (e.g. in
          <code className="mx-1 font-mono">~/.claude/skills/&lt;skill&gt;/SKILL.md</code>) they are <code className="font-mono">/&lt;skill&gt;</code>. Workflow skills
          save their result as a report in Report Builder.
        </p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className={cn("min-w-0 space-y-3", current && "hidden lg:block")}>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search skills" className="h-8 pl-8 text-sm" />
          </div>
          {groups.map(([label, list]) => (
            <div key={label} className="space-y-1">
              <div className="px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</div>
              {list.map((s) => (
                <button
                  key={s.slug}
                  type="button"
                  onClick={() => setSelected(s.slug)}
                  className={cn(
                    "w-full rounded-xl border px-3 py-2 text-left transition-colors",
                    shown?.slug === s.slug ? "border-foreground/20 bg-muted/60" : "bg-card hover:bg-muted/40",
                  )}
                >
                  <span className="block truncate font-mono text-[12.5px] font-medium">{s.slug}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{s.description}</span>
                </button>
              ))}
            </div>
          ))}
          {!filtered.length && <p className="px-1 text-sm text-muted-foreground">No skill matches “{query}”.</p>}
        </div>

        {shown && (
          <div className={cn("min-w-0", !current && "hidden lg:block")}>
            <Panel
              title={
                <span className="flex min-w-0 items-center gap-2">
                  {current && (
                    <Button variant="ghost" size="icon-sm" className="-ml-1 lg:hidden" onClick={() => setSelected(null)} aria-label="Back to skills">
                      <ArrowLeft className="size-4" />
                    </Button>
                  )}
                  <span className="truncate">{shown.title}</span>
                </span>
              }
              description={shown.description}
              actions={
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setRaw((r) => !r)}>
                    {raw ? "Rendered" : "SKILL.md source"}
                  </Button>
                  <CopyButton value={shown.body} label="Copy" />
                  <Button variant="outline" size="sm" asChild>
                    <a href={`/api/plugin/skills/${shown.slug}?download=1`} download={`SKILL.md`}>
                      <Download className="size-3.5" /> Download
                    </a>
                  </Button>
                </div>
              }
            >
              <div className="mb-4 flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                  {shown.groupLabel}
                </Badge>
                <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px]">
                  /autoseo:{shown.slug}
                </Badge>
                <span className="text-[11px] text-muted-foreground tabular">{(shown.bytes / 1024).toFixed(1)} KB</span>
              </div>
              {raw ? <CodeBlock label={`skills/${shown.slug}/SKILL.md`} code={shown.body} /> : <SkillMarkdown body={shown.body} />}
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}
