import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/dashboard/coming-soon";
import { requireTenantUser } from "@/lib/workspace/guards";
import { findTenantModule, TENANT_DASHBOARD_PATH } from "../navigation";

type PageProps = { params: Promise<{ module: string }> };

/**
 * Description: Title a placeholder module page.
 * Input: The route's `module` segment.
 * Output: The module's title ("Not found" for unknown segments).
 * Use case: Next.js metadata of /tenant/[module].
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const plannedModule = findTenantModule((await params).module);
  return { title: plannedModule?.title ?? "Not found" };
}

/**
 * Description: Render the honest placeholder of a tenant module that is not built yet.
 * Input: The route's `module` segment.
 * Output: The "coming soon" page for a planned module; 404 for anything else.
 *   Requires a tenant staff session like every /tenant page.
 * Use case: /tenant/releases, /artists, /labels, /customers, /distribution,
 *   /analytics, /royalties.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function TenantModulePage({ params }: PageProps) {
  await requireTenantUser();
  const plannedModule = findTenantModule((await params).module);
  if (!plannedModule) notFound();

  return <ComingSoon title={plannedModule.title} description={plannedModule.description} homeHref={TENANT_DASHBOARD_PATH} />;
}
