import type { AgentOrbState } from "@/components/agent-ui";

/** Status presentation shared by server and client components (no "use client" here on purpose). */
export type AgentStatusValue = "pending" | "online" | "offline" | "updating" | "paused";

export const STATUS_META: Record<AgentStatusValue, { label: string; dot: string; chip: string; orb: AgentOrbState; hint: string }> = {
  online: {
    label: "Online",
    dot: "bg-success",
    chip: "bg-success/12 text-success ring-success/25",
    orb: "idle",
    hint: "Checked in recently and accepts jobs.",
  },
  updating: {
    label: "Updating",
    dot: "bg-info",
    chip: "bg-info/12 text-info ring-info/25",
    orb: "working",
    hint: "Installing a new agent version — finishes running jobs first.",
  },
  paused: {
    label: "Paused",
    dot: "bg-warning",
    chip: "bg-warning/15 text-warning ring-warning/30",
    orb: "thinking",
    hint: "Online, but receives no new jobs (self-tests still run).",
  },
  offline: {
    label: "Offline",
    dot: "bg-muted-foreground/50",
    chip: "bg-muted text-muted-foreground ring-border",
    orb: "offline",
    hint: "No check-in recently — the machine is off, asleep or disconnected.",
  },
  pending: {
    label: "Waiting for install",
    dot: "bg-muted-foreground/40",
    chip: "bg-muted text-muted-foreground ring-border",
    orb: "offline",
    hint: "Run the install command on the machine — it appears here within seconds.",
  },
};

