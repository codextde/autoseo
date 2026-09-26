import { Link2Off } from "lucide-react";

export default function ShareNotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 p-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl border bg-background">
          <Link2Off className="size-5 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-semibold">This report isn&apos;t shared.</h1>
        <p className="mt-1 text-sm text-muted-foreground">The link may have been revoked, expired or mistyped. Ask the sender for a new link.</p>
      </div>
    </div>
  );
}
