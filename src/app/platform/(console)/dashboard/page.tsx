import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import { Icon } from "../_components/icons";
import { StatCard } from "../_components/stat-card";
import { FOCUS_RING } from "../_components/styles";
import { buttonClass } from "../_components/ui";
import { getNavItem, PLATFORM_NAV_ITEMS } from "../navigation";
import { loadTenantSummary, SUMMARY_UNAVAILABLE } from "../tenants/summary";

export const metadata: Metadata = { title: getNavItem("dashboard").label };

// Every module except the page this list is on.
const QUICK_ACCESS = PLATFORM_NAV_ITEMS.filter((item) => item.id !== "dashboard");

export default async function PlatformDashboardPage() {
  // Checked on the server on every request; nothing below renders without it.
  const { owner } = await requirePlatformOwner();
  // The tenant figures are real; null when they could not be read.
  const summary = await loadTenantSummary();

  return (
    <div className="flex flex-col gap-9">
      <header className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="mb-3 text-[11px] font-semibold tracking-[0.15em] text-accent uppercase">Workspace overview</p>
          <h1 className="text-3xl font-semibold tracking-tight break-words sm:text-4xl">
            Welcome back, {owner.username}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-fg-muted">Here&apos;s an overview of your platform. Manage your tenants and keep everything moving from one workspace.</p>
        </div>
        <Link href={getNavItem("tenants").href} className={`${buttonClass("secondary")} self-start lg:self-auto`}>
          <Icon name="building-2" className="size-4" />
          Manage tenants
          <Icon name="arrow-right" className="size-4" />
        </Link>
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
        <section aria-labelledby="quick-access" className="min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-xs sm:p-6">
          <div className="mb-6">
            <h2 id="quick-access" className="text-base font-semibold tracking-tight">
              Quick access
            </h2>
            <p className="mt-1 text-sm text-fg-muted">Jump straight to any part of the platform.</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {QUICK_ACCESS.map((item) => (
              <li key={item.id} className="min-w-0">
                <Link
                  href={item.href}
                  className={`group flex h-full gap-3 rounded-xl border border-line bg-canvas/50 p-4 transition-colors motion-reduce:transition-none hover:border-accent/40 hover:bg-accent-soft ${FOCUS_RING}`}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-surface text-accent shadow-xs">
                    <Icon name={item.icon} className="size-[18px]" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-fg">{item.label}</span>
                      {item.status === "planned" ? (
                        <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[9px] font-medium text-fg-subtle">
                          Coming soon
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs leading-5 text-fg-muted">{item.description}</span>
                  </span>
                  <Icon
                    name="arrow-right"
                    className="size-4 shrink-0 self-center text-fg-subtle motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="recent-activity" className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-5 shadow-xs sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 id="recent-activity" className="text-base font-semibold tracking-tight">Recent activity</h2>
            <span className="rounded-md bg-surface-2 px-2 py-1 text-[10px] font-medium text-fg-subtle">Coming soon</span>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center px-2 py-12 text-center">
            <span className="relative grid size-16 place-items-center rounded-2xl border border-line bg-canvas text-fg-muted">
              <Icon name="clock" className="size-7" />
              <span aria-hidden="true" className="absolute -right-1.5 -bottom-1.5 grid size-6 place-items-center rounded-full border-4 border-surface bg-accent-soft text-accent"><Icon name="plus" className="size-3" /></span>
            </span>
            <p className="mt-5 text-sm font-semibold">No activity yet</p>
            <p className="mt-2 max-w-xs text-xs leading-6 text-fg-muted">
              Activity tracking isn&apos;t available yet. Platform events will appear here once
              it&apos;s set up.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
