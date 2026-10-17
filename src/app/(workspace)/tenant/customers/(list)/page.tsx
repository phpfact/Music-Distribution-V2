import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CustomersDirectory } from "@/components/customers/customers-directory";
import { CustomersSummary } from "@/components/customers/customer-summary";
import { parseRbacListQuery } from "@/components/rbac/list-href";
import { RbacToolbar } from "@/components/rbac/rbac-toolbar";
import { DeniedScreen, LoadFailed, ScreenFrame } from "@/components/rbac/screens/screen-parts";
import { SectionedLayout, type SecondaryMenuItem } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireTenantAccess } from "@/lib/authz/workspace";
import { describeError } from "@/lib/platform-auth/session";
import {
  customerNoticeMessage,
  type CustomerListQuery,
  type CustomerPage,
  type CustomerSummary,
} from "@/lib/workspace/customer-rules";
import { getCustomerSummary, listCustomers } from "@/lib/workspace/customers";
import type { TenantArea } from "@/lib/workspace/guards";
import { TENANT_CUSTOMERS_PATH, TENANT_DASHBOARD_PATH } from "../../navigation";
import { loadTenantCustomerRecordsAction, setTenantCustomerStatusAction } from "../actions";
import { TENANT_CUSTOMERS_EYEBROW, TENANT_CUSTOMERS_GUTTER } from "../screen";

export const metadata: Metadata = { title: "Customers" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The page's sections (secondary-menu targets), in page order. */
const SECTIONS = {
  summary:   { id: "customers-summary", label: "Summary" },
  directory: { id: "customers-directory", label: "Customers" },
} as const;
const MENU_ITEMS: readonly SecondaryMenuItem[] = Object.values(SECTIONS);

const PAGE_DESCRIPTION = "Your artists, labels and white-label partners: approved sign-ups and the customers you added.";

/**
 * Description: The tenant's Customers list (.vibe/memory/customer-management.md).
 * Input: The URL's search, status, page and one-off notice (anyone can edit them).
 * Output: Without tenant.customers.view the inline access-denied state (HTTP
 *   200, nothing read). Otherwise the header ("Add customer" only with
 *   tenant.customers.create), the success notice after a creation, the top
 *   secondary menu, three clickable summary figures, the search/status toolbar
 *   and one server page of main customers (Suspend / Reactivate only with
 *   tenant.customers.suspend; the actions check again).
 * Use case: /tenant/customers — only this Host's tenant database is ever read.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export default async function TenantCustomersPage({ searchParams }: PageProps) {
  // Step 1: a signed-in staff user of this host; the CURRENT privileges decide access.
  const area = await requireTenantAccess();
  if (!area.authz.can("tenant.customers.view")) {
    return <DeniedScreen gutterClassName={TENANT_CUSTOMERS_GUTTER} homeHref={TENANT_DASHBOARD_PATH} />;
  }
  const canCreate  = area.authz.can("tenant.customers.create");
  const canSuspend = area.authz.can("tenant.customers.suspend");

  // Step 2: URL state (search, status, page; customers have no role filter) and the notice.
  const params                   = await searchParams;
  const parsed                   = parseRbacListQuery(params);
  const query: CustomerListQuery = { q: parsed.q, status: parsed.status, page: parsed.page };
  // The shared toolbar and paging also know a role filter; it is always empty here.
  const listQuery                = { ...query, role: "" };
  const notice                   = customerNoticeMessage(params.notice);

  const addButton = canCreate ? (
    <Button asChild>
      <Link href={`${TENANT_CUSTOMERS_PATH}/new`}>
        <PlusIcon aria-hidden="true" />
        Add customer
      </Link>
    </Button>
  ) : undefined;

  const frame = {
    gutterClassName: TENANT_CUSTOMERS_GUTTER,
    eyebrow: TENANT_CUSTOMERS_EYEBROW,
    title: "Customers",
    description: PAGE_DESCRIPTION,
    actions: addButton,
    notice,
  };

  // Step 3: the counts and the requested page (a failure shows a friendly message, details are logged).
  const loaded = await loadCustomersPage(area, query);
  if (!loaded) {
    return (
      <ScreenFrame {...frame}>
        <LoadFailed message="The customers could not be loaded right now. Please try again." />
      </ScreenFrame>
    );
  }

  // Step 4: the page. The toolbar and paging keep their state in the URL (no full reload).
  return (
    <ScreenFrame {...frame}>
      <SectionedLayout items={MENU_ITEMS} variant="top" contentClassName="flex flex-col gap-6">
        <section id={SECTIONS.summary.id} aria-labelledby={`${SECTIONS.summary.id}-title`} className="flex flex-col gap-3">
          <h2 id={`${SECTIONS.summary.id}-title`} className="text-base font-semibold">
            Summary
          </h2>
          <CustomersSummary counts={loaded.summary} loadRecords={loadTenantCustomerRecordsAction} />
        </section>

        <section id={SECTIONS.directory.id} aria-labelledby={`${SECTIONS.directory.id}-title`}>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 id={`${SECTIONS.directory.id}-title`} className="text-base font-semibold">
                  Customers
                </h2>
              </CardTitle>
              <CardDescription>Search by name, username or email and filter by status.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <RbacToolbar
                basePath={TENANT_CUSTOMERS_PATH}
                query={listQuery}
                searchPlaceholder="Name, username or email"
                statusLabels={{ active: "Active", disabled: "Suspended" }}
              />
              <CustomersDirectory
                page={loaded.page}
                query={listQuery}
                basePath={TENANT_CUSTOMERS_PATH}
                canCreate={canCreate}
                toggleStatusAction={canSuspend ? setTenantCustomerStatusAction : undefined}
              />
            </CardContent>
          </Card>
        </section>
      </SectionedLayout>
    </ScreenFrame>
  );
}

/**
 * Description: Read the summary figures and the requested page of customers.
 * Input: The tenant area (Host-resolved database) and the list query.
 * Output: Both results, or null when the database could not be read (the
 *   technical reason is logged; the page shows a friendly message instead).
 * Use case: TenantCustomersPage.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
async function loadCustomersPage(
  area: TenantArea,
  query: CustomerListQuery,
): Promise<{ summary: CustomerSummary; page: CustomerPage } | null> {
  try {
    const summary = await getCustomerSummary(area.db);
    const page    = await listCustomers(area.db, query);
    return { summary, page };
  } catch (error) {
    console.error(`[customers] tenant ${area.tenant.id}: list could not be loaded: ${describeError(error)}`);
    return null;
  }
}
