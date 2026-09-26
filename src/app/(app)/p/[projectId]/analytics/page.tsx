import { redirect } from "next/navigation";
import { requireProject } from "@/server/auth/guards";

/** /analytics → Human Traffic (first entry of the Analytics group). */
export default async function AnalyticsIndex({ params }: PageProps<"/p/[projectId]/analytics">) {
  const { projectId } = await params;
  await requireProject(projectId);
  redirect(`/p/${projectId}/analytics/traffic`);
}
