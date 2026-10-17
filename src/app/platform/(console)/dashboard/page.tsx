import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NoActiveRoleNotice } from "@/components/shared";
import { requirePlatformAccess } from "@/lib/authz/platform";
import { EmptyState } from "../_components/empty-state";
import { Icon } from "../_components/icons";
import { SectionedLayout, type SecondaryMenuItem } from "../_components/secondary-menu";
import { StatCard } from "../_components/stat-card";
import { filterNavSections, getNavItem } from "../navigation";
import { tenantSummaryDetails } from "../tenants/_components/count-details-content";
import { loadTenantSummary, SUMMARY_UNAVAILABLE } from "../tenants/summary";

export const metadata: Metadata = { title: getNavItem("dashboard").label };

// The page's sections, in page order, for the secondary menu (top bar).
const SECTION_IDS = {
  summary:  "dashboard-summary-section",
  quick:    "dashboard-quick-access-section",
  activity: "dashboard-activity-section",
} as const;
const MENU_ITEMS: readonly SecondaryMenuItem[] = [
  { id: SECTION_IDS.summary, label: "Platform at a glance", icon: "activity" },
  { id: SECTION_IDS.quick, label: "Quick access", icon: "layout-grid" },
  { id: SECTION_IDS.activity, label: "Recent activity", icon: "clock" },
];

/**
 * Description: Show the platform dashboard: summary figures, quick access and activity.
 * Input: None (the signed-in owner and their CURRENT privileges are checked on
 *   the server; the tenant summary is read from the database only with
 *   platform.tenants.view).
 * Output: The protected dashboard with a secondary menu, a warning notice when
 *   the owner has no active role, clickable tenant figures and the "Manage
 *   tenants" button (platform.tenants.view only), module shortcuts filtered
 *   like the sidebar, and the activity card.
 * Use case: /platform/dashboard — the owner's starting page after sign-in
 *   (available to every signed-in owner; widgets follow the privileges).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
export default async function PlatformDashboardPage() {
  // Checked on the server on every request: session and CURRENT privileges.
  const { access } = await requirePlatformAccess();
  const canSeeTenants = access.can("platform.tenants.view");
  // The tenant figures are real; null when they could not be read (never read without the privilege).
  const summary = canSeeTenants ? await loadTenantSummary() : null;
  // Every module the owner may open, except the page this list is on (same rules as the sidebar).
  const quickAccess = filterNavSections(access.permissions)
    .flatMap((section) => section.items)
    .filter((item) => item.id !== "dashboard");
  // The menu follows the sections that are actually shown.
  const menuItems = canSeeTenants ? MENU_ITEMS : MENU_ITEMS.filter((item) => item.id !== SECTION_IDS.summary);

  return (
    <div className="flex flex-col gap-9">
      <header className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="mb-3 text-[11px] font-semibold tracking-[0.15em] text-primary uppercase">Workspace overview</p>
          {/* No username here: it is sensitive and the account menu reveals it on request. */}
          <h1 className="text-3xl font-semibold tracking-tight break-words sm:text-4xl">Welcome back</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-fg-muted">
            Here&apos;s an overview of your platform. Manage your tenants and keep everything moving from one workspace.
          </p>
        </div>
        {canSeeTenants ? (
          <Button asChild variant="outline" className="self-start lg:self-auto">
            <Link href={getNavItem("tenants").href}>
              <Icon name="building-2" className="size-4" />
              Manage tenants
              <Icon name="arrow-right" className="size-4" />
            </Link>
          </Button>
        ) : null}
      </header>

      {access.roleState !== "active" ? <NoActiveRoleNotice /> : null}

      <SectionedLayout items={menuItems} variant="top" contentClassName="flex flex-col gap-9">
        {/* Gated widgets: the tenant figures need platform.tenants.view. */}
        {canSeeTenants ? (
          <section id={SECTION_IDS.summary} aria-labelledby="platform-summary">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id="platform-summary" className="text-sm font-semibold">Platform at a glance</h2>
              <span className="text-xs text-fg-subtle">Tenant overview</span>
            </div>
            <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {/* Each tenant figure opens the exact tenants it counts. */}
              <StatCard
                label="Total Tenants"
                icon="building-2"
                value={summary?.total ?? null}
                note={summary ? "Registered on your platform" : SUMMARY_UNAVAILABLE}
                details={summary ? tenantSummaryDetails("all", summary) : undefined}
              />
              <StatCard
                label="Active Tenants"
                icon="activity"
                value={summary?.active ?? null}
                note={summary ? "Accounts marked active" : SUMMARY_UNAVAILABLE}
                details={summary ? tenantSummaryDetails("active", summary) : undefined}
              />
              {/* Not collected yet, so no figure (and nothing to open) is shown. */}
              <StatCard label="Subscription Plans" icon="credit-card" value={null} note="Not configured yet" />
              <StatCard label="Open Support Requests" icon="life-buoy" value={null} note="Not configured yet" />
            </dl>
          </section>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
          <Card id={SECTION_IDS.quick} role="region" aria-labelledby="quick-access" className="min-w-0">
            <CardHeader>
              <CardTitle>
                <h2 id="quick-access" className="text-base font-semibold tracking-tight">Quick access</h2>
              </CardTitle>
              <CardDescription>Jump straight to any part of the platform.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-3 sm:grid-cols-2">
                {quickAccess.map((item) => (
                  <li key={item.id} className="min-w-0">
                    <Button
                      asChild
                      variant="outline"
                      className="group h-full w-full items-start justify-start gap-3 rounded-xl bg-background/50 p-4 text-left whitespace-normal hover:border-primary/40 hover:bg-accent-soft"
                    >
                      <Link href={item.href}>
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-surface text-primary shadow-xs">
                          <Icon name={item.icon} className="size-[18px]" />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-fg">{item.label}</span>
                            {item.status === "planned" ? (
                              <Badge variant="secondary" className="text-[9px]">
                                Coming soon
                              </Badge>
                            ) : null}
                          </span>
                          <span className="text-xs leading-5 text-fg-muted">{item.description}</span>
                        </span>
                        <Icon
                          name="arrow-right"
                          className="size-4 shrink-0 self-center text-fg-subtle motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
                        />
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card id={SECTION_IDS.activity} role="region" aria-labelledby="recent-activity" className="min-w-0">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle>
                <h2 id="recent-activity" className="text-base font-semibold tracking-tight">Recent activity</h2>
              </CardTitle>
              <Badge variant="secondary" className="text-[10px]">Coming soon</Badge>
            </CardHeader>
            <CardContent className="flex flex-1">
              {/* The shared empty state: illustration, heading, description; no action exists yet. */}
              <EmptyState
                size="sm"
                icon="clock"
                title="No activity yet"
                description="Activity tracking isn't available yet. Platform events will appear here once it's set up."
              />
            </CardContent>
          </Card>
        </div>
      </SectionedLayout>
    </div>
  );
}
