import { ArrowRight, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CustomerRecords } from "@/components/customers/customer-records";
import { PageHeading } from "@/components/dashboard/page-heading";
import { SectionCard, SectionCards } from "@/components/dashboard/section-cards";
import { formatRegistrationDate } from "@/components/registrations/format";
import { RegistrationRecords } from "@/components/registrations/registration-records";
import { RegistrationStatusBadge } from "@/components/registrations/registration-status-badge";
import { CountDetails, EmptyState, NoActiveRoleNotice, SectionedLayout, type SecondaryMenuItem } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireTenantAccess } from "@/lib/authz/workspace";
import type { CustomerSummary } from "@/lib/workspace/customer-rules";
import { getCustomerSummary } from "@/lib/workspace/customers";
import { getRegistrationSummary, listRecentRegistrations } from "@/lib/workspace/registrations";
import { accountTypeLabel, type RegistrationRow, type RegistrationSummary } from "@/lib/workspace/rules";
import { loadTenantCustomerRecordsAction } from "../customers/actions";
import { TENANT_REGISTRATIONS_PATH } from "../navigation";
import { loadTenantRegistrationRecordsAction } from "../registrations/actions";

export const metadata: Metadata = { title: "Dashboard" };

/** The page's sections (secondary-menu targets), in page order. */
const SECTIONS = {
  overview: { id: "dashboard-overview", label: "Overview" },
  activity: { id: "dashboard-activity", label: "Activity" },
  recent:   { id: "dashboard-recent-registrations", label: "Recent registrations" },
} as const;

/**
 * Description: Render the tenant staff dashboard (shadcn dashboard-01 layout).
 * Input: None (tenant from the Host header, user and privileges from the tenant
 *   area session).
 * Output: Welcome heading; a warning notice when the user has no active role;
 *   summary cards (real counts with details popups: Pending approvals with
 *   tenant.registrations.view, Active customers with tenant.customers.view;
 *   honest "coming soon" cards for unbuilt modules); the activity card (empty
 *   until analytics exist); the recent registrations table
 *   (tenant.registrations.view only). No invented figures.
 * Use case: /tenant/dashboard — the landing page after a tenant staff sign-in
 *   (available to every active staff user; widgets are filtered by privilege).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-17
 */
export default async function TenantDashboardPage() {
  // Step 1: the signed-in staff user of this host (redirects to /login otherwise).
  const area = await requireTenantAccess();

  // Step 2: real registration data, only with the registrations privilege.
  const canSeeRegistrations = area.authz.can("tenant.registrations.view");
  const summary             = canSeeRegistrations ? await getRegistrationSummary(area.db) : null;
  const recent              = canSeeRegistrations ? await listRecentRegistrations(area.db, 5) : [];

  // Step 2b: the customers figure (every active main customer), only with the customers privilege.
  const canSeeCustomers = area.authz.can("tenant.customers.view");
  const customers       = canSeeCustomers ? await getCustomerSummary(area.db) : null;

  // The menu follows the sections that are actually shown.
  const menuItems: SecondaryMenuItem[] = [SECTIONS.overview, SECTIONS.activity];
  if (canSeeRegistrations) menuItems.push(SECTIONS.recent);

  return (
    <>
      <PageHeading
        title={`Welcome back, ${area.user.name}`}
        description={`Here is what is happening at ${area.tenant.name}.`}
      />
      {area.authz.roleState !== "active" ? (
        <div className="px-4 lg:px-6">
          <NoActiveRoleNotice />
        </div>
      ) : null}
      <div className="px-4 lg:px-6">
        <SectionedLayout items={menuItems} variant="top" contentClassName="flex flex-col gap-4 md:gap-6">
          <section id={SECTIONS.overview.id} aria-label="Overview">
            <OverviewCards summary={summary} customers={customers} />
          </section>

          <section id={SECTIONS.activity.id} aria-labelledby={`${SECTIONS.activity.id}-title`}>
            <Card className="@container/card">
              <CardHeader>
                <CardTitle>
                  <h2 id={`${SECTIONS.activity.id}-title`}>Distribution activity</h2>
                </CardTitle>
                <CardDescription>Streams and store deliveries over time.</CardDescription>
              </CardHeader>
              <CardContent className="px-2 sm:px-6">
                <EmptyState
                  icon="activity"
                  title="No activity yet"
                  description="Charts appear here once releases are delivered and stores start reporting. Nothing is estimated or invented."
                />
              </CardContent>
            </Card>
          </section>

          {canSeeRegistrations ? (
            <section id={SECTIONS.recent.id} aria-labelledby={`${SECTIONS.recent.id}-title`}>
              <RecentRegistrations rows={recent} />
            </section>
          ) : null}
        </SectionedLayout>
      </div>
    </>
  );
}

