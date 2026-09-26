import { requireAdmin } from "@/server/auth/guards";
import { getAdminSettings } from "@/server/admin/settings";
import { env } from "@/server/env";
import { AdminPage } from "@/features/admin/components/settings-kit";
import { DataSettings } from "@/features/admin/components/data-settings";

export const metadata = { title: "Data Providers · Admin" };

export default async function AdminDataPage() {
  await requireAdmin();
  const [dataforseo, google, integrations] = await Promise.all([
    getAdminSettings("dataforseo"),
    getAdminSettings("google"),
    getAdminSettings("integrations"),
  ]);
  return (
    <AdminPage
      title="Data Providers"
      description="DataForSEO, Google (Search Console, Analytics, PageSpeed), Bing and Cloudflare credentials for the whole instance."
    >
      <DataSettings dataforseo={dataforseo} google={google} integrations={integrations} appUrl={env.appUrl} />
    </AdminPage>
  );
}
