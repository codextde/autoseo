import type { Metadata } from "next";
import Link from "next/link";
import { AccountHeader } from "@/components/account/account-header";
import { getCurrentSession } from "@/server/auth/session";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Signed-in area. Each page enforces its own access (and redirects to /login with the right `next`). */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const current = await getCurrentSession();
  return (
    <div className="flex min-h-dvh flex-col">
      {current && <AccountHeader email={current.user.email} isAdmin={current.user.isAdmin} />}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
      <footer className="border-t border-border/70">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} Codext GmbH · AutoSEO Cloud</p>
          <p className="flex gap-4">
            <a href="https://github.com/codextde/autoseo" target="_blank" rel="noopener" className="hover:text-foreground">
              GitHub
            </a>
            <a href="mailto:info@codext.de" className="hover:text-foreground">
              Support
            </a>
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
