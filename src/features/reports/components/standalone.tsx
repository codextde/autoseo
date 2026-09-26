"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { unlockShareAction } from "../actions";
import type { DataBundle } from "../lib/bundle";
import type { ResolvedData } from "../lib/catalog";
import type { Deck } from "../lib/types";
import { PresentMode } from "./present-mode";
import { PrintView } from "./print-view";

/** /reports/[id]/present — full-screen presenter; Esc returns to `exitHref`. */
export function PresentPage({
  deck,
  bundle,
  resolved,
  title,
  subtitle,
  assetBase,
  exitHref,
  startIndex,
}: {
  deck: Deck;
  bundle: DataBundle | null;
  resolved?: ResolvedData | null;
  title: string;
  subtitle?: string | null;
  assetBase: string;
  exitHref: string;
  startIndex: number;
}) {
  const router = useRouter();
  const assetUrl = useMemo(() => (id: string) => `${assetBase}/${id}`, [assetBase]);
  return <PresentMode deck={deck} bundle={bundle} resolved={resolved} title={title} subtitle={subtitle} assetUrl={assetUrl} startIndex={startIndex} onExit={() => router.push(exitHref)} />;
}

export function PrintPage({
  deck,
  bundle,
  resolved,
  title,
  subtitle,
  assetBase,
  backHref,
  autoPrint,
}: {
  deck: Deck;
  bundle: DataBundle | null;
  resolved?: ResolvedData | null;
  title: string;
  subtitle?: string | null;
  assetBase: string;
  backHref?: string;
  autoPrint?: boolean;
}) {
  const assetUrl = useMemo(() => (id: string) => `${assetBase}/${id}`, [assetBase]);
  return <PrintView deck={deck} bundle={bundle} resolved={resolved} title={title} subtitle={subtitle} assetUrl={assetUrl} backHref={backHref} autoPrint={autoPrint} />;
}

/** Password prompt for protected share links. */
export function PasswordGate({ token, title, appName }: { token: string; title: string; appName: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-2xl border bg-card p-6 shadow-soft"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await unlockShareAction(token, password);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            router.refresh();
          });
        }}
      >
        <div className="flex size-11 items-center justify-center rounded-xl bg-muted">
          <Lock className="size-5 text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">This report is password protected.</p>
        </div>
        <Input type="password" autoFocus placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={pending || !password}>
          {pending && <Loader2 className="animate-spin" />} View report
        </Button>
        <p className="text-center text-xs text-muted-foreground">Shared with {appName}</p>
      </form>
    </div>
  );
}
