import Link from "next/link";
import { Shield } from "lucide-react";
import { Brand } from "./brand";
import { UserMenu } from "./user-menu";

export function AccountHeader({ email, isAdmin }: { email: string; isAdmin: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-3 px-4 sm:px-6">
        <Brand href="/dashboard" />
        <nav className="ml-auto flex items-center gap-1 sm:gap-2">
          <Link
            href="/dashboard"
            className="hidden rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
          >
            Dashboard
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Shield className="size-4" /> Admin
            </Link>
          )}
          <UserMenu email={email} isAdmin={isAdmin} />
        </nav>
      </div>
    </header>
  );
}
