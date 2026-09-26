import { requireAdmin } from "@/server/auth/guards";
import { AdminNav } from "@/features/admin/components/admin-nav";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();
  return (
    <div className="mx-auto flex w-full max-w-[1440px] min-w-0 flex-col gap-4 px-3 py-4 sm:px-5 sm:py-6 lg:flex-row lg:gap-8">
      <AdminNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
