import { ArrowRight, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading } from "@/components/dashboard/page-heading";
import { SectionCard, SectionCards } from "@/components/dashboard/section-cards";
import { formatRegistrationDate } from "@/components/registrations/format";
import { RegistrationRecords } from "@/components/registrations/registration-records";
import { RegistrationStatusBadge } from "@/components/registrations/registration-status-badge";
import { CountDetails, EmptyState, SectionedLayout, type SecondaryMenuItem } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireTenantUser } from "@/lib/workspace/guards";
import { getRegistrationSummary, listRecentRegistrations } from "@/lib/workspace/registrations";
import { accountTypeLabel, type RegistrationRow, type RegistrationSummary } from "@/lib/workspace/rules";
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
 * Description: Render the tenant administrator's dashboard (shadcn dashboard-01 layout).
 * Input: None (tenant from the Host header, user from the tenant area session).
 * Output: Welcome heading; four summary cards (real registration counts with
 *   details popups for the owner, honest "coming soon" cards for unbuilt
 *   modules); the activity card (empty until analytics exist); the recent
 *   registrations table (owner only). No invented figures.
 * Use case: /tenant/dashboard — the landing page after a tenant staff sign-in.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function TenantDashboardPage() {
  // Step 1: the signed-in staff user of this host (redirects to /login otherwise).
  const area = await requireTenantUser();

  // Step 2: real registration data, only for the administrator.
  const summary = area.user.isOwner ? await getRegistrationSummary(area.db) : null;
  const recent  = area.user.isOwner ? await listRecentRegistrations(area.db, 5) : [];

  // The menu follows the sections that are actually shown.
  const menuItems: SecondaryMenuItem[] = [SECTIONS.overview, SECTIONS.activity];
  if (area.user.isOwner) menuItems.push(SECTIONS.recent);

  return (
    <>
      <PageHeading
        title={`Welcome back, ${area.user.name}`}
        description={`Here is what is happening at ${area.tenant.name}.`}
      />
      <div className="px-4 lg:px-6">
        <SectionedLayout items={menuItems} variant="top" contentClassName="flex flex-col gap-4 md:gap-6">
          <section id={SECTIONS.overview.id} aria-label="Overview">
            <OverviewCards summary={summary} />
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

          {area.user.isOwner ? (
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
 * Description: Render the four summary cards of the dashboard.
 * Input: The registration counts (null for staff without the owner role).
 * Output: Pending approvals and Active customers (clickable real counts for the
 *   owner) and the Releases and Royalties cards, which say the modules are not
 *   available yet instead of showing numbers.
 * Use case: TenantDashboardPage.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function OverviewCards({ summary }: { summary: RegistrationSummary | null }) {
  return (
    <SectionCards className="px-0 lg:px-0">
      <SectionCard
        label="Pending approvals"
        value={summary ? <FigureDetails summary={summary} kind="pending" /> : "—"}
        badge={
          summary && summary.pending > 0 ? (
            <Badge variant="outline" className="gap-1">
              <Clock aria-hidden="true" />
              Needs review
            </Badge>
          ) : undefined
        }
        footerTitle={summary ? "Sign-ups waiting for your decision" : "Visible to the administrator"}
        footerDescription={summary ? "Approve or reject them on the Registrations page" : "Registrations are reviewed by the owner"}
      />
      <SectionCard
        label="Active customers"
        value={summary ? <FigureDetails summary={summary} kind="active" /> : "—"}
        footerTitle={summary ? "Approved accounts that can log in" : "Visible to the administrator"}
        footerDescription="Artists, labels and white-label partners"
      />
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
 * Description: Make a registration figure open its exact records (CLAUDE.md count transparency).
 * Input: The counts and which figure (pending or active).
 * Output: The figure as a button opening the details popup with the calculation and the records.
 * Use case: OverviewCards.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function FigureDetails({ summary, kind }: { summary: RegistrationSummary; kind: "pending" | "active" }) {
  const value   = summary[kind];
  const title   = kind === "pending" ? "Pending approvals" : "Active customers";
  const formula =
    kind === "pending"
      ? "Registrations whose status is Pending, including those whose applicant asked for a new review."
      : "Approved registrations whose customer account is active.";

  return (
    <CountDetails
      label={`${title}: ${value}. Show the registrations behind this figure.`}
      title={title}
      calculation={`${formula} Currently ${value}.`}
      records={<RegistrationRecords filter={kind} caption={title} loadRecords={loadTenantRegistrationRecordsAction} />}
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
 * Use case: TenantDashboardPage (owner only).
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
