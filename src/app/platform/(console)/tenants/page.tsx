import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import { parseTenantListQuery, type TenantListQuery } from "@/lib/tenants/rules";
import { listTenants, type TenantListPage, type TenantListRow } from "@/lib/tenants/service";
import { Avatar } from "../_components/avatar";
import { Icon } from "../_components/icons";
import { Notice } from "../_components/notice";
import { StatCard } from "../_components/stat-card";
import { StatusBadge } from "../_components/status-badge";
import { FOCUS_RING } from "../_components/styles";
import { buttonClass } from "../_components/ui";
import { getNavItem } from "../navigation";
import { DatabaseStateBadge, DomainStatusBadge, ExistingDatabaseTag } from "./_components/badges";
import { TenantListResults, TenantListTransition } from "./_components/list-transition";
import { TenantRowActions } from "./_components/row-actions";
import { TenantFlashNotice, TenantFlashProvider } from "./_components/tenant-flash";
import { TenantToolbar } from "./_components/tenant-toolbar";
import { formatDate } from "./format";
import { pageRowRange, tenantListHref, tenantNoticeMessage, TENANTS_PATH } from "./list-query";
import { loadTenantSummary, SUMMARY_UNAVAILABLE } from "./summary";

export const metadata: Metadata = { title: getNavItem("tenants").label };

const NEW_TENANT_PATH = `${TENANTS_PATH}/new`;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PlatformTenantsPage({ searchParams }: PageProps) {
  // Checked on the server on every request; nothing below renders without it.
  await requirePlatformOwner();
  const params = await searchParams;
  const query = parseTenantListQuery(params);
  const notice = tenantNoticeMessage(params.notice);
  const [summary, list] = await Promise.all([loadTenantSummary(), listTenants(query)]);

  return (
    <TenantFlashProvider>
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col gap-3">
            <p className="text-[11px] font-semibold tracking-[0.15em] text-accent uppercase">
              Platform management
            </p>
            <h1 className="text-3xl font-semibold tracking-tight break-words sm:text-4xl">
              Tenant Management
            </h1>
            <p className="max-w-xl text-sm leading-6 text-fg-muted">
              Create, review and manage the tenants registered on the platform.
            </p>
          </div>
          <Link href={NEW_TENANT_PATH} className={`${buttonClass("primary")} self-start sm:self-auto`}>
            <Icon name="plus" className="size-4" />
            Create tenant
          </Link>
        </header>

        {notice ? <Notice variant="success">{notice}</Notice> : null}
        <TenantFlashNotice />

        <section aria-labelledby="tenant-summary">
          <h2 id="tenant-summary" className="sr-only">
            Tenant summary
          </h2>
          {/* Real figures only: when they can't be read, each card says so. */}
          <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Total tenants"
              icon="building-2"
              value={summary?.total ?? null}
              note={summary ? "Registered on your platform" : SUMMARY_UNAVAILABLE}
            />
            <StatCard
              label="Active"
              icon="activity"
              value={summary?.active ?? null}
              note={summary ? "Accounts marked active" : SUMMARY_UNAVAILABLE}
            />
            <StatCard
              label="Suspended"
              icon="ban"
              value={summary?.suspended ?? null}
              note={summary ? "Access currently suspended" : SUMMARY_UNAVAILABLE}
            />
            <StatCard
              label="Pending setup"
              icon="clock"
              value={summary?.pendingSetup ?? null}
              note={
                !summary ? (
                  SUMMARY_UNAVAILABLE
                ) : summary.failed > 0 ? (
                  <span className="font-medium text-red-700 dark:text-red-400">
                    {summary.failed} failed
                  </span>
                ) : "Awaiting provisioning"
              }
            />
          </dl>
        </section>

        <section aria-labelledby="tenant-list" className="min-w-0 overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-6">
            <div className="flex items-center gap-3">
              <h2 id="tenant-list" className="text-base font-semibold tracking-tight">Tenant directory</h2>
              <span className="rounded-md border border-line bg-canvas px-2 py-0.5 text-xs font-medium tabular-nums text-fg-muted">{list.total}</span>
            </div>
            <p className="text-xs text-fg-subtle">{query.q || query.status !== "all" ? "Filtered results" : "All registered tenants"} · Newest first</p>
          </div>
          <TenantListTransition>
            <TenantToolbar q={query.q} status={query.status} />
            <TenantListResults>
              <TenantResults list={list} query={query} />
            </TenantListResults>
          </TenantListTransition>
        </section>
      </div>
    </TenantFlashProvider>
  );
}

// ---------------------------------------------------------------------------

