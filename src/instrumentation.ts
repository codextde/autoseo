export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.AUTOSEO_SKIP_BOOT === "1") return;
  const { ensureBooted } = await import("@/server/boot");
  await ensureBooted();
}
