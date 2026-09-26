import { requireAdmin } from "@/server/auth/guards";
import { getSystemInfo, listFeedback } from "@/server/admin/system";
import { AdminPage } from "@/features/admin/components/settings-kit";
import { SystemView } from "@/features/admin/components/system-view";

export const metadata = { title: "System · Admin" };

export default async function AdminSystemPage() {
  await requireAdmin();
  const [info, feedback] = await Promise.all([getSystemInfo(), listFeedback()]);
  return (
    <AdminPage title="System" description="Version, database, storage, background worker and the feedback inbox of this instance.">
      <SystemView info={info} feedback={feedback} />
    </AdminPage>
  );
}
