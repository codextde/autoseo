import Link from "next/link";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const metadata = { title: "Confirm sign-in" };

export default async function VerifyPage({ searchParams }: PageProps<"/auth/verify">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const error = typeof sp.error === "string";
  return (
    <div>
      <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
        <ShieldCheck className="size-6" />
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">Confirm sign-in</h1>
      <p className="mt-2 text-muted-foreground">
        One more click to sign in on this device. This extra step keeps email security scanners from using your link.
      </p>
      {error ? (
        <Alert variant="destructive" className="mt-6">
          <TriangleAlert />
          <AlertDescription>This sign-in link is invalid, has expired or was already used. Request a new one below.</AlertDescription>
        </Alert>
      ) : token ? (
        // Plain form POST: works without JavaScript and the token never ends up in a server action payload log.
        <form method="post" action="/api/auth/verify" className="mt-8">
          <input type="hidden" name="token" value={token} />
          <Button type="submit" className="h-11 w-full text-base">
            <ShieldCheck /> Sign in on this device
          </Button>
        </form>
      ) : (
        <Alert variant="destructive" className="mt-6">
          <TriangleAlert />
          <AlertDescription>This link is missing its token. Request a new sign-in email.</AlertDescription>
        </Alert>
      )}
      <Link href="/login" className="mt-6 block text-center text-sm text-muted-foreground hover:text-foreground">
        Request a new link
      </Link>
    </div>
  );
}
