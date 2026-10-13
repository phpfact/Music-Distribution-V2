// Liveness: answers as long as the server process can handle requests. It
// deliberately checks no dependencies, so a database outage does not make the
// container itself look dead. Use /api/health/ready for dependency status.
export const dynamic = "force-dynamic";

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
