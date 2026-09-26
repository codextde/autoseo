import { notFound } from "next/navigation";
import { AppShell } from "@/components/app/app-shell";
import { requireProject } from "@/server/auth/guards";
import { getShellData } from "@/server/shell";

export default async function ProjectLayout({ children, params }: LayoutProps<"/p/[projectId]">) {
  const { projectId } = await params;
  await requireProject(projectId);
  const data = await getShellData(projectId);
  if (!data) notFound();
  return <AppShell data={data}>{children}</AppShell>;
}
