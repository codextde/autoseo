import { TabNav } from "@/components/app/page";

export function FactCheckTabs({ projectId, active, right }: { projectId: string; active: "overview" | "findings" | "accuracy"; right?: React.ReactNode }) {
  const base = `/p/${projectId}/fact-check`;
  return (
    <TabNav
      active={active}
      right={right}
      tabs={[
        { key: "overview", label: "Overview", href: base },
        { key: "findings", label: "Findings", href: `${base}/findings` },
        { key: "accuracy", label: "Accuracy", href: `${base}/accuracy` },
      ]}
    />
  );
}