function TenantResults({ list, query }: { list: TenantListPage; query: TenantListQuery }) {
  const filtered = query.q !== "" || query.status !== "all";

  if (list.total === 0) {
    return filtered ? (
      <EmptyState
        icon="search"
        title="No tenants match your search"
        text="Try another search term or status."
        action={
          <Link href={TENANTS_PATH} className={buttonClass("secondary")}>
            Clear filters
          </Link>
        }
      />
    ) : (
      <EmptyState
        icon="building-2"
        title="No tenants yet"
        text="Create the first tenant to give it its own database and subdomain."
        action={
          <Link href={NEW_TENANT_PATH} className={buttonClass("primary")}>
            <Icon name="plus" className="size-4" />
            Create tenant
          </Link>
        }
      />
    );
  }

  // A page number past the end (an old link, a hand-edited URL).
  if (list.rows.length === 0) {
    return (
      <EmptyState
        icon="search"
        title="This page is empty"
        text={`There are only ${list.pageCount} ${list.pageCount === 1 ? "page" : "pages"} of results.`}
        action={
          <Link href={tenantListHref({ ...query, page: 1 })} className={buttonClass("secondary")}>
            Go to page 1
          </Link>
        }
      />
    );
  }

  return (
    <>
      <TenantTable rows={list.rows} />
      <ul className="grid gap-4 px-5 pt-5 md:grid-cols-2 xl:hidden">
        {list.rows.map((row) => (
          <li key={row.id}>
            <TenantCard row={row} />
          </li>
        ))}
      </ul>
      <Pagination list={list} query={query} />
    </>
  );
}

function avatarSrc(row: { id: string; hasProfileImage: boolean }): string | null {
  return row.hasProfileImage ? `${TENANTS_PATH}/${row.id}/avatar` : null;
}

function TenantStatusCell({ row }: { row: TenantListRow }) {
  const reason = row.status === "suspended" ? row.statusReason : null;
  return (
    <span title={reason ?? undefined}>
      <StatusBadge status={row.status} />
      {reason ? <span className="sr-only">. Reason: {reason}</span> : null}
    </span>
  );
}

