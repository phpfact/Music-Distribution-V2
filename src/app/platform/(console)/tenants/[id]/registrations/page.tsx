import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RegistrationList } from "@/components/registrations/registration-list";
import { RegistrationSummaryCards } from "@/components/registrations/registration-summary";
import { RegistrationToolbar } from "@/components/registrations/registration-toolbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import { openTenantForPlatformOwner } from "@/lib/workspace/platform-access";
import { getRegistrationSummary, listRegistrations } from "@/lib/workspace/registrations";
import { parseRegistrationListQuery } from "@/lib/workspace/rules";
import { EmptyState } from "../../../_components/empty-state";
import { Notice } from "../../../_components/notice";
import { PageHeader } from "../../../_components/page-header";
import { SectionedLayout, type SecondaryMenuItem } from "../../../_components/secondary-menu";
import { TENANTS_PATH } from "../../list-query";
import {
  approvePlatformRegistrationAction,
  loadPlatformRegistrationRecordsAction,
  reactivatePlatformCustomerAction,
  rejectPlatformRegistrationAction,
  suspendPlatformCustomerAction,
} from "./actions";

export const metadata: Metadata = { title: "Registrations" };

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** The page's sections (secondary-menu targets), in page order. */
const SECTIONS = {
  summary: { id: "tenant-registrations-summary", label: "Summary", icon: "layout-grid" },
  list:    { id: "tenant-registrations-list", label: "Registrations", icon: "user" },
} as const satisfies Record<string, SecondaryMenuItem>;
const MENU_ITEMS: readonly SecondaryMenuItem[] = Object.values(SECTIONS);

/**
 * Description: Let a Platform Owner review one tenant's customer registrations.
 * Input: The tenant id (URL) and the list's search, status and page (URL).
 * Output: Summary counts (each opens its records), the search/status toolbar
 *   and one page of registrations with Approve / Reject / Suspend / Reactivate.
 *   Unknown tenant → the tenant not-found page; unfinished setup or an
 *   unreachable database → an explanatory notice.
 * Use case: /platform/tenants/<id>/registrations (entry point: the tenant
 *   detail page's "Registrations" button).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function TenantRegistrationsPage({ params, searchParams }: PageProps) {
  // Step 1: only a signed-in Platform Owner (checked on every request).
  await requirePlatformOwner();

  // Step 2: the tenant chosen by id, if its database is set up and reachable.
  const { id } = await params;
  const access = await openTenantForPlatformOwner(id);
  if (!access.ok && access.reason === "not_found") notFound();

  const detailHref = `${TENANTS_PATH}/${id}`;
  const basePath   = `${detailHref}/registrations`;
  const header = (
    <PageHeader
      backHref={detailHref}
      backLabel={access.tenant.name}
      eyebrow="Customer registrations"
      title="Registrations"
      description="Artists, labels and partners who signed up on this tenant's portal. Nobody can log in until they are approved."
    />
  );

  if (!access.ok) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Notice variant={access.reason === "not_ready" ? "info" : "error"}>
          {access.reason === "not_ready"
            ? "Registrations are available once this tenant's setup has completed."
            : "This tenant's database cannot be reached right now. Please try again shortly."}
        </Notice>
      </div>
    );
  }

  // Step 3: the counts and the requested page, straight from the tenant's database.
  const query    = parseRegistrationListQuery(await searchParams);
  const summary  = await getRegistrationSummary(access.db);
  const page     = await listRegistrations(access.db, query);
  const tenantId = access.tenant.id;

  return (
    <div className="flex flex-col gap-6">
      {header}
      {access.tenant.status === "suspended" ? (
        <Notice variant="warning">
          This tenant is suspended: its portal is closed, so approved customers cannot log in until it is reactivated.
        </Notice>
      ) : null}

      <SectionedLayout items={MENU_ITEMS} variant="top" contentClassName="flex flex-col gap-6">
        <section id={SECTIONS.summary.id} aria-labelledby={`${SECTIONS.summary.id}-title`} className="flex flex-col gap-3">
          <h2 id={`${SECTIONS.summary.id}-title`} className="text-base font-semibold">
            Summary
          </h2>
          <RegistrationSummaryCards
            summary={summary}
            loadRecords={loadPlatformRegistrationRecordsAction.bind(null, tenantId)}
          />
        </section>

        <section id={SECTIONS.list.id} aria-labelledby={`${SECTIONS.list.id}-title`}>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 id={`${SECTIONS.list.id}-title`} className="text-base font-semibold">
                  Registrations
                </h2>
              </CardTitle>
              <CardDescription>Search, filter and review sign-up requests of {access.tenant.name}.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {summary.total === 0 && !query.q && query.status === "all" ? (
                <EmptyState
                  icon="user"
                  title="No registrations yet"
                  description="When artists, labels or partners sign up on this tenant's portal, their requests appear here."
                />
              ) : (
                <>
                  <RegistrationToolbar basePath={basePath} query={query} />
                  <RegistrationList
                    page={page}
                    query={query}
                    basePath={basePath}
                    actions={{
                      approve: approvePlatformRegistrationAction.bind(null, tenantId),
                      reject: rejectPlatformRegistrationAction.bind(null, tenantId),
                      suspend: suspendPlatformCustomerAction.bind(null, tenantId),
                      reactivate: reactivatePlatformCustomerAction.bind(null, tenantId),
                    }}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </section>
      </SectionedLayout>
    </div>
  );
}
