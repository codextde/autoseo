"use client";

import { useRef, useState } from "react";
import {
  BarChart3,
  Circle,
  Gauge,
  Heading1,
  ImageIcon,
  Link2,
  List,
  Minus,
  Plus,
  Scan,
  Square,
  Table2,
  Triangle,
  Type,
  LayoutGrid,
  Hash,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CHARTS, LISTS, TABLES, TOKENS } from "../../lib/catalog";
import { addElement, uploadAndInsert } from "./commands";
import { useEditor, useEditorState } from "./store";

function groupBy<T>(entries: [string, T][], cat: (v: T) => string) {
  const out = new Map<string, [string, T][]>();
  for (const e of entries) {
    const c = cat(e[1]);
    if (!out.has(c)) out.set(c, []);
    out.get(c)!.push(e);
  }
  return [...out.entries()];
}

const KPI_METRICS = ["ai.visibility", "ai.mention_rate", "ai.citation_rate", "ai.avg_position", "ai.sentiment", "ai.share_of_voice", "ai.geo_score", "ai.citations", "ai.tracked_prompts", "ai.prompt_coverage", "gsc.clicks", "traffic.ai_sessions", "tasks.open"];
const SCORE_METRICS = ["ai.geo_score", "ai.visibility", "ai.mention_rate", "ai.citation_rate", "ai.share_of_voice", "ai.prompt_coverage", "ai.sentiment", "seo.audit_score", "seo.crawlability_score"];

export function CanvasToolbar({ zoom, fit }: { zoom: number; fit: number }) {
  const { store, projectId, canManage } = useEditor();
  const zoomSetting = useEditorState((s) => s.zoom);
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [urlOpen, setUrlOpen] = useState(false);
  const setZoom = (z: number | "fit") => store.set({ zoom: z === "fit" ? "fit" : Math.max(0.1, Math.min(3, Math.round(z * 100) / 100)) });
  const steps = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3];
  const tool = (label: string, icon: React.ReactNode, onClick: () => void, shortcut?: string) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5" onClick={onClick} disabled={!canManage}>
          {icon}
          <span className="hidden lg:inline">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut && <span className="ml-2 text-muted-foreground">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  );

  return (
    <div data-toolbar className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
      <div className="pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-2xl border bg-popover/95 p-1 shadow-lg backdrop-blur scrollbar-none">
        {tool("Text", <Type className="size-4" />, () => addElement(store, { kind: "text" }), "T")}
        {tool("Heading", <Heading1 className="size-4" />, () => addElement(store, { kind: "heading" }))}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5" disabled={!canManage}>
              <Square className="size-4" />
              <span className="hidden lg:inline">Box</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center">
            <DropdownMenuItem onClick={() => addElement(store, { kind: "shape", shape: "rect" })}>
              <Square /> Rectangle <span className="ml-auto text-xs text-muted-foreground">R</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => addElement(store, { kind: "shape", shape: "ellipse" })}>
              <Circle /> Ellipse
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => addElement(store, { kind: "shape", shape: "triangle" })}>
              <Triangle /> Triangle
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => addElement(store, { kind: "shape", shape: "line" })}>
              <Minus /> Line
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover open={urlOpen} onOpenChange={setUrlOpen}>
          <PopoverAnchor asChild>
          <div>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5" disabled={!canManage}>
                <ImageIcon className="size-4" />
                <span className="hidden lg:inline">Image</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="center">
              <DropdownMenuItem onClick={() => fileRef.current?.click()}>
                <ImageIcon /> Upload image…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setUrlOpen(true)}>
                <Link2 /> From URL…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => addElement(store, { kind: "image", token: "client.logo" })}>Client logo (live)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => addElement(store, { kind: "image", token: "agency.logo" })}>Agency logo (live)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
          </PopoverAnchor>
          <PopoverContent side="top" className="w-80 space-y-2">
            <div className="text-sm font-medium">Insert image from URL</div>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/image.png" autoFocus />
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={!/^https?:\/\/.+/i.test(url)}
                onClick={() => {
                  addElement(store, { kind: "image", url });
                  setUrl("");
                  setUrlOpen(false);
                }}
              >
                Insert
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) void uploadAndInsert(store, projectId, files);
          }}
        />
        <Separator orientation="vertical" className="mx-1 h-5" />
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5" disabled={!canManage}>
              <BarChart3 className="size-4" />
              <span className="hidden lg:inline">Chart</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center" className="max-h-96 w-64 overflow-y-auto">
            {groupBy(Object.entries(CHARTS), (d) => d.category).map(([cat, items]) => (
              <div key={cat}>
                <DropdownMenuLabel className="text-xs text-muted-foreground">{cat}</DropdownMenuLabel>
                {items.map(([key, def]) => (
                  <DropdownMenuItem key={key} onClick={() => addElement(store, { kind: "chart", metric: key })}>
                    {def.label}
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5" disabled={!canManage}>
              <LayoutGrid className="size-4" />
              <span className="hidden lg:inline">Widget</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center" className="w-56">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Hash /> KPI tile
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                {KPI_METRICS.map((m) => (
                  <DropdownMenuItem key={m} onClick={() => addElement(store, { kind: "kpi", metric: m })}>
                    {TOKENS[m]?.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Gauge /> Score ring
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {SCORE_METRICS.map((m) => (
                  <DropdownMenuItem key={m} onClick={() => addElement(store, { kind: "score", metric: m })}>
                    {TOKENS[m]?.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <List /> Live list
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                {Object.entries(LISTS).map(([k, d]) => (
                  <DropdownMenuItem key={k} onClick={() => addElement(store, { kind: "list", source: k })}>
                    {d.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Table2 /> Table
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => addElement(store, { kind: "table" })}>Static table</DropdownMenuItem>
                <DropdownMenuSeparator />
                {Object.entries(TABLES).map(([k, d]) => (
                  <DropdownMenuItem key={k} onClick={() => addElement(store, { kind: "table", source: k })}>
                    {d.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Button size="icon-sm" variant="ghost" aria-label="Zoom out" onClick={() => setZoom([...steps].reverse().find((s) => s < zoom - 0.001) ?? steps[0]!)}>
          <Minus />
        </Button>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-8 w-16 px-1 tabular">
              {Math.round(zoom * 100)}%
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center">
            <DropdownMenuItem onClick={() => setZoom("fit")}>
              <Scan /> Fit {zoomSetting === "fit" && "✓"} <span className="ml-auto text-xs text-muted-foreground">{Math.round(fit * 100)}%</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {[0.25, 0.5, 0.75, 1, 1.5, 2].map((s) => (
              <DropdownMenuItem key={s} onClick={() => setZoom(s)}>
                {s * 100}%
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => setZoom(steps.find((s) => s > zoom + 0.001) ?? steps.at(-1)!)}>
          <Plus />
        </Button>
      </div>
    </div>
  );
}
