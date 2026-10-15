import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import { Icon } from "../_components/icons";
import { StatCard } from "../_components/stat-card";
import { getNavItem, PLATFORM_NAV_ITEMS } from "../navigation";
import { loadTenantSummary, SUMMARY_UNAVAILABLE } from "../tenants/summary";

export const metadata: Metadata = { title: getNavItem("dashboard").label };

// Every module except the page this list is on.
const QUICK_ACCESS = PLATFORM_NAV_ITEMS.filter((item) => item.id !== "dashboard");

/**
 * Show authenticated platform totals and navigation through shared UI components.
 * Input: the request's authenticated owner and the existing tenant summary.
 * Output: responsive statistic, quick-access and planned-activity Cards.
 * Use case: migrate presentation while preserving real data and module availability.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export default async function PlatformDashboardPage() {
  // Checked on the server on every request; nothing below renders without it.
  const { owner } = await requirePlatformOwner();
  // The tenant figures are real; null when they could not be read.
  const summary = await loadTenantSummary();

  return (
    <div className="flex flex-col gap-9">
      <header className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="mb-3 text-[11px] font-semibold tracking-[0.15em] text-primary uppercase">Workspace overview</p>
          <h1 className="text-3xl font-semibold tracking-tight break-words sm:text-4xl">
            Welcome back, {owner.username}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-fg-muted">Here&apos;s an overview of your platform. Manage your tenants and keep everything moving from one workspace.</p>
        </div>
        <Button asChild variant="outline" className="self-start lg:self-auto">
          <Link href={getNavItem("tenants").href}>
            <Icon name="building-2" className="size-4" />
            Manage tenants
            <Icon name="arrow-right" className="size-4" />
          </Link>
        </Button>
      </header>

      <section aria-labelledby="platform-summary">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="platform-summary" className="text-sm font-semibold">Platform at a glance</h2>
          <span className="text-xs text-fg-subtle">Tenant overview</span>
        </div>
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Total Tenants"
            icon="building-2"
            value={summary?.total ?? null}
            note={summary ? "Registered on your platform" : SUMMARY_UNAVAILABLE}
          />
          <StatCard
            label="Active Tenants"
            icon="activity"
            value={summary?.active ?? null}
            note={summary ? "Accounts marked active" : SUMMARY_UNAVAILABLE}
          />
          {/* Not collected yet, so no figure is shown. */}
          <StatCard label="Subscription Plans" icon="credit-card" value={null} note="Not configured yet" />
          <StatCard label="Open Support Requests" icon="life-buoy" value={null} note="Not configured yet" />
        </dl>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <Card role="region" aria-labelledby="quick-access" className="min-w-0">
          <CardHeader>
            <CardTitle><h2 id="quick-access" className="text-base font-semibold tracking-tight">Quick access</h2></CardTitle>
            <CardDescription>Jump straight to any part of the platform.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3 sm:grid-cols-2">
              {QUICK_ACCESS.map((item) => (
                <li key={item.id} className="min-w-0">
                  <Button asChild variant="outline" className="group h-full w-full items-start justify-start gap-3 rounded-xl bg-background/50 p-4 text-left whitespace-normal hover:border-primary/40 hover:bg-accent-soft">
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

        <Card role="region" aria-labelledby="recent-activity" className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle><h2 id="recent-activity" className="text-base font-semibold tracking-tight">Recent activity</h2></CardTitle>
            <Badge variant="secondary" className="text-[10px]">Coming soon</Badge>
          </CardHeader>
          <CardContent className="flex flex-1">
            <Empty className="px-2 py-10">
              <EmptyHeader>
                <EmptyMedia className="relative size-16 rounded-2xl border border-border bg-background text-muted-foreground">
                  <Icon name="clock" className="size-7" />
                  <span aria-hidden="true" className="absolute -right-1.5 -bottom-1.5 grid size-6 place-items-center rounded-full border-4 border-card bg-accent-soft text-primary"><Icon name="plus" className="size-3" /></span>
                </EmptyMedia>
                <EmptyTitle className="text-sm font-semibold">No activity yet</EmptyTitle>
                <EmptyDescription className="max-w-xs text-xs leading-6">
                  Activity tracking isn&apos;t available yet. Platform events will appear here once
                  it&apos;s set up.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
