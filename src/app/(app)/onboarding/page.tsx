import { Suspense } from "react";
import { requireUser } from "@/server/auth/guards";
import { getOnboardingPageData } from "@/server/admin/onboarding";
import { OnboardingWizard } from "@/features/onboarding/components/wizard";

export const metadata = { title: "Set up your project" };

export default async function OnboardingPage() {
  const ctx = await requireUser();
  const data = await getOnboardingPageData(ctx);
  return (
    <Suspense>
      <OnboardingWizard data={data} />
    </Suspense>
  );
}
