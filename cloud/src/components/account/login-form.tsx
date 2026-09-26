"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Mail, RotateCcw, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { requestLoginAction, verifyCodeAction, type LoginState } from "@/server/actions/auth";

export function LoginForm({ mode, next, error }: { mode: "login" | "signup"; next?: string; error?: string }) {
  const [state, requestAction, requesting] = useActionState<LoginState, FormData>(requestLoginAction, { step: "email", error });
  const [codeState, verifyAction, verifying] = useActionState<LoginState, FormData>(verifyCodeAction, { step: "email" });
  const [code, setCode] = useState("");
  const codeForm = useRef<HTMLFormElement>(null);
  const signup = mode === "signup";

  useEffect(() => {
    if (code.length === 6) codeForm.current?.requestSubmit();
  }, [code]);

  if (state.step === "sent") {
    return (
      <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
        <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          <Mail className="size-6" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Check your inbox</h1>
        <p className="mt-2 text-muted-foreground">
          We sent a sign-in link to <span className="font-medium text-foreground">{state.email}</span>. Click it — or enter the
          6-digit code from the email here.
        </p>
        {state.transport === "log" && (
          <Alert className="mt-4">
            <Terminal />
            <AlertDescription className="text-xs">
              Email delivery isn&apos;t configured yet — the link and code were written to the server log.
            </AlertDescription>
          </Alert>
        )}
        <form ref={codeForm} action={verifyAction} className="mt-6 space-y-4">
          <input type="hidden" name="email" value={state.email} />
          <div className="space-y-2">
            <Label htmlFor="code">Sign-in code</Label>
            <Input
              id="code"
              name="code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              autoFocus
              placeholder="123456"
              className="h-12 text-center font-mono text-xl tracking-[0.5em]"
            />
          </div>
          {codeState.step === "sent" && codeState.error && (
            <Alert variant="destructive">
              <AlertDescription>{codeState.error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" className="h-11 w-full text-base" disabled={verifying || code.length < 6}>
            {verifying ? <Spinner /> : signup ? "Create account" : "Sign in"}
          </Button>
        </form>
        <form action={requestAction} className="mt-3">
          <input type="hidden" name="email" value={state.email} />
          <input type="hidden" name="next" value={next ?? ""} />
          <input type="hidden" name="mode" value={mode} />
          <Button type="submit" variant="ghost" className="w-full text-muted-foreground" disabled={requesting}>
            {requesting ? <Spinner /> : <RotateCcw />} Send a new email
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">{signup ? "Create your account" : "Welcome back"}</h1>
      <p className="mt-2 text-muted-foreground">
        {signup
          ? "Get your own managed AutoSEO instance. We’ll email you a link to confirm — no password needed."
          : "Sign in to AutoSEO Cloud with a magic link — no password needed."}
      </p>
      <form action={requestAction} className="mt-8 space-y-4">
        <input type="hidden" name="next" value={next ?? ""} />
        <input type="hidden" name="mode" value={mode} />
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              defaultValue={state.email ?? ""}
              placeholder="you@company.com"
              className="h-11 pl-9 text-base"
            />
          </div>
        </div>
        {state.error && (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="h-11 w-full text-base" disabled={requesting}>
          {requesting ? <Spinner /> : <>Continue with email <ArrowRight /></>}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted-foreground">
        {signup ? "Already have an account? " : "New to AutoSEO Cloud? "}
        <Link
          href={`${signup ? "/login" : "/signup"}${next ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {signup ? "Sign in" : "Create an account"}
        </Link>
      </p>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        You&apos;ll stay signed in on this device for a year, and you can be signed in on as many devices as you like.
      </p>
    </div>
  );
}
