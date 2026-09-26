import { Suspense } from "react";
import { requireAdmin } from "@/server/auth/guards";
import { getAdminSettings } from "@/server/admin/settings";
import { getOnboardingPageData } from "@/server/admin/onboarding";
import { getBranding } from "@/server/branding";
import { AdminPage } from "@/features/admin/components/settings-kit";
import { OnboardingAdmin } from "@/features/onboarding/admin/onboarding-admin";

export const metadata = { title: "Onboarding · Admin" };

export default async function AdminOnboardingPage() {
  const ctx = await requireAdmin();
  const [initial, base, branding] = await Promise.all([getAdminSettings("onboarding"), getOnboardingPageData(ctx), getBranding()]);
  return (
    <AdminPage
      title="Onboarding"
      description="Configure the new-project wizard: steps, defaults, AI suggestions and texts. The preview updates as you type."
    >
      <Suspense>
        <OnboardingAdmin
          initial={initial}
          base={base}
          branding={{ showProductTour: branding.showProductTour, demoBookingUrl: branding.demoBookingUrl }}
        />
      </Suspense>
    </AdminPage>
  );
}
