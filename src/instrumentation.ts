export async function register() {
  // Only the Node.js server has the runtime environment; skip the edge runtime
  // and `next build`, where secrets are intentionally absent.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { validateStartupConfig } = await import("./lib/startup");
  validateStartupConfig();
}
