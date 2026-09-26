"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  RotateCcw,
  Undo2,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page";
import { cn } from "@/lib/utils";
import { saveSettingsAction } from "../actions/settings";

/* ───────────────────────────── Page scaffolding ───────────────────────────── */

export function AdminPage({
  title,
  description,
  actions,
  children,
  eyebrow = "Admin",
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-5">
      <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} />
      {children}
    </div>
  );
}

/** Label + description on the left, control on the right (stacks on mobile). */
export function SettingRow({
  label,
  description,
  htmlFor,
  children,
  className,
  badge,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
  badge?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid gap-2 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] sm:items-start sm:gap-8",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <Label htmlFor={htmlFor} className="flex-wrap text-[13px] leading-snug">
          {label}
          {badge}
        </Label>
        {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Row with a switch on the right — stays horizontal on mobile. */
export function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  id,
  className,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const autoId = useId();
  const htmlId = id ?? autoId;
  return (
    <div className={cn("flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0", className)}>
      <div className="min-w-0 space-y-1">
        <Label htmlFor={htmlId} className="text-[13px] leading-snug">
          {label}
        </Label>
        {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      <Switch id={htmlId} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="mt-0.5" />
    </div>
  );
}

export function Rows({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("divide-y", className)}>{children}</div>;
}

/* ─────────────────────────────── Inputs ─────────────────────────────── */

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  id,
  className,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    // Sync external changes (e.g. discard) without clobbering what the user is typing.
    setPrev(value);
    if (Number(text) !== value) setText(String(value));
  }
  return (
    <div className={cn("relative flex max-w-56 items-center", className)}>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(n)) {
            setPrev(n);
            onChange(n);
          }
        }}
        onBlur={() => {
          let n = Number(text);
          if (!Number.isFinite(n) || text === "") n = value;
          if (min != null) n = Math.max(min, n);
          if (max != null) n = Math.min(max, n);
          setText(String(n));
          if (n !== value) onChange(n);
        }}
        className={cn("tabular", suffix && "pr-16")}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-2.5 text-xs text-muted-foreground">{suffix}</span>
      )}
    </div>
  );
}

/**
 * Secret field that never shows the stored value. `value === undefined` keeps the stored secret,
 * a string replaces it, `""` (when a secret is stored) removes it.
 */
export function SecretInput({
  id,
  isSet,
  value,
  onChange,
  placeholder = "Paste key…",
  className,
}: {
  id?: string;
  isSet: boolean;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  placeholder?: string;
  className?: string;
}) {
  const [show, setShow] = useState(false);
  const editing = value !== undefined;
  if (isSet && !editing) {
    return (
      <div className={cn("flex flex-wrap items-center gap-2", className)}>
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-dashed bg-muted/40 px-2.5 text-sm text-muted-foreground">
          <Lock className="size-3.5 shrink-0 text-success" />
          <span className="truncate font-mono tracking-widest">••••••••••••</span>
          <Badge variant="secondary" className="ml-auto h-5 shrink-0 bg-success/12 text-[10px] text-success">
            Stored encrypted
          </Badge>
        </div>
        <div className="flex gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => onChange("")} className="h-8">
            <KeyRound className="size-3.5" /> Replace
          </Button>
        </div>
      </div>
    );
  }
  const removing = isSet && value === "";
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Input
            id={id}
            type={show ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            value={value ?? ""}
            placeholder={isSet ? "Enter a new value (leave empty to remove)" : placeholder}
            onChange={(e) => onChange(e.target.value === "" && !isSet ? undefined : e.target.value)}
            className="pr-9 font-mono text-[13px]"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={show ? "Hide" : "Show"}
          >
            {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        </div>
        {isSet && (
          <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0" onClick={() => onChange(undefined)}>
            <Undo2 className="size-3.5" /> Keep
          </Button>
        )}
      </div>
      {removing && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <AlertTriangle className="size-3" /> Paste the new value — saving while empty removes the stored key.
        </p>
      )}
    </div>
  );
}

