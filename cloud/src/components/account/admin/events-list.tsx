import { cn } from "@/lib/utils";

export type EventItem = {
  id: string;
  type: string;
  userId: string | null;
  instanceId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
};

function tone(type: string) {
  if (/failed|error|unmatched|mismatch|unhealthy/.test(type)) return "bg-destructive";
  if (/running|connected|created|healthy_again|signup/.test(type)) return "bg-brand";
  if (/stopped|deleted|canceled|expired/.test(type)) return "bg-warning";
  return "bg-muted-foreground/50";
}

/** Latest audit events (newest first). */
export function EventsList({ events }: { events: EventItem[] }) {
  if (!events.length) return <p className="py-10 text-center text-sm text-muted-foreground">No events yet.</p>;
  return (
    <ol className="divide-y rounded-xl border bg-card">
      {events.map((e) => {
        const data = Object.keys(e.data ?? {}).length ? JSON.stringify(e.data) : "";
        return (
          <li key={e.id} className="flex gap-3 px-4 py-3 text-sm">
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", tone(e.type))} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-mono text-xs font-medium">{e.type}</span>
                <time className="text-xs text-muted-foreground tabular-nums" dateTime={e.createdAt}>
                  {new Date(e.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "medium" })}
                </time>
              </div>
              {(e.instanceId || e.userId) && (
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {[e.instanceId, e.userId].filter(Boolean).join(" · ")}
                </p>
              )}
              {data && <p className="mt-1 font-mono text-[11px] break-all text-muted-foreground">{data.length > 600 ? `${data.slice(0, 600)}…` : data}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
