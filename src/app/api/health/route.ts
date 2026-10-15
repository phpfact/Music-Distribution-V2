// Liveness: answers as long as the server process can handle requests. It
// deliberately checks no dependencies, so a database outage does not make the
// container itself look dead. Use /api/health/ready for dependency status.
export const dynamic = "force-dynamic";

/**
 * Description: Liveness: report that the server process answers.
 * Input: None.
 * Output: 200 with status ok, uptime and time; never cached.
 * Use case: Container health checks.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-13
 * Last modified: 2026-10-15
 */
export function GET() {
  return Response.json(
    {
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
