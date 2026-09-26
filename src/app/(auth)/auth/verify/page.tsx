import Link from "next/link";
import { AuthSplitLayout } from "@/components/app/auth-split-layout";
import { ConfirmForm } from "@/features/auth/components/confirm-form";
import { confirmMagicLinkAction } from "@/features/auth/actions";

export const metadata = { title: "Confirm sign-in" };

export default async function VerifyPage({ searchParams }: PageProps<"/auth/verify">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  return (
    <AuthSplitLayout>
      <h1 className="text-3xl font-semibold tracking-tight">Confirm sign-in</h1>
      <p className="mt-2 text-muted-foreground">
        One more click to sign in on this device. (This extra step keeps email security scanners from using your link.)
      </p>
      {token ? (
        <ConfirmForm action={confirmMagicLinkAction} token={token} label="Sign in on this device" />
      ) : (
        <p className="mt-6 text-sm text-destructive">This link is missing its token.</p>
      )}
      <Link href="/login" className="mt-6 block text-center text-sm text-muted-foreground hover:text-foreground">
        Request a new link
      </Link>
    </AuthSplitLayout>
  );
}