/** Tag/chips input with per-item validation (e.g. allowed domains). */
export function ChipsInput({
  value,
  onChange,
  placeholder = "Type and press Enter",
  validate,
  normalize = (s) => s.trim(),
  id,
  className,
  renderChip,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  /** Return an error message for invalid items. */
  validate?: (item: string) => string | null;
  normalize?: (s: string) => string;
  id?: string;
  className?: string;
  renderChip?: (item: string) => React.ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (raw: string) => {
    const parts = raw.split(/[\s,;]+/).map(normalize).filter(Boolean);
    if (!parts.length) return true;
    const next = [...value];
    for (const p of parts) {
      const err = validate?.(p) ?? null;
      if (err) {
        setError(err);
        setDraft(p);
        return false;
      }
      if (!next.includes(p)) next.push(p);
    }
    onChange(next);
    setDraft("");
    setError(null);
    return true;
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        className={cn(
          "flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent px-1.5 py-1 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
          error && "border-destructive ring-3 ring-destructive/15",
        )}
        onClick={() => inputRef.current?.focus()}
      >
        <AnimatePresence initial={false}>
          {value.map((item) => (
            <motion.span
              key={item}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-secondary pr-1 pl-2 text-xs font-medium"
            >
              <span className="truncate">{renderChip ? renderChip(item) : item}</span>
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(value.filter((v) => v !== item));
                }}
                aria-label={`Remove ${item}`}
              >
                <X className="size-3" />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
        <input
          ref={inputRef}
          id={id}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (["Enter", ",", " ", "Tab"].includes(e.key) && draft.trim()) {
              if (e.key !== "Tab" || draft.trim()) e.preventDefault();
              commit(draft);
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => draft.trim() && commit(draft)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (/[\s,;]/.test(text)) {
              e.preventDefault();
              commit(draft + text);
            }
          }}
          placeholder={value.length ? "" : placeholder}
          className="h-6 min-w-32 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground md:text-sm"
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/* ─────────────────────────── Form state + save bar ─────────────────────────── */

type SettingsState<T> = { values: T; secrets: Record<string, boolean> };

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Local form state for one settings group. Only changed fields (and edited secrets) are sent to
 * the server; the result replaces the baseline.
 */
export function useSettingsForm<T extends Record<string, unknown>>(group: string, initial: SettingsState<T>) {
  const [base, setBase] = useState<SettingsState<T>>(initial);
  const [values, setValues] = useState<T>(initial.values);
  const [secretEdits, setSecretEdits] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);

  const changedKeys = useMemo(
    () => Object.keys(values).filter((k) => !same(values[k], base.values[k])),
    [values, base.values],
  );
  const secretKeys = useMemo(
    () =>
      Object.entries(secretEdits)
        .filter(([k, v]) => v !== undefined && !(v === "" && !base.secrets[k]))
        .map(([k]) => k),
    [secretEdits, base.secrets],
  );
  const dirty = changedKeys.length > 0 || secretKeys.length > 0;

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const setSecret = useCallback((key: string, value: string | undefined) => {
    setSecretEdits((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => {
    setValues(base.values);
    setSecretEdits({});
  }, [base.values]);

  const save = useCallback(async () => {
    const patch: Record<string, unknown> = {};
    for (const k of changedKeys) patch[k] = values[k];
    for (const k of secretKeys) patch[k] = secretEdits[k];
    setSaving(true);
    try {
      const res = await saveSettingsAction(group, patch);
      if (!res.ok) {
        toast.error(res.error);
        return false;
      }
      const next = res.data as unknown as SettingsState<T>;
      setBase(next);
      setValues(next.values);
      setSecretEdits({});
      toast.success("Settings saved");
      return true;
    } finally {
      setSaving(false);
    }
  }, [changedKeys, secretKeys, values, secretEdits, group]);

  return {
    values,
    set,
    secrets: base.secrets,
    secretEdits,
    setSecret,
    dirty,
    saving,
    save,
    reset,
    changedCount: changedKeys.length + secretKeys.length,
  };
}

/** Sticky "unsaved changes" bar shown at the bottom of a settings page. */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onReset,
  count,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
  count?: number;
}) {
  return (
    <AnimatePresence>
      {dirty && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
          className="sticky bottom-3 z-30 mt-4 pb-[env(safe-area-inset-bottom)]"
        >
          <div className="mx-auto flex max-w-xl items-center gap-2 rounded-2xl border bg-popover/95 p-2 pl-4 shadow-lg backdrop-blur-xl">
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-warning" />
            <span className="min-w-0 flex-1 truncate text-sm">
              Unsaved changes{count ? <span className="text-muted-foreground"> · {count}</span> : null}
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={onReset} disabled={saving} className="h-8">
              <RotateCcw className="size-3.5" /> <span className="hidden sm:inline">Discard</span>
            </Button>
            <Button type="button" size="sm" onClick={onSave} disabled={saving} className="h-8 px-4">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : "Save changes"}
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ───────────────────────────── Connection tests ───────────────────────────── */

export type TestOutcome = { ok: boolean; message: string; detail?: string; latencyMs?: number };

export function TestResultView({ result, className }: { result: TestOutcome | null; className?: string }) {
  if (!result) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
        result.ok ? "border-success/30 bg-success/8 text-foreground" : "border-destructive/30 bg-destructive/6 text-foreground",
        className,
      )}
    >
      {result.ok ? (
        <CheckCircle2 className="mt-px size-3.5 shrink-0 text-success" />
      ) : (
        <XCircle className="mt-px size-3.5 shrink-0 text-destructive" />
      )}
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium">
          {result.message}
          {result.latencyMs != null && <span className="ml-1.5 font-normal text-muted-foreground tabular">{result.latencyMs} ms</span>}
        </p>
        {result.detail && <p className="break-words text-muted-foreground">{result.detail}</p>}
      </div>
    </motion.div>
  );
}

/** Button that runs an async test action and renders the outcome underneath. */
export function TestButton({
  run,
  label = "Test",
  disabled,
  disabledReason,
  className,
  variant = "outline",
}: {
  run: () => Promise<{ ok: true; data: TestOutcome } | { ok: false; error: string }>;
  label?: React.ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
  variant?: "outline" | "default" | "secondary";
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestOutcome | null>(null);
  return (
    <div className={cn("space-y-2", className)}>
      <Button
        type="button"
        variant={variant}
        size="sm"
        className="h-8"
        disabled={busy || disabled}
        title={disabled ? disabledReason : undefined}
        onClick={async () => {
          setBusy(true);
          setResult(null);
          try {
            const res = await run();
            setResult(res.ok ? res.data : { ok: false, message: res.error });
          } catch (err) {
            setResult({ ok: false, message: err instanceof Error ? err.message : "Test failed" });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Loader2 className="size-3.5 animate-spin" />}
        {label}
      </Button>
      <TestResultView result={result} />
    </div>
  );
}

/** Small uppercase heading used to group rows inside a panel. */
export function SubHeading({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={cn("pt-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase", className)}>{children}</h3>;
}
