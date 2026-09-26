"use client";

import { useEffect, useRef, useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Meter } from "@/components/app/metrics";
import { cn } from "@/lib/utils";
import { Field, FIELD_CLASS } from "../form";
import { useToolRunner } from "../runner";
import { SectionTitle } from "../results";
import { breadcrumbParts, DESKTOP_TITLE_WIDTH, MOBILE_TEXT_WIDTH, TITLE_FONT } from "../../lib/serp";

export function SerpSimulatorTool({ initial }: { initial?: { title?: string; description?: string; url?: string } }) {
  const runner = useToolRunner();
  const exampleUrl = runner.projectDomain ? `https://${runner.projectDomain}/` : "https://example.com/serp-simulator";
  const [title, setTitle] = useState(initial?.title ?? `Free SERP Simulator: Preview Your Google Snippet | ${runner.appName}`);
  const [description, setDescription] = useState(
    initial?.description ??
      "Preview your title and meta description on desktop and mobile. Check how your text fits before publishing. Free, no signup.",
  );
  const [url, setUrl] = useState(initial?.url ?? exampleUrl);
  const [showDate, setShowDate] = useState(false);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [titleWidth, setTitleWidth] = useState<number | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    canvas.current ??= document.createElement("canvas");
    const ctx = canvas.current.getContext("2d");
    if (!ctx) return;
    ctx.font = TITLE_FONT;
    setTitleWidth(Math.round(ctx.measureText(title).width));
  }, [title]);

  const { host, crumbs, origin } = breadcrumbParts(url);
  const siteName = host.replace(/^www\./, "").split(".")[0] ?? "";
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const desktop = device === "desktop";
  const overDesktop = titleWidth !== null && titleWidth > DESKTOP_TITLE_WIDTH;

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-2xl border bg-card p-3.5 shadow-soft sm:p-4">
        <Field id="serp-title" label="Page title">
          <Input id="serp-title" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} className={FIELD_CLASS} />
          <div className="space-y-1 pt-0.5">
            <Meter value={titleWidth ?? 0} max={DESKTOP_TITLE_WIDTH} tone={overDesktop ? "warning" : "brand"} />
            <p className={cn("text-xs", overDesktop ? "text-warning" : "text-muted-foreground")}>
              <span className="tabular">{title.length}</span> characters · {titleWidth === null ? "Measuring width…" : <span className="tabular">{titleWidth}px</span>}
              {overDesktop ? " · Exceeds the 600px desktop preview" : " · Desktop guide: 600px"}
            </p>
          </div>
        </Field>
        <Field id="serp-description" label="Meta description" hint={`${description.length} characters · Check how the text wraps in each preview.`}>
          <Textarea
            id="serp-description"
            rows={3}
            maxLength={1000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-20 bg-background text-base sm:text-sm"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field id="serp-url" label="URL">
            <Input id="serp-url" inputMode="url" spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)} className={FIELD_CLASS} />
          </Field>
          <div className="flex h-10 items-center gap-2">
            <Switch id="serp-date" checked={showDate} onCheckedChange={setShowDate} />
            <Label htmlFor="serp-date" className="text-sm">
              Show date
            </Label>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">Free · Your text stays in your browser</p>
      </div>

      <section className="space-y-3" aria-label="Search result preview">
        <SectionTitle
          sub={`${desktop ? `Desktop preview at ${DESKTOP_TITLE_WIDTH}px text width.` : `Mobile preview at ${MOBILE_TEXT_WIDTH}px text width.`} Layout and truncation are approximate.`}
          actions={
            <div role="group" aria-label="Preview device" className="inline-flex rounded-lg border bg-muted/60 p-0.5">
              {(
                [
                  ["desktop", Monitor],
                  ["mobile", Smartphone],
                ] as const
              ).map(([option, Icon]) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={device === option}
                  onClick={() => setDevice(option)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium capitalize transition-colors",
                    device === option ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {option}
                </button>
              ))}
            </div>
          }
        >
          Search preview
        </SectionTitle>
        <p className={cn("text-xs text-muted-foreground", desktop ? "min-[700px]:hidden" : "min-[420px]:hidden")}>Scroll sideways to see the full preview.</p>
        <div role="region" aria-label={`${device} search preview`} tabIndex={0} className="overflow-x-auto rounded-2xl focus-visible:ring-2 focus-visible:ring-ring">
          <div className={cn("w-max rounded-2xl border border-neutral-200 bg-white shadow-soft", desktop ? "p-5" : "p-4")}>
            <div className={desktop ? "w-[600px]" : "w-[328px]"} style={{ fontFamily: "Arial, sans-serif" }}>
              <div className="flex items-center gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-neutral-50 text-[11px] font-semibold text-neutral-600 uppercase">
                  {siteName.charAt(0) || "·"}
                </span>
                <div className="min-w-0 leading-tight">
                  <div className="truncate text-sm text-[#202124] capitalize">{siteName || "Site"}</div>
                  <div className="truncate text-xs text-[#4d5156]">
                    {origin}
                    {crumbs.length > 0 ? ` › ${(desktop ? crumbs : crumbs.slice(0, 1)).join(" › ")}${!desktop && crumbs.length > 1 ? " › …" : ""}` : ""}
                  </div>
                </div>
              </div>
              <p className={cn("mt-1.5 text-[20px] leading-[26px] text-[#1a0dab]", desktop ? "truncate" : "line-clamp-2 [overflow-wrap:anywhere]")}>{title}</p>
              <p className={cn("mt-1 text-[14px] leading-[22px] text-[#4d5156] [overflow-wrap:anywhere]", desktop ? "line-clamp-2" : "line-clamp-3")}>
                {showDate ? <span className="text-[#70757a]">{today} — </span> : null}
                {description}
              </p>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Google may rewrite your title or description for a search query. Actual results also vary by screen size and layout.</p>
      </section>
    </div>
  );
}