function DomainCell({ row }: { row: TenantListRow }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="break-all text-fg">{row.subdomainHost ?? "—"}</span>
      {row.customDomain ? (
        <span className="flex flex-wrap items-center gap-1.5 text-fg-muted">
          <span className="break-all">{row.customDomain.host}</span>
          {row.customDomain.status !== "active" ? (
            <DomainStatusBadge status={row.customDomain.status} compact />
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function DatabaseCell({ row }: { row: TenantListRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <DatabaseStateBadge state={row.databaseState} />
      {row.databaseMode === "existing" ? <ExistingDatabaseTag /> : null}
    </span>
  );
}

function CreatedCell({ row }: { row: TenantListRow }) {
  return (
    <time dateTime={row.createdAt} className="whitespace-nowrap">
      {formatDate(row.createdAt)}
    </time>
  );
}

const TH = "px-5 py-3.5 text-[11px] font-semibold tracking-wide";
const TD = "px-5 py-4 align-middle";

/**
 * xl and up: below that, next to the sidebar, the seven columns would only fit
 * by scrolling sideways and the row actions would sit off-screen.
 */
function TenantTable({ rows }: { rows: TenantListRow[] }) {
  return (
    <div className="hidden overflow-x-auto xl:block">
      <table className="w-full min-w-[58rem] text-left text-xs">
        <caption className="sr-only">Tenants, newest first</caption>
        <thead className="border-y border-line bg-canvas/80 text-fg-muted">
          <tr>
            <th scope="col" className={TH}>
              Tenant
            </th>
            <th scope="col" className={TH}>
              Contact
            </th>
            <th scope="col" className={TH}>
              Domain
            </th>
            <th scope="col" className={TH}>
              Database
            </th>
            <th scope="col" className={TH}>
              Status
            </th>
            <th scope="col" className={TH}>
              Created
            </th>
            <th scope="col" className={`${TH} text-right`}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.id} className="transition-colors motion-reduce:transition-none hover:bg-accent-soft/40">
              <td className={`${TD} max-w-56`}>
                <div className="flex items-center gap-3">
                  <Avatar name={row.name} src={avatarSrc(row)} size="sm" />
                  <div className="min-w-0">
                    <Link href={`${TENANTS_PATH}/${row.id}`} className={`block truncate rounded-sm text-sm font-semibold text-fg hover:text-accent ${FOCUS_RING}`}>{row.name}</Link>
                    <p className="mt-0.5 truncate text-xs text-fg-subtle">@{row.username}</p>
                  </div>
                </div>
              </td>
              <td className={`${TD} max-w-64`}>
                <p className="truncate text-fg">{row.email}</p>
                {row.phone ? <p className="mt-0.5 truncate text-fg-subtle">{row.phone}</p> : null}
              </td>
              <td className={`${TD} max-w-64`}>
                <DomainCell row={row} />
              </td>
              <td className={TD}>
                <DatabaseCell row={row} />
              </td>
              <td className={TD}>
                <TenantStatusCell row={row} />
              </td>
              <td className={`${TD} text-fg-muted`}>
                <CreatedCell row={row} />
              </td>
              <td className={`${TD} text-right`}>
                <TenantRowActions tenantId={row.id} tenantName={row.name} status={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Below xl: the same data as a table row, as a card (two per row from md). */
function TenantCard({ row }: { row: TenantListRow }) {
  return (
    <article
      aria-label={row.name}
      className="flex flex-col gap-5 rounded-xl border border-line bg-canvas/40 p-4"
    >
      <div className="flex items-start gap-3">
        <Avatar name={row.name} src={avatarSrc(row)} />
        <div className="min-w-0 flex-1">
          <Link href={`${TENANTS_PATH}/${row.id}`} className={`block truncate rounded-sm font-semibold text-fg hover:text-accent ${FOCUS_RING}`}>{row.name}</Link>
          <p className="mt-0.5 truncate text-xs text-fg-subtle">@{row.username}</p>
        </div>
        <TenantStatusCell row={row} />
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-fg-muted">Email</dt>
        <dd className="min-w-0 break-all text-fg">{row.email}</dd>
        {row.phone ? (
          <>
            <dt className="text-fg-muted">Phone</dt>
            <dd className="min-w-0 break-words text-fg">{row.phone}</dd>
          </>
        ) : null}
        <dt className="text-fg-muted">Domain</dt>
        <dd className="min-w-0">
          <DomainCell row={row} />
        </dd>
        <dt className="text-fg-muted">Database</dt>
        <dd className="min-w-0">
          <DatabaseCell row={row} />
        </dd>
        <dt className="text-fg-muted">Created</dt>
        <dd className="min-w-0 text-fg">
          <CreatedCell row={row} />
        </dd>
      </dl>
      <div className="border-t border-line pt-4">
        <TenantRowActions tenantId={row.id} tenantName={row.name} status={row.status} />
      </div>
    </article>
  );
}

function Pagination({ list, query }: { list: TenantListPage; query: TenantListQuery }) {
  const range = pageRowRange(list.page, list.pageSize, list.total);
  const previous = list.page > 1 ? tenantListHref({ ...query, page: list.page - 1 }) : null;
  const next = list.page < list.pageCount ? tenantListHref({ ...query, page: list.page + 1 }) : null;

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
    >
      <p className="text-sm text-fg-muted">
        {range ? (
          <>
            Showing <span className="font-medium text-fg tabular-nums">{range.first}</span>–
            <span className="font-medium text-fg tabular-nums">{range.last}</span> of{" "}
            <span className="font-medium text-fg tabular-nums">{list.total}</span>
          </>
        ) : null}
      </p>
      {list.pageCount > 1 ? <div className="flex items-center gap-2">
        <span className="mr-2 text-xs tabular-nums text-fg-subtle">Page {list.page} of {list.pageCount}</span>
        <PageLink href={previous} icon="chevron-left" label="Previous" />
        <PageLink href={next} icon="chevron-right" label="Next" />
      </div> : null}
    </nav>
  );
}

function PageLink({
  href,
  icon,
  label,
}: {
  href: string | null;
  icon: "chevron-left" | "chevron-right";
  label: string;
}) {
  const content =
    icon === "chevron-left" ? (
      <>
        <Icon name={icon} className="size-4" />
        {label}
      </>
    ) : (
      <>
        {label}
        <Icon name={icon} className="size-4" />
      </>
    );

  // Without an href a link is not focusable; aria-disabled says why it does nothing.
  if (href === null) {
    return (
      <a role="link" aria-disabled="true" className={buttonClass("secondary", "sm")}>
        {content}
      </a>
    );
  }
  return (
    <Link href={href} className={buttonClass("secondary", "sm")}>
      {content}
    </Link>
  );
}

function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: "search" | "building-2";
  title: string;
  text: string;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center border-t border-line px-6 py-16 text-center">
      <span className="grid size-16 place-items-center rounded-2xl border border-line bg-accent-soft text-accent">
        <Icon name={icon} className="size-7" />
      </span>
      <p className="mt-5 font-semibold">{title}</p>
      <p className="mt-2 max-w-sm text-sm leading-6 text-fg-muted">{text}</p>
      <div className="mt-6">{action}</div>
    </div>
  );
}
