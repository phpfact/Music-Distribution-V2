import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Pagination as PaginationRoot,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import {
  parseTenantListQuery,
  type TenantListQuery,
} from "@/lib/tenants/rules";
import {
  listTenants,
  type TenantListPage,
  type TenantListRow,
} from "@/lib/tenants/service";
import { Avatar } from "../_components/avatar";
import { Icon } from "../_components/icons";
import { Notice } from "../_components/notice";
import { StatCard } from "../_components/stat-card";
import { StatusBadge } from "../_components/status-badge";
import { FOCUS_RING } from "../_components/styles";
import { getNavItem } from "../navigation";
import {
  DatabaseStateBadge,
  DomainStatusBadge,
  ExistingDatabaseTag,
} from "./_components/badges";
import {
  TenantListResults,
  TenantListTransition,
} from "./_components/list-transition";
import { TenantRowActions } from "./_components/row-actions";
import {
  TenantFlashNotice,
  TenantFlashProvider,
} from "./_components/tenant-flash";
import { TenantToolbar } from "./_components/tenant-toolbar";
import { formatDate } from "./format";
import {
  pageRowRange,
  tenantListHref,
  tenantNoticeMessage,
  TENANTS_PATH,
} from "./list-query";
import { loadTenantSummary, SUMMARY_UNAVAILABLE } from "./summary";

export const metadata: Metadata = { title: getNavItem("tenants").label };

const NEW_TENANT_PATH = `${TENANTS_PATH}/new`;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Description: Load the authenticated tenant directory, summary and URL-selected results.
 * Input: The existing typed arguments and component state.
 * Output: Accessible React UI.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
export default async function PlatformTenantsPage({ searchParams }: PageProps) {
  // Checked on the server on every request; nothing below renders without it.
  await requirePlatformOwner();
  const params = await searchParams;
  const query = parseTenantListQuery(params);
  const notice = tenantNoticeMessage(params.notice);
  const [summary, list] = await Promise.all([
    loadTenantSummary(),
    listTenants(query),
  ]);

  return (
    <TenantFlashProvider>
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col gap-3">
            <p className="text-[11px] font-semibold tracking-[0.15em] text-primary uppercase">
              Platform management
            </p>
            <h1 className="text-3xl font-semibold tracking-tight break-words sm:text-4xl">
              Tenant Management
            </h1>
            <p className="max-w-xl text-sm leading-6 text-fg-muted">
              Create, review and manage the tenants registered on the platform.
            </p>
          </div>
          <Button asChild variant="default" className="self-start sm:self-auto">
            <Link href={NEW_TENANT_PATH}>
              <Icon name="plus" className="size-4" />
              Create tenant
            </Link>
          </Button>
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
              note={
                summary ? "Registered on your platform" : SUMMARY_UNAVAILABLE
              }
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
              note={
                summary ? "Access currently suspended" : SUMMARY_UNAVAILABLE
              }
            />
            <StatCard
              label="Pending setup"
              icon="clock"
              value={summary?.pendingSetup ?? null}
              note={
                !summary ? (
                  SUMMARY_UNAVAILABLE
                ) : summary.failed > 0 ? (
                  <span className="font-medium text-destructive">
                    {summary.failed} failed
                  </span>
                ) : (
                  "Awaiting provisioning"
                )
              }
            />
          </dl>
        </section>

        <Card
          role="region"
          aria-labelledby="tenant-list"
          className="min-w-0 gap-0 overflow-hidden py-0"
        >
          <CardHeader className="flex flex-wrap items-center justify-between gap-3 py-5">
            <div className="flex items-center gap-3">
              <CardTitle
                id="tenant-list"
                role="heading"
                aria-level={2}
                className="text-base"
              >
                Tenant directory
              </CardTitle>
              <Badge variant="outline" className="tabular-nums">
                {list.total}
              </Badge>
            </div>
            <p className="text-xs text-fg-subtle">
              {query.q || query.status !== "all"
                ? "Filtered results"
                : "All registered tenants"}{" "}
              · Newest first
            </p>
          </CardHeader>
          <TenantListTransition>
            <TenantToolbar q={query.q} status={query.status} />
            <TenantListResults>
              <TenantResults list={list} query={query} />
            </TenantListResults>
          </TenantListTransition>
        </Card>
      </div>
    </TenantFlashProvider>
  );
}

