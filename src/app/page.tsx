import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveHost, type TenantAccess, tenantAccessOf } from "@/lib/domains/resolve";

const healthLinks = [
  { href: "/api/health", label: "Liveness", detail: "/api/health" },
  { href: "/api/health/ready", label: "Readiness", detail: "/api/health/ready" },
];

/**
 * `/` answers on every host. On the platform's own host it is the platform's
 * start page; on a tenant host it goes through the tenant gate
 * (src/lib/domains/resolve.ts) and shows only the tenant's status, since the
 * tenant portal does not exist yet. Reading the Host header makes the page
 * dynamic.
 * Input: the incoming Host header.
 * Output: the infrastructure landing page, tenant gate notice or not-found route.
 * Use case: expose existing host resolution through shared UI components.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export default async function HomePage() {
  const resolution = await resolveHost((await headers()).get("host"));
  if (resolution === "platform") return <PlatformHome />;
  const gate = tenantAccessOf(resolution);
  if (gate.access === "unknown") notFound();
  return <TenantStatus gate={gate} />;
}

/**
 * Present the existing allowed, suspended or provisioning tenant-gate message.
 * Input: the known tenant's resolved access result.
 * Output: an accessible status Card without exposing tenant configuration.
 * Use case: keep tenant hosts useful until their portal is implemented.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function TenantStatus({ gate }: { gate: Exclude<TenantAccess, { access: "unknown" }> }) {
  const message =
    gate.access === "allowed"
      ? `${gate.tenant.name} — the tenant portal isn't available yet.`
      : gate.access === "suspended"
        ? "This workspace is suspended."
        : "This workspace is being set up.";
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-16">
      <Card role="status">
        <CardHeader>
          <CardTitle><h1 className="text-2xl font-semibold tracking-tight">{message}</h1></CardTitle>
        </CardHeader>
      </Card>
    </main>
  );
}

/**
 * Render the infrastructure start page and its existing health endpoint links.
 * Input: none; host resolution has already selected the platform route.
 * Output: shared Card, Badge and native API anchors composed with Button.
 * Use case: migrate the foundation screen without inventing product workflows.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function PlatformHome() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-8 px-6 py-16">
      <Card>
        <CardHeader className="gap-3">
          <Badge variant="success" className="w-fit">
            <span className="size-2 rounded-full bg-current" aria-hidden="true" />
            Running
          </Badge>
          <CardTitle><h1 className="text-3xl font-semibold tracking-tight">Music Distribution</h1></CardTitle>
          <p className="text-muted-foreground">
            The application is up. This is the infrastructure foundation only; no product features
            are implemented yet.
          </p>
        </CardHeader>

        <CardContent>
          <ul className="flex flex-col gap-2">
            {healthLinks.map((link) => (
              <li key={link.href}>
                {/* Plain anchors: these are JSON API routes, not pages to prefetch. */}
                <Button asChild variant="outline" className="h-auto w-full flex-col items-start justify-between gap-2 py-3 text-left whitespace-normal sm:flex-row sm:items-center">
                  <a href={link.href}>
                    <span className="font-medium">{link.label}</span>
                    <code className="text-sm break-all text-muted-foreground">{link.detail}</code>
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
