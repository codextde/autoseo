import { requireAdmin } from "@/server/auth/guards";
import { getAdminSettings } from "@/server/admin/settings";
import { getFreeToolsUsageToday, type FreeToolsUsageToday } from "@/server/free-tools/budget";
import { env } from "@/server/env";
import { AdminPage } from "@/features/admin/components/settings-kit";
import { FreeToolsForm } from "@/features/admin/components/free-tools-form";
import { FreeToolsUsageCard } from "@/features/admin/components/free-tools-usage";

export const metadata = { title: "Free SEO Tools · Admin" };

export default async function AdminFreeToolsPage() {
  await requireAdmin();
  const settings = await getAdminSettings("freeTools");
  let usage: FreeToolsUsageToday | null = null;
  let usageError: string | null = null;
  try {
    usage = await getFreeToolsUsageToday();
  } catch (err) {
    console.error("[admin/free-tools] usage", err);
    usageError = "the usage counters are not available yet";
  }
  return (
    <AdminPage
      title="Free SEO Tools"
      description="Backlink checker, keyword generator, traffic checker and more — for your team, and optionally public as a lead magnet with strict budget and bot protection."
    >
      <FreeToolsUsageCard usage={usage} error={usageError} />
      <FreeToolsForm initial={settings} appUrl={env.appUrl} />
    </AdminPage>
  );
}
