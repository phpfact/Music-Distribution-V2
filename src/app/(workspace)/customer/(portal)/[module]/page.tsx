import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/dashboard/coming-soon";
import { requireCustomer } from "@/lib/workspace/guards";
import { CUSTOMER_DASHBOARD_PATH, findCustomerModule } from "../navigation";

type PageProps = { params: Promise<{ module: string }> };

/**
 * Description: Title a placeholder module page.
 * Input: The route's `module` segment.
 * Output: The module's title ("Not found" for unknown segments).
 * Use case: Next.js metadata of /customer/[module].
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const plannedModule = findCustomerModule((await params).module);
  return { title: plannedModule?.title ?? "Not found" };
}

/**
 * Description: Render the honest placeholder of a customer module that is not built yet.
 * Input: The route's `module` segment.
 * Output: The "coming soon" page for a planned module; 404 for anything else.
 *   Requires a customer session like every protected /customer page.
 * Use case: /customer/releases, /artists, /labels, /royalties, /payouts.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function CustomerModulePage({ params }: PageProps) {
  await requireCustomer();
  const plannedModule = findCustomerModule((await params).module);
  if (!plannedModule) notFound();

  return <ComingSoon title={plannedModule.title} description={plannedModule.description} homeHref={CUSTOMER_DASHBOARD_PATH} />;
}
