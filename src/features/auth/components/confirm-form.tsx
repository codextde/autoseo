"use client";

import { useActionState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function ConfirmForm({
  action,
  token,
  label,
}: {
  action: (prev: { error?: string }, fd: FormData) => Promise<{ error?: string }>;
  token: string;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="mt-8 space-y-4">
      <input type="hidden" name="token" value={token} />
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="h-11 w-full gap-2 text-base" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} {label}
      </Button>
    </form>
  );
}
