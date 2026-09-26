/** Resolves the attribution page period (7d / 30d / 90d / custom from..to) to UTC bounds. Pure. */
export type ResolvedPeriod = { preset: string; from: Date; to: Date; fromParam?: string; toParam?: string };

const DAY = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function resolveAttributionPeriod(preset: string | undefined, from?: string, to?: string): ResolvedPeriod {
  if (preset === "custom" && from && DATE_RE.test(from)) {
    const f = new Date(`${from}T00:00:00.000Z`);
    const t = to && DATE_RE.test(to) ? new Date(`${to}T23:59:59.999Z`) : new Date();
    if (!Number.isNaN(f.getTime()) && !Number.isNaN(t.getTime()) && f <= t && t.getTime() - f.getTime() <= 400 * DAY) {
      return { preset: "custom", from: f, to: t, fromParam: from, toParam: to };
    }
  }
  const days = preset === "7d" ? 7 : preset === "90d" ? 90 : 30;
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  const start = new Date(end.getTime() - days * DAY + 1);
  return { preset: `${days}d`, from: start, to: end };
}
