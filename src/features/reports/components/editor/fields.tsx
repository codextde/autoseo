"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Database, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { TOKENS, TOKEN_CATEGORIES, resolveToken, type ResolveCtx } from "../../lib/catalog";
import { THEME_COLOR_KEYS, type Theme } from "../../lib/types";
import { THEME_COLOR_LABELS, resolveColor } from "../../lib/theme";

export function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="border-b px-3 py-3 last:border-b-0">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
        {actions}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function Row({ label, children, className }: { label?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {label && <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  );
}

/** Numeric input that commits on blur / Enter, supports arrow keys (Shift = ×10). */
export function NumberField({
  value,
  onChange,
  label,
  min,
  max,
  step = 1,
  suffix,
  className,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [local, setLocal] = useState(String(round(value)));
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setLocal(String(round(value)));
  }
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const commit = (raw: string) => {
    const v = Number(raw);
    if (Number.isFinite(v) && v !== value) onChange(clamp(v));
    else setLocal(String(round(value)));
  };
  return (
    <label className={cn("flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md border bg-background px-1.5 text-xs focus-within:ring-2 focus-within:ring-ring/40", disabled && "opacity-50", className)}>
      {label && <span className="shrink-0 text-[10px] font-medium text-muted-foreground">{label}</span>}
      <input
        className="w-full min-w-0 bg-transparent text-right tabular outline-none"
        value={local}
        disabled={disabled}
        inputMode="decimal"
        onChange={(e) => setLocal(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const d = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            onChange(clamp(round(value + d)));
          }
        }}
      />
      {suffix && <span className="shrink-0 text-[10px] text-muted-foreground">{suffix}</span>}
    </label>
  );
}

function round(v: number) {
  return Math.round(v * 100) / 100;
}

