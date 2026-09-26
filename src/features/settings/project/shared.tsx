"use client";

import { useCallback, useMemo, useState } from "react";
import { Eye } from "lucide-react";
import { toast } from "sonner";
import type { ProjectPatch } from "@/server/admin/projects";
import { updateProjectSettingsAction } from "../project-actions";

export type ProjectSettingsData = {
  id: string;
  name: string;
  domain: string;
  logoUrl: string | null;
  description: string | null;
  country: string;
  language: string;
  brand: { aliases: string[]; domains: string[]; description?: string; industry?: string };
  engines: string[];
  trackingFrequency: "daily" | "weekly" | "monthly" | "paused";
  isPitch: boolean;
  pitchExpiresAt: string | null;
  archived: boolean;
  createdAt: string;
};

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Local dirty-tracking form state that saves only changed fields through `updateProjectSettingsAction`. */
export function useProjectForm<T extends Record<string, unknown>>(projectId: string, initial: T, toPatch: (v: T, changed: (keyof T)[]) => ProjectPatch) {
  const [base, setBase] = useState<T>(initial);
  const [values, setValues] = useState<T>(initial);
  const [saving, setSaving] = useState(false);
  const changed = useMemo(() => (Object.keys(values) as (keyof T)[]).filter((k) => !same(values[k], base[k])), [values, base]);
  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => setValues((v) => ({ ...v, [key]: value })), []);
  const reset = useCallback(() => setValues(base), [base]);
  /** Updates a field that was already persisted elsewhere (e.g. an uploaded logo). */
  const commit = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setBase((b) => ({ ...b, [key]: value }));
    setValues((v) => ({ ...v, [key]: value }));
  }, []);
  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await updateProjectSettingsAction(projectId, toPatch(values, changed));
      if (!res.ok) {
        toast.error(res.error);
        return false;
      }
      setBase(values);
      toast.success("Project settings saved");
      return true;
    } finally {
      setSaving(false);
    }
  }, [projectId, toPatch, values, changed]);
  return { values, set, commit, reset, save, saving, dirty: changed.length > 0, changedCount: changed.length };
}

export function ReadOnlyNotice({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <Eye className="size-3.5 shrink-0" />
      {children ?? "You can view these settings. Changing them requires the “Create, configure and delete projects” permission."}
    </div>
  );
}
