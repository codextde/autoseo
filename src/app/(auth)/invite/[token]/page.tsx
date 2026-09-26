import Link from "next/link";
import { AuthSplitLayout } from "@/components/app/auth-split-layout";
import { ConfirmForm } from "@/features/auth/components/confirm-form";
import { acceptInviteAction } from "@/features/auth/actions";
import { peekInvitation } from "@/server/auth/membership";

export const metadata = { title: "Accept invitation" };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const row = await peekInvitation(decodeURIComponent(token));
  const valid = row && row.invite.status === "pending" && row.invite.expiresAt > new Date();
  return (
    <AuthSplitLayout>
      {valid ? (
        <>
          <p className="text-sm font-medium text-brand">Invitation</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-balance">Join {row.workspace.name}</h1>
          <p className="mt-2 text-muted-foreground">
            You were invited as <span className="font-medium text-foreground">{row.invite.roleKey}</span> with{" "}
            <span className="font-medium text-foreground">{row.invite.email}</span>.
          </p>
          <ConfirmForm action={acceptInviteAction} token={decodeURIComponent(token)} label="Accept & sign in" />
        </>
      ) : (
        <>
          <h1 className="text-3xl font-semibold tracking-tight">Invitation unavailable</h1>
          <p className="mt-2 text-muted-foreground">This invitation is invalid, expired or was already used. Ask your admin for a new one.</p>
          <Link href="/login" className="mt-6 inline-block text-sm font-medium underline underline-offset-4">
            Go to sign in
          </Link>
        </>
      )}
    </AuthSplitLayout>
  );
}
