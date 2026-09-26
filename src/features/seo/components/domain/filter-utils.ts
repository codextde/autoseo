/** Active (non-empty) filter fields — drives the Filters toggle badge. */
export function countActiveFilterConditions(values: Record<string, string>): number {
  return Object.values(values).filter((v) => v != null && String(v).trim() !== "").length;
}
