import type { Metadata } from "next";
import { PageHeading } from "@/components/dashboard/page-heading";
import { RegistrationList } from "@/components/registrations/registration-list";
import { RegistrationSummaryCards } from "@/components/registrations/registration-summary";
import { RegistrationToolbar } from "@/components/registrations/registration-toolbar";
import { EmptyState, SectionedLayout, type SecondaryMenuItem } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireTenantUser } from "@/lib/workspace/guards";
import { getRegistrationSummary, listRegistrations } from "@/lib/workspace/registrations";
import { parseRegistrationListQuery } from "@/lib/workspace/rules";
import { TENANT_REGISTRATIONS_PATH } from "../navigation";
import {
  approveTenantRegistrationAction,
  loadTenantRegistrationRecordsAction,
  reactivateTenantCustomerAction,
  rejectTenantRegistrationAction,
  suspendTenantCustomerAction,
} from "./actions";

export const metadata: Metadata = { title: "Registrations" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The page's sections (secondary-menu targets), in page order. */
const SECTIONS = {
  summary: { id: "registrations-summary", label: "Summary" },
  list:    { id: "registrations-list", label: "Registrations" },
} as const;
const MENU_ITEMS: readonly SecondaryMenuItem[] = Object.values(SECTIONS);

/**
 * Description: Let the tenant administrator review customer registrations.
 * Input: The URL's search, status and page (anyone can edit them).
 * Output: Summary counts (each opens its records), the search/status toolbar
 *   and one page of registrations with their review actions. Staff without
 *   the owner role see an explanation instead (checked on the server).
 * Use case: /tenant/registrations — only this tenant's database is ever read.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function TenantRegistrationsPage({ searchParams }: PageProps) {
  // Step 1: a signed-in staff user of this host; the owner role decides access.
  const area = await requireTenantUser();
  if (!area.user.isOwner) {
    return (
      <div className="px-4 lg:px-6">
        <EmptyState
          icon="shield-check"
          title="Only the administrator can review registrations"
          description="Ask your workspace administrator if you need access."
        />
      </div>
    );
  }

  // Step 2: the list query from the URL, the counts and the requested page.
  const query   = parseRegistrationListQuery(await searchParams);
  const summary = await getRegistrationSummary(area.db);
  const page    = await listRegistrations(area.db, query);

  return (
    <>
      <PageHeading
        title="Registrations"
        description="Artists, labels and partners who signed up on your portal. Nobody can log in until you approve them."
      />
      <div className="px-4 lg:px-6">
        <SectionedLayout items={MENU_ITEMS} variant="top" contentClassName="flex flex-col gap-6">
          <section id={SECTIONS.summary.id} aria-labelledby={`${SECTIONS.summary.id}-title`} className="flex flex-col gap-3">
            <h2 id={`${SECTIONS.summary.id}-title`} className="text-base font-semibold">
              Summary
            </h2>
            <RegistrationSummaryCards summary={summary} loadRecords={loadTenantRegistrationRecordsAction} />
          </section>

          <section id={SECTIONS.list.id} aria-labelledby={`${SECTIONS.list.id}-title`}>
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2 id={`${SECTIONS.list.id}-title`} className="text-base font-semibold">
                    Registrations
                  </h2>
                </CardTitle>
                <CardDescription>Search, filter and review sign-up requests.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <RegistrationToolbar basePath={TENANT_REGISTRATIONS_PATH} query={query} />
                <RegistrationList
                  page={page}
                  query={query}
                  basePath={TENANT_REGISTRATIONS_PATH}
                  actions={{
                    approve: approveTenantRegistrationAction,
                    reject: rejectTenantRegistrationAction,
                    suspend: suspendTenantCustomerAction,
                    reactivate: reactivateTenantCustomerAction,
                  }}
                />
              </CardContent>
            </Card>
          </section>
        </SectionedLayout>
      </div>
    </>
  );
}
