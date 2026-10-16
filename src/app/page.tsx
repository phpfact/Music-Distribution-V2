import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WelcomePage } from "@/components/workspace/welcome-page";
import { WorkspaceThemeRoot } from "@/components/workspace/theme-root";
import { WorkspaceUnavailable } from "@/components/workspace/workspace-unavailable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPublicAppearance } from "@/lib/workspace/appearance";
import { getHostResolution, getWorkspace } from "@/lib/workspace/context";

const healthLinks = [
  { href: "/api/health", label: "Liveness", detail: "/api/health" },
  { href: "/api/health/ready", label: "Readiness", detail: "/api/health/ready" },
];

/**
 * Description: Name the browser tab after the tenant on a tenant host.
 * Input: None (the Host header is read on the server).
 * Output: "<tenant name>" for a tenant that may be served; otherwise the
 *   root layout's default title.
 * Use case: Next.js metadata of "/".
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function generateMetadata(): Promise<Metadata> {
  if ((await getHostResolution()) === "platform") return {};
  const workspace = await getWorkspace();
  return workspace.state === "ready" ? { title: workspace.tenant.name } : {};
}

/**
 * Description: `/` answers on every host.
 * Input: The incoming Host header (read on the server).
 * Output: On the platform's own host the infrastructure start page. On a
 *   tenant host (subdomain or verified custom domain) the tenant gate decides:
 *   allowed → the tenant's welcome page in its workspace default appearance;
 *   suspended / setup unfinished → a friendly notice without tenant data;
 *   unknown host → the friendly 404 page (never another tenant's data).
 *   Reading the Host header makes the page dynamic.
 * Use case: Entry point of every domain (.vibe/memory/platform-host-gate.md).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export default async function HomePage() {
  // Step 1: the platform's own host keeps its start page.
  if ((await getHostResolution()) === "platform") return <PlatformHome />;

  // Step 2: a tenant host goes through the tenant gate.
  const workspace = await getWorkspace();
  if (workspace.state === "unknown") notFound();
  if (workspace.state === "suspended" || workspace.state === "not_ready") {
    return <WorkspaceUnavailable reason={workspace.state} />;
  }
  if (workspace.state === "unavailable") throw new Error("The workspace is temporarily unavailable.");

  // Step 3: the tenant's welcome page in its workspace default appearance.
  const appearance = await getPublicAppearance(workspace.db);
  return (
    <WorkspaceThemeRoot appearance={appearance}>
      <WelcomePage tenantName={workspace.tenant.name} />
    </WorkspaceThemeRoot>
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
