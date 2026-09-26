import { redirect } from "next/navigation";
import { AuthSplitLayout } from "@/components/app/auth-split-layout";
import { SetupForm } from "@/features/auth/components/setup-form";
import { ensureSetupCode, needsSetup } from "@/server/setup";

export const metadata = { title: "Setup" };

export default async function SetupPage() {
  if (!(await needsSetup())) redirect("/");
  await ensureSetupCode();
  return (
    <AuthSplitLayout
      aside={
        <div className="max-w-md rounded-2xl border bg-background/80 p-5 shadow-soft backdrop-blur">
          <p className="text-sm font-medium">Everything is configured in the app.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            After setup, connect email (Amazon SES / SMTP), AI providers, DataForSEO and local agents in the admin panel.
          </p>
        </div>
      }
    >
      <SetupForm />
    </AuthSplitLayout>
  );
}
