"use client";

import { useActionState, useState } from "react";
import { ArrowLeft, ArrowRight, KeyRound, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { completeSetupAction } from "../actions";

const steps = ["Verify", "Workspace", "Your account", "Access"] as const;

export function SetupForm() {
  const [state, action, pending] = useActionState(completeSetupAction, {});
  const [step, setStep] = useState(0);
  const [values, setValues] = useState({
    code: "",
    appName: "AutoSEO",
    workspaceName: "",
    name: "",
    email: "",
    allowedDomains: "",
  });
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  const canNext =
    (step === 0 && values.code.trim().length >= 4) ||
    (step === 1 && values.workspaceName.trim() && values.appName.trim()) ||
    (step === 2 && values.name.trim() && /\S+@\S+\.\S+/.test(values.email)) ||
    step === 3;

  const emailDomain = values.email.split("@")[1] ?? "";

  return (
    <form action={action}>
      {Object.entries(values).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="mb-8 flex gap-1.5">
        {steps.map((s, i) => (
          <div key={s} className="flex-1">
            <div className={`h-1 rounded-full transition-colors ${i <= step ? "bg-foreground" : "bg-border"}`} />
            <p className={`mt-2 hidden text-[11px] sm:block ${i === step ? "font-medium" : "text-muted-foreground"}`}>{s}</p>
          </div>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.18 }}
          className="space-y-5"
        >
          {step === 0 && (
            <>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight">Claim this instance</h1>
                <p className="mt-2 text-muted-foreground">
                  Enter the one-time setup code printed in the server logs (<code className="rounded bg-muted px-1 text-xs">docker compose logs app</code>).
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="code">Setup code</Label>
                <div className="relative">
                  <KeyRound className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="code" value={values.code} onChange={set("code")} placeholder="1234-5678" className="h-11 pl-9 font-mono text-base tracking-widest" autoFocus />
                </div>
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight">Name your workspace</h1>
                <p className="mt-2 text-muted-foreground">Projects, members and reports live in a workspace. You can add more later.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="workspaceName">Workspace / company name</Label>
                <Input id="workspaceName" value={values.workspaceName} onChange={set("workspaceName")} placeholder="Solakon" className="h-11" autoFocus />
              </div>
              <div className="space-y-2">
                <Label htmlFor="appName">App name (shown in the UI and emails)</Label>
                <Input id="appName" value={values.appName} onChange={set("appName")} className="h-11" />
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight">Create the owner account</h1>
                <p className="mt-2 text-muted-foreground">You&apos;ll be the instance admin. Later logins use magic links sent to this email.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Your name</Label>
                <Input id="name" value={values.name} onChange={set("name")} className="h-11" autoFocus />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Your email</Label>
                <Input id="email" type="email" value={values.email} onChange={set("email")} placeholder="you@company.com" className="h-11" />
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight">Who may sign in?</h1>
                <p className="mt-2 text-muted-foreground">
                  Only invited people can log in. Optionally restrict invitations to your company domains.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="allowedDomains">Allowed email domains (comma separated, empty = any)</Label>
                <Input
                  id="allowedDomains"
                  value={values.allowedDomains}
                  onChange={set("allowedDomains")}
                  placeholder={emailDomain || "company.com"}
                  className="h-11"
                  autoFocus
                />
                {emailDomain && !values.allowedDomains && (
                  <button
                    type="button"
                    className="text-xs font-medium text-brand hover:underline"
                    onClick={() => setValues((v) => ({ ...v, allowedDomains: emailDomain }))}
                  >
                    Use @{emailDomain}
                  </button>
                )}
              </div>
              {state.error && (
                <Alert variant="destructive">
                  <AlertDescription>{state.error}</AlertDescription>
                </Alert>
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>
      <div className="mt-8 flex gap-2">
        {step > 0 && (
          <Button type="button" variant="outline" className="h-11" onClick={() => setStep((s) => s - 1)}>
            <ArrowLeft className="size-4" />
          </Button>
        )}
        {step < steps.length - 1 ? (
          <Button key="next" type="button" className="h-11 flex-1" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
            Continue <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button key="submit" type="submit" className="h-11 flex-1" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <>Finish setup <ArrowRight className="size-4" /></>}
          </Button>
        )}
      </div>
    </form>
  );
}