/** Text input that commits on blur / Enter. */
export function TextField({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const [local, setLocal] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setLocal(value);
  }
  return (
    <Input
      value={local}
      placeholder={placeholder}
      className={cn("h-7 text-xs", className)}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => local !== value && onChange(local)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function ColorField({
  value,
  onChange,
  theme,
  allowTransparent = true,
  onPickStart,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  theme: Theme;
  allowTransparent?: boolean;
  /** keep text selection while picking (rich text editing) */
  onPickStart?: () => void;
}) {
  const resolved = value ? resolveColor(value, theme) : "transparent";
  const [hex, setHex] = useState(resolved.startsWith("#") ? resolved : "");
  const [prevResolved, setPrevResolved] = useState(resolved);
  if (prevResolved !== resolved) {
    setPrevResolved(resolved);
    setHex(resolved.startsWith("#") ? resolved : "");
  }
  const label = !value || value === "transparent" ? "None" : value.startsWith("$") ? THEME_COLOR_LABELS[value.slice(1) as keyof typeof THEME_COLOR_LABELS] ?? value : value.toUpperCase();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onMouseDown={(e) => {
            if (onPickStart) {
              e.preventDefault();
              onPickStart();
            }
          }}
          className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-1.5 text-left text-xs hover:bg-muted/50"
        >
          <span
            className="size-4 shrink-0 rounded-[4px] ring-1 ring-black/10"
            style={{ background: resolved === "transparent" ? "repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 8px 8px" : resolved }}
          />
          <span className="truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 space-y-3 p-3" onOpenAutoFocus={(e) => onPickStart && e.preventDefault()}>
        <div>
          <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Theme</div>
          <div className="grid grid-cols-5 gap-1.5">
            {THEME_COLOR_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                title={THEME_COLOR_LABELS[k]}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onChange(`$${k}`)}
                className={cn("relative size-9 rounded-md ring-1 ring-black/10", value === `$${k}` && "ring-2 ring-foreground")}
                style={{ background: theme.colors[k] }}
              >
                {value === `$${k}` && <Check className="absolute inset-0 m-auto size-3.5 text-white mix-blend-difference" />}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Chart palette</div>
          <div className="grid grid-cols-8 gap-1">
            {theme.chart.map((c, i) => (
              <button key={i} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange(c)} className="size-6 rounded ring-1 ring-black/10" style={{ background: c }} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={hex && hex.length === 7 ? hex : "#000000"}
            onChange={(e) => {
              setHex(e.target.value.toUpperCase());
              onChange(e.target.value.toUpperCase());
            }}
            className="h-8 w-10 shrink-0 cursor-pointer rounded border bg-transparent"
          />
          <Input
            value={hex}
            placeholder="#22C55E"
            className="h-8 font-mono text-xs"
            onChange={(e) => setHex(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && /^#[0-9a-fA-F]{6}$/.test(hex)) onChange(hex.toUpperCase());
            }}
            onBlur={() => /^#[0-9a-fA-F]{6}$/.test(hex) && hex.toUpperCase() !== resolved.toUpperCase() && onChange(hex.toUpperCase())}
          />
        </div>
        {allowTransparent && (
          <Button size="sm" variant="outline" className="w-full" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange("transparent")}>
            No color
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Searchable live-data token picker ("Live data insert"). */
export function TokenPicker({
  onPick,
  ctx,
  trigger,
  keepFocus,
  filter,
  align = "end",
}: {
  onPick: (key: string) => void;
  ctx: ResolveCtx;
  trigger?: React.ReactNode;
  keepFocus?: boolean;
  filter?: (key: string) => boolean;
  align?: "start" | "end" | "center";
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return TOKEN_CATEGORIES.map((cat) => ({
      cat,
      items: Object.entries(TOKENS).filter(
        ([k, d]) => d.category === cat && !k.endsWith("_prev") && (!filter || filter(k)) && (!needle || d.label.toLowerCase().includes(needle) || k.includes(needle)),
      ),
    })).filter((g) => g.items.length);
  }, [q, filter]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onMouseDown={(e) => keepFocus && e.preventDefault()}>
        {trigger ?? (
          <Button size="sm" variant="outline" className="h-7 w-full justify-start gap-1.5 text-xs">
            <Database className="size-3.5 text-violet-500" /> Insert live data…
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-80 p-0" onOpenAutoFocus={(e) => keepFocus && e.preventDefault()}>
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Search metrics…"
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {groups.map((g) => (
            <div key={g.cat} className="py-1">
              <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase">{g.cat}</div>
              {g.items.map(([k, d]) => (
                <button
                  key={k}
                  type="button"
                  onMouseDown={(e) => keepFocus && e.preventDefault()}
                  onClick={() => {
                    onPick(k);
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className="truncate">{d.label}</span>
                  <span className="shrink-0 rounded bg-violet-500/12 px-1.5 py-0.5 font-mono text-[11px] text-violet-600 tabular dark:text-violet-300">
                    {resolveToken(k, ctx).text.slice(0, 22)}
                  </span>
                </button>
              ))}
            </div>
          ))}
          {!groups.length && <div className="p-4 text-center text-sm text-muted-foreground">No metrics found.</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Generic searchable select for catalog keys (charts, lists, tables, tokens). */
export function KeySelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  options: { key: string; label: string; group?: string }[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = options.find((o) => o.key === value);
  const filtered = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  const groups = [...new Set(filtered.map((o) => o.group ?? ""))];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="flex h-7 min-w-0 flex-1 items-center justify-between gap-1 rounded-md border bg-background px-2 text-left text-xs hover:bg-muted/50">
          <span className="truncate">{current?.label ?? placeholder}</span>
          <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="size-3.5 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Search…" className="w-full bg-transparent text-sm outline-none" autoFocus />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {groups.map((g) => (
            <div key={g}>
              {g && <div className="px-2 pt-2 pb-1 text-[11px] font-semibold text-muted-foreground uppercase">{g}</div>}
              {filtered
                .filter((o) => (o.group ?? "") === g)
                .map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => {
                      onChange(o.key);
                      setOpen(false);
                    }}
                    className={cn("flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted", o.key === value && "bg-muted")}
                  >
                    <span className="truncate">{o.label}</span>
                    {o.key === value && <Check className="size-3.5" />}
                  </button>
                ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function Toggle({ pressed, onClick, children, title }: { pressed: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={pressed}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn("flex h-7 min-w-7 items-center justify-center rounded-md border px-1.5 text-xs transition-colors", pressed ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-muted")}
    >
      {children}
    </button>
  );
}
