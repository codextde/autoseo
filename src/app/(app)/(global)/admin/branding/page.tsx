import { requireAdmin } from "@/server/auth/guards";
import { getAdminSettings } from "@/server/admin/settings";
import { AdminPage } from "@/features/admin/components/settings-kit";
import { BrandingEditor, type GeneralSettings } from "@/features/admin/components/branding-form";

export const metadata = { title: "Branding · Admin" };

export default async function AdminBrandingPage() {
  await requireAdmin();
  const settings = await getAdminSettings("general");
  return (
    <AdminPage
      title="Branding"
      description="White-label the instance: name, logo, colors, language and the links shown to your team."
    >
      <BrandingEditor initial={{ values: settings.values as GeneralSettings, secrets: settings.secrets }} />
    </AdminPage>
  );
}
