export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Image builds (`AUTOSEO_SKIP_BOOT=1 pnpm build`) and `next build` itself must not touch the database.
  if (process.env.AUTOSEO_SKIP_BOOT === "1" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { ensureBooted } = await import("@/server/boot");
  await ensureBooted();
}
