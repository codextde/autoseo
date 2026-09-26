"use client";

import { useActionState, useEffect, useState } from "react";
import { ArrowRight, CircleAlert, CircleCheck, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { startCheckoutAction, type InstanceActionState } from "@/server/actions/instance";

type Availability = { state: "idle" } | { state: "checking" } | { state: "ok" } | { state: "error"; error: string };

function suggest(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
}

export function NewInstanceForm({
  baseDomain,
  billingReady,
  initial,
}: {
  baseDomain: string;
  billingReady: boolean;
  initial?: { slug: string; workspaceName: string };
}) {
  const [state, action, pending] = useActionState<InstanceActionState, FormData>(startCheckoutAction, {});
  const [workspaceName, setWorkspaceName] = useState(initial?.workspaceName ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!initial?.slug);
  const [result, setResult] = useState<{ slug: string; available: boolean; error?: string } | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/slug?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
        const data = (await res.json()) as { available?: boolean; error?: string };
        if (!cancelled) setResult({ slug, available: !!data.available, error: data.error ?? (data.available ? undefined : "Not available.") });
      } catch {
        if (!cancelled) setResult({ slug, available: false, error: "Couldn't check availability. Try again." });
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug]);

  const availability: Availability = !slug
    ? { state: "idle" }
    : result?.slug !== slug
      ? { state: "checking" }
      : result.available
        ? { state: "ok" }
        : { state: "error", error: result.error ?? "Not available." };

  return (
    <form action={action} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="workspaceName">Company or workspace name</Label>
        <Input
          id="workspaceName"
          name="workspaceName"
          required
          maxLength={80}
          placeholder="Acme Inc."
          value={workspaceName}
          onChange={(e) => {
            setWorkspaceName(e.target.value);
            if (!slugTouched) setSlug(suggest(e.target.value));
          }}
          className="h-11 text-base"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="slug">Choose your address</Label>
        <div
          className={cn(
            "flex h-11 items-center overflow-hidden rounded-lg border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
            availability.state === "error" && "border-destructive/60 focus-within:ring-destructive/20",
          )}
        >
          <Globe className="ml-3 size-4 shrink-0 text-muted-foreground" />
          <input
            id="slug"
            name="slug"
            required
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={30}
            placeholder="acme"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
            }}
            className="h-full min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground"
            aria-describedby="slug-status"
          />
          <span className="shrink-0 truncate border-l bg-muted/60 px-3 text-sm leading-[2.75rem] text-muted-foreground max-sm:max-w-[45%]">
            .{baseDomain}
          </span>
        </div>
        <p id="slug-status" className="flex min-h-5 items-center gap-1.5 text-sm" aria-live="polite">
          {availability.state === "checking" && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Spinner className="size-3.5" /> Checking availability…
            </span>
          )}
          {availability.state === "ok" && (
            <span className="flex items-center gap-1.5 text-success">
              <CircleCheck className="size-4" /> {slug}.{baseDomain} is available
            </span>
          )}
          {availability.state === "error" && (
            <span className="flex items-center gap-1.5 text-destructive">
              <CircleAlert className="size-4" /> {availability.error}
            </span>
          )}
          {availability.state === "idle" && (
            <span className="text-muted-foreground">3–30 characters: lowercase letters, numbers and hyphens.</span>
          )}
        </p>
      </div>

      {!billingReady && (
        <Alert>
          <CircleAlert />
          <AlertDescription>
            Sign-ups open shortly — payments aren&apos;t set up yet. Please check back soon or write to info@codext.de.
          </AlertDescription>
        </Alert>
      )}
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        <Button
          type="submit"
          size="lg"
          className="h-12 w-full text-base sm:w-auto sm:px-6"
          disabled={pending || !billingReady || availability.state !== "ok" || !workspaceName.trim()}
        >
          {pending ? <Spinner /> : null}
          Continue to payment — $50/month
          {!pending && <ArrowRight />}
        </Button>
        <p className="text-xs text-muted-foreground">
          Secure checkout with Stripe. Taxes may apply. Cancel anytime from the billing portal.
        </p>
      </div>
    </form>
  );
}
