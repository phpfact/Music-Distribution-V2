import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import { Icon, type IconName } from "../_components/icons";
import { FOCUS_RING } from "../_components/styles";
import { getNavItem, PLATFORM_NAV_ITEMS } from "../navigation";

export const metadata: Metadata = { title: getNavItem("dashboard").label };

type SummaryCard = {
  label: string;
  icon: IconName;
};

// Static copy: none of these figures is collected yet, so none is shown.
const SUMMARY_CARDS: readonly SummaryCard[] = [
  { label: "Total Tenants", icon: "building-2" },
  { label: "Active Tenants", icon: "activity" },
  { label: "Subscription Plans", icon: "credit-card" },
  { label: "Open Support Requests", icon: "life-buoy" },
];

// Every module except the page this list is on.
const QUICK_ACCESS = PLATFORM_NAV_ITEMS.filter((item) => item.id !== "dashboard");

export default async function PlatformDashboardPage() {
  // Checked on the server on every request; nothing below renders without it.
  const { owner } = await requirePlatformOwner();

  return (
    <div className="flex flex-col gap-8">
      <header className="flex min-w-0 flex-col gap-2">
        <p className="text-xs font-medium tracking-wider text-accent uppercase">Platform Owner</p>
        <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">
          Welcome back, {owner.username}
        </h1>
        <p className="text-fg-muted">Manage your platform from one central dashboard.</p>
      </header>

      <section aria-labelledby="platform-summary">
        <h2 id="platform-summary" className="sr-only">
          Platform summary
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {SUMMARY_CARDS.map((card) => (
            <div key={card.label} className="rounded-xl border border-line bg-surface p-5">
              <div className="flex items-start justify-between gap-3">
                <dt className="text-sm font-medium text-fg-muted">{card.label}</dt>
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-muted">
                  <Icon name={card.icon} className="size-5" />
                </span>
              </div>
              <dd className="mt-3">
                <span aria-hidden="true" className="text-3xl font-semibold">
                  —
                </span>
                <span className="sr-only">No data</span>
                <p className="mt-1 text-xs text-fg-subtle">Not configured yet</p>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <section aria-labelledby="quick-access" className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          <div>
            <h2 id="quick-access" className="text-base font-semibold">
              Quick access
            </h2>
            <p className="mt-1 text-sm text-fg-muted">Jump straight to any part of the platform.</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {QUICK_ACCESS.map((item) => (
              <li key={item.id} className="min-w-0">
                <Link
                  href={item.href}
                  className={`group flex h-full gap-4 rounded-xl border border-line bg-surface p-4 transition-colors hover:border-accent/40 hover:bg-surface-2 ${FOCUS_RING}`}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                    <Icon name={item.icon} className="size-5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-fg">{item.label}</span>
                      {item.status === "planned" ? (
                        <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-medium tracking-wide text-fg-subtle uppercase">
                          Coming soon
                        </span>
                      ) : null}
                    </span>
                    <span className="line-clamp-2 text-sm text-fg-muted">{item.description}</span>
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

        <section aria-labelledby="recent-activity" className="flex min-w-0 flex-col gap-4">
          <h2 id="recent-activity" className="text-base font-semibold">
            Recent activity
          </h2>
          <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-line bg-surface px-6 py-10 text-center">
            <span className="grid size-10 place-items-center rounded-lg bg-surface-2 text-fg-muted">
              <Icon name="clock" className="size-5" />
            </span>
            <p className="mt-4 font-medium">No activity yet</p>
            <p className="mt-1 max-w-xs text-sm text-fg-muted">
              Activity tracking isn&apos;t available yet. Platform events will appear here once
              it&apos;s set up.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
