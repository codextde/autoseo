import "server-only";
import { AlertTriangle, CheckCircle2, Info, Stethoscope } from "lucide-react";
import { Panel } from "@/components/app/page";
import { getGa4MeasurementHealth, Ga4ReportError } from "@/server/analytics/ga4/reports";

/** GA4 setup health (data streams, enhanced measurement, key events) — rendered inside <Suspense>. */
export async function MeasurementHealthPanel({ projectId }: { projectId: string }) {
  let health: Awaited<ReturnType<typeof getGa4MeasurementHealth>> | null = null;
  let error: string | null = null;
  try {
    health = await getGa4MeasurementHealth({ projectId });
  } catch (err) {
    if (err instanceof Ga4ReportError && err.code === "ga4_not_connected") return null;
    error = err instanceof Error ? err.message : "Could not load the measurement health.";
  }
  return (
    <Panel
      title="GA4 measurement health"
      icon={<Stethoscope className="size-4 text-muted-foreground" />}
      description="Checks that AI-referred conversions can be measured correctly."
    >
      {error || !health ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          {error}
        </p>
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Web streams", health.summary.webStreamCount],
              ["Key events", health.summary.keyEventCount],
              ["Custom dimensions", health.summary.customDimensionCount],
              ["Custom metrics", health.summary.customMetricCount],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-xl bg-muted/60 px-3 py-2">
                <dt className="text-[11px] text-muted-foreground">{label}</dt>
                <dd className="text-lg font-semibold tabular">{value}</dd>
              </div>
            ))}
          </dl>
          {health.issues.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="size-4" /> Everything looks good.
            </p>
          ) : (
            <ul className="space-y-2">
              {health.issues.map((i) => (
                <li key={i.code} className="flex items-start gap-2 text-sm">
                  {i.severity === "warning" ? (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  ) : (
                    <Info className="mt-0.5 size-4 shrink-0 text-info" />
                  )}
                  <span>{i.message}</span>
                </li>
              ))}
            </ul>
          )}
          {health.keyEvents.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Key events</p>
              <div className="flex flex-wrap gap-1.5">
                {health.keyEvents.slice(0, 20).map((k) => (
                  <span key={k.eventName} className="rounded-full border bg-background px-2 py-0.5 text-xs">
                    {k.eventName}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
