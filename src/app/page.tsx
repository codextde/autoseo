import { redirect } from "next/navigation";
import { getAccessibleProjects, getUserContext } from "@/server/auth/context";
import { needsSetup } from "@/server/setup";

export default async function RootPage() {
  if (await needsSetup()) redirect("/setup");
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  const projects = await getAccessibleProjects();
  const target = projects.find((p) => p.id === ctx.user.lastProjectId) ?? projects[0];
  if (target) redirect(`/p/${target.id}`);
  redirect("/onboarding");
}
