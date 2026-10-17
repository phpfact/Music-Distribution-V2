import { CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import { PageHeading } from "@/components/dashboard/page-heading";
import { SectionCard, SectionCards } from "@/components/dashboard/section-cards";
import { EmptyState, NoActiveRoleNotice, SectionedLayout, type SecondaryMenuItem } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCustomerAccess } from "@/lib/authz/workspace";
import { accountTypeLabel } from "@/lib/workspace/rules";

export const metadata: Metadata = { title: "Dashboard" };

/** The page's sections (secondary-menu targets), in page order. */
const SECTIONS = {
  overview: { id: "customer-overview", label: "Overview" },
  streams:  { id: "customer-streams", label: "Streams" },
  releases: { id: "customer-releases", label: "My releases" },
} as const;
const MENU_ITEMS: readonly SecondaryMenuItem[] = Object.values(SECTIONS);

/**
 * Description: Format a date for the account cards.
 * Input: A date.
 * Output: e.g. "16 Oct 2026" (fixed locale and UTC, identical on server and client).
 * Use case: "Member since".
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function formatDay(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

/**
 * Description: Render the customer's dashboard (shadcn dashboard-01 layout).
 * Input: None (tenant from the Host header, customer from the customer area session).
 * Output: Welcome heading; a warning notice when the user has no active role;
 *   account cards (status, type, member since, workspace — facts, not counts);
 *   the streams card and the releases card as honest empty states until those
 *   modules exist. No invented figures and no privilege-gated widgets yet.
 * Use case: /customer/dashboard — the landing page after a customer signs in
 *   (available to every active customer user).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function CustomerDashboardPage() {
  const area      = await requireCustomerAccess();
  const firstName = area.user.name.split(/\s+/)[0] ?? area.user.name;

  return (
    <>
      <PageHeading
        title={`Welcome, ${firstName}`}
        description={`Your ${accountTypeLabel(area.user.customer.type).toLowerCase()} account at ${area.tenant.name}.`}
      />
      {area.authz.roleState !== "active" ? (
        <div className="px-4 lg:px-6">
          <NoActiveRoleNotice />
        </div>
      ) : null}
      <div className="px-4 lg:px-6">
        <SectionedLayout items={MENU_ITEMS} variant="top" contentClassName="flex flex-col gap-4 md:gap-6">
          <section id={SECTIONS.overview.id} aria-label="Overview">
            <SectionCards className="px-0 lg:px-0">
              <SectionCard
                label="Account status"
                value="Active"
                badge={
                  <Badge variant="success" className="gap-1">
                    <CircleCheck aria-hidden="true" />
                    Approved
                  </Badge>
                }
                footerTitle={`Approved by ${area.tenant.name}`}
                footerDescription="You have full access to your portal"
              />
              <SectionCard
                label="Account type"
                value={accountTypeLabel(area.user.customer.type)}
                footerTitle="Chosen when you signed up"
                footerDescription="Contact the workspace to change it"
              />
              <SectionCard
                label="Member since"
                value={formatDay(area.user.createdAt)}
                footerTitle="The day your account was approved"
                footerDescription="Welcome aboard"
              />
              <SectionCard
                label="Workspace"
                value={<span className="line-clamp-1 break-all">{area.tenant.name}</span>}
                footerTitle="Your distribution partner"
                footerDescription="Releases are reviewed by this workspace"
              />
            </SectionCards>
          </section>

          <section id={SECTIONS.streams.id} aria-labelledby={`${SECTIONS.streams.id}-title`}>
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2 id={`${SECTIONS.streams.id}-title`}>Streams overview</h2>
                </CardTitle>
                <CardDescription>Plays across stores and streaming services.</CardDescription>
              </CardHeader>
              <CardContent className="px-2 sm:px-6">
                <EmptyState
                  icon="activity"
                  title="No streams yet"
                  description="Your listening figures appear here once your releases are live. Nothing is estimated or invented."
                />
              </CardContent>
            </Card>
          </section>

          <section id={SECTIONS.releases.id} aria-labelledby={`${SECTIONS.releases.id}-title`}>
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2 id={`${SECTIONS.releases.id}-title`}>My releases</h2>
                </CardTitle>
                <CardDescription>Your singles, EPs and albums.</CardDescription>
                <CardAction>
                  <Badge variant="secondary">Coming soon</Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <EmptyState
                  size="sm"
                  icon="disc-3"
                  title="Release submission is coming soon"
                  description="You will be able to create releases and send them for distribution from here."
                />
              </CardContent>
            </Card>
          </section>
        </SectionedLayout>
      </div>
    </>
  );
}
