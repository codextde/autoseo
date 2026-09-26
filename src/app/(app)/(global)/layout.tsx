import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/app-shell";
import { requireUser } from "@/server/auth/guards";
import { getShellData } from "@/server/shell";

export default async function GlobalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireUser();
  const data = await getShellData(ctx.user.lastProjectId);
  if (!data) redirect("/login");
  return <AppShell data={data}>{children}</AppShell>;
}
