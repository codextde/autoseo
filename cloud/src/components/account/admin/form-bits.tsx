"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { CircleAlert, CircleCheck, KeyRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export type FormState = { ok?: boolean; error?: string; message?: string };

/** Toasts each new action result once. */
export function useResultToast(state: FormState) {
  const last = useRef<FormState | null>(null);
  useEffect(() => {
    if (state === last.current) return;
    last.current = state;
    if (state.error) toast.error(state.error);
    else if (state.message) toast.success(state.message);
  }, [state]);
}

export function FormResult({ state }: { state: FormState }) {
  if (!state.error && !state.message) return null;
  return (
    <p
      className={cn("flex items-start gap-1.5 text-sm", state.error ? "text-destructive" : "text-success")}
      role={state.error ? "alert" : "status"}
    >
      {state.error ? <CircleAlert className="mt-0.5 size-4 shrink-0" /> : <CircleCheck className="mt-0.5 size-4 shrink-0" />}
      {state.error ?? state.message}
    </p>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Write-only secret: the stored value is never sent to the browser, only whether one exists. */
export function SecretField({
  label,
  name,
  saved,
  placeholder,
  hint,
}: {
  label: string;
  name: string;
  saved: boolean;
  placeholder?: string;
  hint?: ReactNode;
}) {
  return (
    <Field
      label={label}
      htmlFor={name}
      hint={
        <>
          {saved ? "Leave empty to keep the saved value. " : null}
          {hint}
        </>
      }
    >
      <div className="relative">
        <KeyRound className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={name}
          name={name}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={saved ? "•••••••• saved — enter a new value to replace" : placeholder}
          className="pl-9 font-mono"
        />
      </div>
    </Field>
  );
}

export function SwitchField({
  name,
  label,
  description,
  defaultChecked,
}: {
  name: string;
  label: string;
  description?: ReactNode;
  defaultChecked: boolean;
}) {
  return (
    <label htmlFor={name} className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-3">
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-muted-foreground">{description}</span>}
      </span>
      <Switch id={name} name={name} defaultChecked={defaultChecked} />
    </label>
  );
}

export function StatusRow({ label, value, ok }: { label: string; value: ReactNode; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 truncate text-right font-mono text-xs", ok === false && "text-muted-foreground")}>{value}</span>
    </div>
  );
}
