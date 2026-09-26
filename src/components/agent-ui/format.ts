/** Small formatting helpers shared by the agent UI blocks. */

/** "850ms", "1.2s", "14s", "2m 5s", "1h 3m" */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1).replace(/\.0$/, "")}s`;
  if (s < 60) return `${Math.round(s)}s`;
  const totalSec = Math.round(s);
  const m = Math.floor(totalSec / 60);
  if (m < 60) {
    const rest = totalSec % 60;
    return rest ? `${m}m ${rest}s` : `${m}m`;
  }
  const h = Math.floor(m / 60);
  const restM = m % 60;
  return restM ? `${h}h ${restM}m` : `${h}h`;
}

/** Whole seconds for "Thought for Ns" style labels (min 1s, minutes above 60s). */
export function formatSeconds(ms: number): string {
  const sec = Math.max(1, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const rest = sec % 60;
  return rest ? `${m}m ${rest}s` : `${m}m`;
}

/** Renders any value for display: strings as-is, everything else as pretty JSON. */
export function stringifyValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function toTimestamp(value: number | Date | undefined): number | undefined {
  if (value == null) return undefined;
  return typeof value === "number" ? value : value.getTime();
}
