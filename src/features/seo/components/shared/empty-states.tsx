import Link from "next/link";
import { Lock, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";
import { Panel } from "@/components/app/page";

/** Shown on every SEO page when DataForSEO credentials are missing. */
export function DataForSeoNotConfigured({ isAdmin, feature }: { isAdmin: boolean; feature?: string }) {
  return (
    <Panel>
      <EmptyState
        icon={PlugZap}
        title="Connect DataForSEO"
        description={
          <>
            {feature ? `${feature} is` : "SEO research is"} powered by DataForSEO (pay-as-you-go, you bring your own account).{" "}
            {isAdmin ? "Add your API login and password in Admin → Data Providers." : "Ask an instance admin to connect it in Admin → Data Providers."}
          </>
        }
        action={
          isAdmin ? (
            <Button asChild>
              <Link href="/admin/data">Open Admin → Data Providers</Link>
            </Button>
          ) : undefined
        }
      />
    </Panel>
  );
}

/** Slim banner variant for pages that still show stored data (saved keywords, rank tracking). */
export function DataForSeoBanner({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2">
        <PlugZap className="mt-0.5 size-4 shrink-0 text-warning" />
        <span>
          <span className="font-medium">DataForSEO isn&apos;t connected.</span>{" "}
          <span className="text-muted-foreground">Stored data stays visible; new checks and metric refreshes are disabled.</span>
        </span>
      </div>
      {isAdmin ? (
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link href="/admin/data">Connect DataForSEO</Link>
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">Ask an admin: Admin → Data Providers</span>
      )}
    </div>
  );
}

export function ReadOnlyNote({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground ${className ?? ""}`}>
      <Lock className="size-3.5" />
      You have read-only access — cached results are shown, but running new paid research requires the “Run paid SEO research” permission.
    </div>
  );
}