/**
 * Description: Render the summary cards of the dashboard.
 * Input: The registration counts (null without tenant.registrations.view) and
 *   the customer counts (null without tenant.customers.view).
 * Output: Pending approvals (registrations) and Active customers (every active
 *   main customer: sign-ups and customers added by the tenant) as clickable
 *   real counts, each only when its counts were loaded (i.e. with its
 *   privilege), and the Releases and Royalties cards, which say the modules
 *   are not available yet instead of showing numbers.
 * Use case: TenantDashboardPage.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-17
 */
function OverviewCards({ summary, customers }: { summary: RegistrationSummary | null; customers: CustomerSummary | null }) {
  return (
    <SectionCards className="px-0 lg:px-0">
      {/* Gated widgets: each is hidden entirely without its privilege. */}
      {summary ? (
        <SectionCard
          label="Pending approvals"
          value={<PendingApprovalsFigure summary={summary} />}
          badge={
            summary.pending > 0 ? (
              <Badge variant="outline" className="gap-1">
                <Clock aria-hidden="true" />
                Needs review
              </Badge>
            ) : undefined
          }
          footerTitle="Sign-ups waiting for your decision"
          footerDescription="Approve or reject them on the Registrations page"
        />
      ) : null}
      {customers ? (
        <SectionCard
          label="Active customers"
          value={<ActiveCustomersFigure customers={customers} />}
          footerTitle="Customer accounts that can log in"
          footerDescription="Approved sign-ups and customers you added"
        />
      ) : null}
      <SectionCard
        label="Releases"
        value="—"
        badge={<Badge variant="secondary">Coming soon</Badge>}
        footerTitle="Release management is not available yet"
        footerDescription="Figures appear once the module is live"
      />
      <SectionCard
        label="Royalties"
        value="—"
        badge={<Badge variant="secondary">Coming soon</Badge>}
        footerTitle="Royalty reporting is not available yet"
        footerDescription="Nothing is estimated or invented"
      />
    </SectionCards>
  );
}

/**
 * Description: Make the pending-approvals figure open its exact registrations (CLAUDE.md count transparency).
 * Input: The registration counts.
 * Output: The figure as a button opening the details popup with the calculation and the records.
 * Use case: OverviewCards (tenant.registrations.view).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-17
 */
function PendingApprovalsFigure({ summary }: { summary: RegistrationSummary }) {
  const value = summary.pending;
  const title = "Pending approvals";

  return (
    <CountDetails
      label={`${title}: ${value}. Show the registrations behind this figure.`}
      title={title}
      calculation={`Registrations whose status is Pending, including those whose applicant asked for a new review. Currently ${value}.`}
      records={<RegistrationRecords filter="pending" caption={title} loadRecords={loadTenantRegistrationRecordsAction} />}
      className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl"
    >
      {value}
    </CountDetails>
  );
}

/**
 * Description: Make the active-customers figure open its exact customers (CLAUDE.md count transparency).
 * Input: The customer counts.
 * Output: The figure as a button opening the details popup with the calculation
 *   and the active main customers (sign-ups and customers added by the tenant).
 * Use case: OverviewCards (tenant.customers.view; .vibe/memory/customer-management.md).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
function ActiveCustomersFigure({ customers }: { customers: CustomerSummary }) {
  const value = customers.active;
  const title = "Active customers";

  return (
    <CountDetails
      label={`${title}: ${value}. Show the customers behind this figure.`}
      title={title}
      calculation={`Main customers whose status is Active — approved sign-ups and customers you added (sub-customers are not counted). Currently ${value}.`}
      records={<CustomerRecords filter="active" caption={title} loadRecords={loadTenantCustomerRecordsAction} />}
      className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl"
    >
      {value}
    </CountDetails>
  );
}

/**
 * Description: Render the newest registrations (dashboard-01's table card).
 * Input: Up to five newest registrations.
 * Output: A table (applicant, type, submitted, status) with "View all", or an
 *   empty state when nobody has signed up yet.
 * Use case: TenantDashboardPage (tenant.registrations.view only).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function RecentRegistrations({ rows }: { rows: RegistrationRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 id={`${SECTIONS.recent.id}-title`}>Recent registrations</h2>
        </CardTitle>
        <CardDescription>The newest sign-up requests on your portal.</CardDescription>
        <CardAction>
          <Button asChild variant="outline" size="sm">
            <Link href={TENANT_REGISTRATIONS_PATH}>
              View all
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            size="sm"
            icon="user"
            title="No registrations yet"
            description="When artists, labels or partners sign up on your portal, they appear here."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableCaption className="sr-only">Recent registrations</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Applicant</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.fullName}</TableCell>
                    <TableCell>{accountTypeLabel(row.accountType)}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatRegistrationDate(row.createdAt)}</TableCell>
                    <TableCell>
                      <RegistrationStatusBadge status={row.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
