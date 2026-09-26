import { redirect } from "next/navigation";
import { AuthSplitLayout } from "@/components/app/auth-split-layout";
import { LoginForm } from "@/features/auth/components/login-form";
import { getBranding } from "@/server/branding";
import { getUserContext } from "@/server/auth/context";
import { needsSetup } from "@/server/setup";
import { safeNext } from "@/server/auth/login";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await needsSetup()) redirect("/setup");
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : null) ?? undefined;
  if (await getUserContext()) redirect(next ?? "/");
  const brand = await getBranding();
  return (
    <AuthSplitLayout
      aside={
        <div className="max-w-md rounded-2xl border bg-background/80 p-5 shadow-soft backdrop-blur">
          <p className="text-sm font-medium">See how AI talks about your brand.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Track visibility in ChatGPT, Perplexity, Gemini, Claude & Google AI — alongside rankings, backlinks and audits.
          </p>
        </div>
      }
    >
      {sp.error === "sso" && (
        <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          That one-click sign-in link is invalid or expired. Open the instance again from your dashboard or sign in
          with your email below.
        </p>
      )}
      <LoginForm next={next} appName={brand.appName} />
    </AuthSplitLayout>
  );
}
