"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2, Mail, RotateCcw, Terminal } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { requestLoginAction, verifyCodeAction, type LoginState } from "../actions";

export function LoginForm({ next, appName }: { next?: string; appName: string }) {
  const [state, requestAction, requesting] = useActionState<LoginState, FormData>(requestLoginAction, { step: "email" });
  const [codeState, verifyAction, verifying] = useActionState<LoginState, FormData>(verifyCodeAction, { step: "email" });
  const [code, setCode] = useState("");
  const codeForm = useRef<HTMLFormElement>(null);
  const sent = state.step === "sent";

  useEffect(() => {
    if (code.length === 6) codeForm.current?.requestSubmit();
  }, [code]);

  return (
    <AnimatePresence mode="wait">
      {!sent ? (
        <motion.div key="email" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
          <h1 className="text-3xl font-semibold tracking-tight text-balance">Welcome back</h1>
          <p className="mt-2 text-muted-foreground">Sign in to {appName} with a magic link — no password needed.</p>
          <form action={requestAction} className="mt-8 space-y-4">
            <input type="hidden" name="next" value={next ?? ""} />
            <div className="space-y-2">
              <Label htmlFor="email">Work email</Label>
              <div className="relative">
                <Mail className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  required
                  defaultValue={state.step === "email" ? state.email : ""}
                  placeholder="you@company.com"
                  className="h-11 pl-9 text-base"
                />
              </div>
            </div>
            {state.step === "email" && state.error && (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="h-11 w-full text-base" disabled={requesting}>
              {requesting ? <Loader2 className="size-4 animate-spin" /> : <>Continue with email <ArrowRight className="size-4" /></>}
            </Button>
          </form>
          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            Access is invite-only. You&apos;ll stay signed in on this device for a year — and you can be signed in on as
            many devices as you like.
          </p>
        </motion.div>
      ) : (
        <motion.div key="sent" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
          <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
            <Mail className="size-6" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Check your inbox</h1>
          <p className="mt-2 text-muted-foreground">
            If <span className="font-medium text-foreground">{state.email}</span> is invited, we sent a sign-in link. Click it —
            or enter the 6-digit code here.
          </p>
          {state.transport === "log" && (
            <Alert className="mt-4">
              <Terminal className="size-4" />
              <AlertDescription className="text-xs">
                Email delivery isn&apos;t configured yet — an admin can find the link in the server logs, or set up SMTP in
                Admin → Email.
              </AlertDescription>
            </Alert>
          )}
          <form ref={codeForm} action={verifyAction} className="mt-6 space-y-4">
            <input type="hidden" name="email" value={state.email} />
            <input type="hidden" name="code" value={code} />
            <InputOTP maxLength={6} value={code} onChange={setCode} autoFocus containerClassName="justify-center">
              <InputOTPGroup>
                <InputOTPSlot index={0} className="size-12 text-lg" />
                <InputOTPSlot index={1} className="size-12 text-lg" />
                <InputOTPSlot index={2} className="size-12 text-lg" />
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup>
                <InputOTPSlot index={3} className="size-12 text-lg" />
                <InputOTPSlot index={4} className="size-12 text-lg" />
                <InputOTPSlot index={5} className="size-12 text-lg" />
              </InputOTPGroup>
            </InputOTP>
            {codeState.step === "sent" && codeState.error && (
              <Alert variant="destructive">
                <AlertDescription>{codeState.error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="h-11 w-full" disabled={verifying || code.length < 6}>
              {verifying ? <Loader2 className="size-4 animate-spin" /> : "Sign in"}
            </Button>
          </form>
          <form action={requestAction} className="mt-3">
            <input type="hidden" name="email" value={state.email} />
            <input type="hidden" name="next" value={next ?? ""} />
            <Button type="submit" variant="ghost" className="w-full gap-2 text-muted-foreground" disabled={requesting}>
              <RotateCcw className="size-4" /> Resend email
            </Button>
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
