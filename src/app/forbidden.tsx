import Link from "next/link";
import { Home, LockKeyhole, LogOut, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBranding } from "@/server/branding";
import { getCurrentSession } from "@/server/auth/session";
import { logoutAction } from "@/features/shell/actions";
import { BackButton, StatusScreen } from "@/features/admin/components/system-status-screen";

export const metadata = { title: "Access denied" };

export default async function Forbidden() {
  const [brand, session] = await Promise.all([getBranding(), getCurrentSession().catch(() => null)]);
  return (
    <StatusScreen
      code="403"
      tone="warning"
      icon={<LockKeyhole className="size-5" />}
      brand={{ appName: brand.appName, logoUrl: brand.logoUrl }}
      title="You don't have access"
      description={
        <>
          Your role doesn&apos;t include permission for this page.
          {session ? (
            <>
              {" "}
              You&apos;re signed in as <span className="font-medium text-foreground">{session.user.email}</span>.
            </>
          ) : null}{" "}
          Ask a workspace owner or instance admin to grant access.
        </>
      }
      actions={
        <>
          <BackButton />
          <Button asChild size="lg" className="h-10 px-4">
            <Link href="/">
              <Home className="size-4" /> Go to dashboard
            </Link>
          </Button>
        </>
      }
      footer={
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-5">
          {session && (
            <form action={logoutAction}>
              <button type="submit" className="inline-flex items-center gap-1.5 hover:text-foreground">
                <LogOut className="size-3.5" /> Sign in with a different account
              </button>
            </form>
          )}
          {brand.supportEmail && (
            <a href={`mailto:${brand.supportEmail}?subject=${encodeURIComponent("Access request")}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
              <Mail className="size-3.5" /> Request access
            </a>
          )}
        </div>
      }
    />
  );
}