// ---------------------------------------------------------------------------

/**
 * Description: Render tenant rows, responsive cards or the appropriate actionable empty state.
 * Input: The existing typed arguments and component state.
 * Output: Accessible React UI.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
function TenantResults({
  list,
  query,
}: {
  list: TenantListPage;
  query: TenantListQuery;
}) {
  const filtered = query.q !== "" || query.status !== "all";

  if (list.total === 0) {
    return filtered ? (
      <EmptyState
        icon="search"
        title="No tenants match your search"
        text="Try another search term or status."
        action={
          <Button asChild variant="outline">
            <Link href={TENANTS_PATH}>Clear filters</Link>
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon="building-2"
        title="No tenants yet"
        text="Create the first tenant to give it its own database and subdomain."
        action={
          <Button asChild variant="default">
            <Link href={NEW_TENANT_PATH}>
              <Icon name="plus" className="size-4" />
              Create tenant
            </Link>
          </Button>
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
          <Button asChild variant="outline">
            <Link href={tenantListHref({ ...query, page: 1 })}>
              Go to page 1
            </Link>
          </Button>
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

/**
 * Description: Build the protected avatar URL only when the tenant has a stored profile image.
 * Input: The existing typed arguments and component state.
 * Output: The existing helper result or state update.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
function avatarSrc(row: {
  id: string;
  hasProfileImage: boolean;
}): string | null {
  return row.hasProfileImage ? `${TENANTS_PATH}/${row.id}/avatar` : null;
}

/**
 * Description: Render the lifecycle status and accessible suspension reason.
 * Input: The existing typed arguments and component state.
 * Output: Accessible React UI.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
function TenantStatusCell({ row }: { row: TenantListRow }) {
  const reason = row.status === "suspended" ? row.statusReason : null;
  return (
    <span title={reason ?? undefined}>
      <StatusBadge status={row.status} />
      {reason ? <span className="sr-only">. Reason: {reason}</span> : null}
    </span>
  );
}

/**
 * Description: Render SaaS and custom domain information with verification status.
 * Input: The existing typed arguments and component state.
 * Output: Accessible React UI.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
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

/**
 * Description: Render database provisioning state and existing-database mode.
 * Input: The existing typed arguments and component state.
 * Output: Accessible React UI.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
function DatabaseCell({ row }: { row: TenantListRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <DatabaseStateBadge state={row.databaseState} />
      {row.databaseMode === "existing" ? <ExistingDatabaseTag /> : null}
    </span>
  );
}

/**
 * Description: Render an ISO-backed human-readable creation date.
 * Input: The existing typed arguments and component state.
 * Output: Accessible React UI.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
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
 *
 * Input: The existing typed arguments and component state.
 * Output: Accessible React UI.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
function TenantTable({ rows }: { rows: TenantListRow[] }) {
  return (
    <div className="hidden overflow-x-auto xl:block">
      <Table className="w-full min-w-[58rem] text-left text-xs">
        <TableCaption className="sr-only">Tenants, newest first</TableCaption>
        <TableHeader className="border-y border-line bg-canvas/80 text-fg-muted">
          <TableRow>
            <TableHead scope="col" className={TH}>
              Tenant
            </TableHead>
            <TableHead scope="col" className={TH}>
              Contact
            </TableHead>
            <TableHead scope="col" className={TH}>
              Domain
            </TableHead>
            <TableHead scope="col" className={TH}>
              Database
            </TableHead>
            <TableHead scope="col" className={TH}>
              Status
            </TableHead>
            <TableHead scope="col" className={TH}>
              Created
            </TableHead>
            <TableHead scope="col" className={`${TH} text-right`}>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="divide-y divide-line">
          {rows.map((row) => (
            <TableRow
              key={row.id}
              className="transition-colors motion-reduce:transition-none hover:bg-primary/5"
            >
              <TableCell className={`${TD} max-w-56`}>
                <div className="flex items-center gap-3">
                  <Avatar name={row.name} src={avatarSrc(row)} size="sm" />
                  <div className="min-w-0">
                    <Link
                      href={`${TENANTS_PATH}/${row.id}`}
                      className={`block truncate rounded-sm text-sm font-semibold text-fg hover:text-primary ${FOCUS_RING}`}
                    >
                      {row.name}
                    </Link>
                    <p className="mt-0.5 truncate text-xs text-fg-subtle">
                      @{row.username}
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell className={`${TD} max-w-64`}>
                <p className="truncate text-fg">{row.email}</p>
                {row.phone ? (
                  <p className="mt-0.5 truncate text-fg-subtle">{row.phone}</p>
                ) : null}
              </TableCell>
              <TableCell className={`${TD} max-w-64`}>
                <DomainCell row={row} />
              </TableCell>
              <TableCell className={TD}>
                <DatabaseCell row={row} />
              </TableCell>
              <TableCell className={TD}>
                <TenantStatusCell row={row} />
              </TableCell>
              <TableCell className={`${TD} text-fg-muted`}>
                <CreatedCell row={row} />
              </TableCell>
              <TableCell className={`${TD} text-right`}>
                <TenantRowActions
                  tenantId={row.id}
                  tenantName={row.name}
                  status={row.status}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Below xl: the same data as a table row, as a card (two per row from md).
 * Input: The existing typed arguments and component state.
 * Output: Accessible React UI.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
function TenantCard({ row }: { row: TenantListRow }) {
  return (
    <Card
      role="article"
      aria-label={row.name}
      className="gap-0 bg-background/40 py-0"
    >
      <CardContent className="flex flex-col gap-5 p-4">
        <div className="flex items-start gap-3">
          <Avatar name={row.name} src={avatarSrc(row)} />
          <div className="min-w-0 flex-1">
            <Link
              href={`${TENANTS_PATH}/${row.id}`}
              className={`block truncate rounded-sm font-semibold text-fg hover:text-primary ${FOCUS_RING}`}
            >
              {row.name}
            </Link>
            <p className="mt-0.5 truncate text-xs text-fg-subtle">
              @{row.username}
            </p>
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
          <TenantRowActions
            tenantId={row.id}
            tenantName={row.name}
            status={row.status}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Description: Render result counts and URL-based pagination without changing query behavior.
 * Input: The existing typed arguments and component state.
 * Output: Accessible React UI.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
function Pagination({
  list,
  query,
}: {
  list: TenantListPage;
  query: TenantListQuery;
}) {
  const range = pageRowRange(list.page, list.pageSize, list.total);
  const previous =
    list.page > 1 ? tenantListHref({ ...query, page: list.page - 1 }) : null;
  const next =
    list.page < list.pageCount
      ? tenantListHref({ ...query, page: list.page + 1 })
      : null;

  return (
    <PaginationRoot
      aria-label="Pagination"
      className="mx-0 flex w-full flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
    >
      <p className="text-sm text-fg-muted">
        {range ? (
          <>
            Showing{" "}
            <span className="font-medium text-fg tabular-nums">
              {range.first}
            </span>
            –
            <span className="font-medium text-fg tabular-nums">
              {range.last}
            </span>{" "}
            of{" "}
            <span className="font-medium text-fg tabular-nums">
              {list.total}
            </span>
          </>
        ) : null}
      </p>
      {list.pageCount > 1 ? (
        <div className="flex items-center gap-2">
          <span className="mr-2 text-xs tabular-nums text-fg-subtle">
            Page {list.page} of {list.pageCount}
          </span>
          <PaginationContent>
            <PaginationItem>
              <PageLink href={previous} icon="chevron-left" label="Previous" />
            </PaginationItem>
            <PaginationItem>
              <PageLink href={next} icon="chevron-right" label="Next" />
            </PaginationItem>
          </PaginationContent>
        </div>
      ) : null}
    </PaginationRoot>
  );
}

/**
 * Description: Render an available pagination destination or a disabled direction.
 * Input: The existing typed arguments and component state.
 * Output: Accessible React UI.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
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

  // Unavailable directions are disabled controls; they never submit or change the URL.
  if (href === null) {
    return (
      <Button type="button" disabled variant="outline" size="sm">
        {content}
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={href}>{content}</Link>
    </Button>
  );
}

/**
 * Description: Show an illustrated directory empty state with its recovery action.
 * Input: The existing typed arguments and component state.
 * Output: Accessible React UI.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
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
    <Empty className="rounded-none border-t border-border px-6 py-16">
      <EmptyHeader>
        <EmptyMedia
          variant="icon"
          className="size-16 rounded-2xl bg-primary/10 text-primary"
        >
          <Icon name={icon} className="size-7" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>{action}</EmptyContent>
    </Empty>
  );
}
