import { requireProject } from "@/server/auth/guards";
import { getBranding } from "@/server/branding";
import { PageContainer, PageHeader } from "@/components/app/page";
import { TourOverview } from "@/features/tour/components/tour-overview";
import { readTourState } from "@/features/tour/server";

export const metadata = { title: "Product tour" };

export default async function ProductTourPage({ params }: PageProps<"/p/[projectId]/tour">) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId);
  const branding = await getBranding();
  const state = readTourState(ctx.user.preferences);
  return (
    <PageContainer className="max-w-5xl">
      <PageHeader
        eyebrow="Product tour"
        title="Explore the platform"
        description="Pick a tour for how you work — business or agency — and follow it through the real pages of your project."
      />
      <TourOverview
        projectId={projectId}
        initialState={state}
        enabled={branding.showProductTour}
        isAdmin={ctx.isInstanceAdmin}
        appName={branding.appName}
      />
    </PageContainer>
  );
}
