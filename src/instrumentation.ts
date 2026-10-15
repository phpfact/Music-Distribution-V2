/**
 * Description: Run the server's one-time startup checks.
 * Input: None.
 * Output: Nothing; on the Node.js server (not the edge runtime or the build) the
 *   configuration is validated before the first request.
 * Use case: Next.js instrumentation hook.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-13
 * Last modified: 2026-10-15
 */
export async function register() {
  // Only the Node.js server has the runtime environment; skip the edge runtime
  // and `next build`, where secrets are intentionally absent.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { validateStartupConfig } = await import("./lib/startup");
  validateStartupConfig();
}
