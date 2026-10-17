import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { AccessDenied } from "@/components/shared";
import { requirePlatformAccess } from "@/lib/authz/platform";
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
import { CountDetails } from "../_components/count-details";
import { EmptyState } from "../_components/empty-state";
import { Icon, type IconName } from "../_components/icons";
import { Notice } from "../_components/notice";
import { PageHeader } from "../_components/page-header";
import { SectionedLayout, type SecondaryMenuItem } from "../_components/secondary-menu";
import { SensitiveValue } from "../_components/sensitive-value";
import { StatCard } from "../_components/stat-card";
import { StatusBadge } from "../_components/status-badge";
import { FOCUS_RING } from "../_components/styles";
import { getNavItem } from "../navigation";
import {
  DatabaseStateBadge,
  DomainStatusBadge,
  ExistingDatabaseTag,
} from "./_components/badges";
import { tenantListDetails, tenantSummaryDetails } from "./_components/count-details-content";
import {
  TenantListResults,
  TenantListTransition,
} from "./_components/list-transition";
import { TenantRowActions, type TenantRowPermissions } from "./_components/row-actions";
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

// The page's sections for the secondary menu (top bar: the table keeps its full width).
const SECTION_IDS = { summary: "tenant-summary-section", directory: "tenant-directory-section" } as const;
const MENU_ITEMS: readonly SecondaryMenuItem[] = [
  { id: SECTION_IDS.summary, label: "Summary", icon: "activity" },
  { id: SECTION_IDS.directory, label: "Tenant Directory", icon: "building-2" },
];

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Description: Render the tenant directory: summary figures, search/filter and the paged list.
 * Input: The URL search parameters (q, status, page, notice), read on the server.
 * Output: The protected page: header, notices, secondary menu, clickable
 *   summary cards and the database-paged tenant table/cards. Needs
 *   platform.tenants.view (otherwise the inline access-denied state, HTTP 200);
 *   "Create tenant" only with platform.tenants.create and each row's menu only
 *   with the matching privileges.
 * Use case: /platform/tenants — the owner reviews and manages all tenants.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
export default async function PlatformTenantsPage({ searchParams }: PageProps) {
  // Checked on the server on every request: session and CURRENT privileges.
  const { access } = await requirePlatformAccess();
  if (!access.can("platform.tenants.view")) return <AccessDenied homeHref={getNavItem("dashboard").href} />;
  // What this owner may do from the directory (the actions check again).
  const can: TenantRowPermissions = {
    edit: access.can("platform.tenants.edit"),
    suspend: access.can("platform.tenants.suspend"),
  };
  const canCreate = access.can("platform.tenants.create");
  const params    = await searchParams;
  const query     = parseTenantListQuery(params);
  const notice    = tenantNoticeMessage(params.notice);
  const [summary, list] = await Promise.all([
    loadTenantSummary(),
    listTenants(query),
  ]);

  return (
    <TenantFlashProvider>
      <div className="flex flex-col gap-8">
        <PageHeader
          eyebrow="Platform management"
          title="Tenant Management"
          description="Create, review and manage the tenants registered on the platform."
          actions={
            canCreate ? (
              <Button asChild variant="default">
                <Link href={NEW_TENANT_PATH}>
                  <Icon name="plus" className="size-4" />
                  Create tenant
                </Link>
              </Button>
            ) : undefined
          }
        />

        {notice ? <Notice variant="success">{notice}</Notice> : null}
        <TenantFlashNotice />

        <SectionedLayout items={MENU_ITEMS} variant="top" contentClassName="flex flex-col gap-8">
          <section id={SECTION_IDS.summary} aria-labelledby="tenant-summary">
            <h2 id="tenant-summary" className="sr-only">
              Tenant summary
            </h2>
            {/* Real figures only: when they can't be read, each card says so.
                Every figure opens the exact tenants it counts. */}
            <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Total tenants"
                icon="building-2"
                value={summary?.total ?? null}
                note={
                  summary ? "Registered on your platform" : SUMMARY_UNAVAILABLE
                }
                details={summary ? tenantSummaryDetails("all", summary) : undefined}
              />
              <StatCard
                label="Active"
                icon="activity"
                value={summary?.active ?? null}
                note={summary ? "Accounts marked active" : SUMMARY_UNAVAILABLE}
                details={summary ? tenantSummaryDetails("active", summary) : undefined}
              />
              <StatCard
                label="Suspended"
                icon="ban"
                value={summary?.suspended ?? null}
                note={
                  summary ? "Access currently suspended" : SUMMARY_UNAVAILABLE
                }
                details={summary ? tenantSummaryDetails("suspended", summary) : undefined}
              />
              <StatCard
                label="Pending setup"
                icon="clock"
                value={summary?.pendingSetup ?? null}
                note={
                  !summary ? (
                    SUMMARY_UNAVAILABLE
                  ) : summary.failed > 0 ? (
                    // The failed figure is a count too: it opens the failed tenants.
                    <FailedNote failed={summary.failed} details={tenantSummaryDetails("failed", summary)} />
                  ) : (
                    "Awaiting provisioning"
                  )
                }
                details={summary ? tenantSummaryDetails("setup", summary) : undefined}
              />
            </dl>
          </section>

          <Card
            id={SECTION_IDS.directory}
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
                {/* The result total opens the exact tenants that match the filters. */}
                <TotalBadge query={query} list={list} />
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
                <TenantResults list={list} query={query} can={can} canCreate={canCreate} />
              </TenantListResults>
            </TenantListTransition>
          </Card>
        </SectionedLayout>
      </div>
    </TenantFlashProvider>
  );
}

/**
 * Description: Show the directory's result total as a badge that opens its records.
 * Input: The current list query and the loaded page (for its total and page size).
 * Output: A badge-styled count button with the shared count-details dialog.
 * Use case: The "Tenant directory" card header (CLAUDE.md count transparency).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function TotalBadge({ query, list }: { query: TenantListQuery; list: TenantListPage }) {
  const details = tenantListDetails(query, list.total, list.pageSize);
  return (
    <Badge variant="outline" className="tabular-nums">
      <CountDetails
        label={`${list.total} tenants in this list. Show them.`}
        title={details.title}
        description={details.description}
        calculation={details.calculation}
        records={details.records}
        className="text-xs font-medium no-underline hover:underline"
      >
        {list.total}
      </CountDetails>
    </Badge>
  );
}

/**
 * Description: Show the "N failed" note of the Pending setup card as a count button.
 * Input: The number of failed setups and that figure's details.
 * Output: A destructive-coloured button that opens the failed tenants.
 * Use case: The Pending setup summary card when at least one setup failed.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function FailedNote({
  failed,
  details,
}: {
  failed: number;
  details: ReturnType<typeof tenantSummaryDetails>;
}) {
  return (
    <CountDetails
      label={`${failed} failed setups. Show the tenants.`}
      title={details.title}
      description={details.description}
      calculation={details.calculation}
      records={details.records}
      className="text-xs font-medium text-destructive"
    >
      {failed} failed
    </CountDetails>
  );
}

// ---------------------------------------------------------------------------

/**
 * Description: Render the directory's results for the current query.
 * Input: The loaded page, the query, the row permissions and whether the owner
 *   may create tenants.
 * Output: The table (xl) and cards (smaller screens) with pagination, or the
 *   matching empty state (no tenants, no matches, page past the end); the
 *   "Create tenant" empty-state action only with platform.tenants.create.
 * Use case: The tenant directory card.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
function TenantResults({
  list,
  query,
  can,
  canCreate,
}: {
  list: TenantListPage;
  query: TenantListQuery;
  can: TenantRowPermissions;
  canCreate: boolean;
}) {
  const filtered = query.q !== "" || query.status !== "all";

  if (list.total === 0) {
    return filtered ? (
      <DirectoryEmptyState
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
      <DirectoryEmptyState
        icon="building-2"
        title="No tenants yet"
        text={
          canCreate
            ? "Create the first tenant to give it its own database and subdomain."
            : "Tenants appear here once someone with permission to create them adds the first one."
        }
        action={
          canCreate ? (
            <Button asChild variant="default">
              <Link href={NEW_TENANT_PATH}>
                <Icon name="plus" className="size-4" />
                Create tenant
              </Link>
            </Button>
          ) : null
        }
      />
    );
  }

  // A page number past the end (an old link, a hand-edited URL).
  if (list.rows.length === 0) {
    return (
      <DirectoryEmptyState
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
      <TenantTable rows={list.rows} can={can} />
      <ul className="grid gap-4 px-5 pt-5 md:grid-cols-2 xl:hidden">
        {list.rows.map((row) => (
          <li key={row.id}>
            <TenantCard row={row} can={can} />
          </li>
        ))}
      </ul>
      <Pagination list={list} query={query} />
    </>
  );
}

/**
 * Description: Build a row's avatar URL.
 * Input: The row (id and whether it has a stored image).
 * Output: The protected avatar route, or null for initials.
 * Use case: TenantTable and TenantCard.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function avatarSrc(row: {
  id: string;
  hasProfileImage: boolean;
}): string | null {
  return row.hasProfileImage ? `${TENANTS_PATH}/${row.id}/avatar` : null;
}

/**
 * Description: Show a tenant's status with its suspension reason.
 * Input: The row.
 * Output: The status badge; a suspended tenant's reason in the title and for screen readers.
 * Use case: TenantTable and TenantCard.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
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
 * Description: Show a tenant's domains.
 * Input: The row.
 * Output: The subdomain host and the custom host with its pending state (hosts wrap
 *   at natural break points).
 * Use case: TenantTable and TenantCard.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function DomainCell({ row }: { row: TenantListRow }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-fg [overflow-wrap:anywhere]">
        {row.subdomainHost ?? "—"}
      </span>
      {row.customDomain ? (
        <span className="flex flex-wrap items-center gap-1.5 text-fg-muted">
          <span className="[overflow-wrap:anywhere]">
            {row.customDomain.host}
          </span>
          {row.customDomain.status !== "active" ? (
            <DomainStatusBadge status={row.customDomain.status} compact />
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Description: Render the tenant's email and phone, each masked behind an eye button.
 * Input: One directory row.
 * Output: The masked email and, when stored, the masked phone number.
 * Use case: The Contact column of the directory table (sensitive data rule).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function ContactCell({ row }: { row: TenantListRow }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <SensitiveValue value={row.email} noun="email" monospace={false} />
      {row.phone ? (
        <SensitiveValue value={row.phone} noun="phone number" monospace={false} className="text-fg-subtle" />
      ) : null}
    </div>
  );
}

/**
 * Description: Show a tenant's database state.
 * Input: The row.
 * Output: The database state badge and the Existing tag.
 * Use case: TenantTable and TenantCard.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
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
 * Description: Show a tenant's creation date.
 * Input: The row.
 * Output: A <time> element with the formatted date.
 * Use case: TenantTable and TenantCard.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function CreatedCell({ row }: { row: TenantListRow }) {
  return (
    <time dateTime={row.createdAt} className="whitespace-nowrap">
      {formatDate(row.createdAt)}
    </time>
  );
}

const TH = "px-5 py-3.5 text-[11px] font-semibold tracking-wide";
const TD = "px-5 py-4 align-middle whitespace-normal";

/**
 * Description: Render the directory as a table (xl and up).
 * Input: The rows of the page and the owner's row permissions (edit, suspend).
 * Output: Tenant, Contact (masked), Domain, Database, Status and Actions columns.
 *   Below xl the six columns would only fit by scrolling sideways, so cards are used.
 * Use case: TenantResults.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
function TenantTable({ rows, can }: { rows: TenantListRow[]; can: TenantRowPermissions }) {
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
                  {/* Name and creation date; the admin username is a credential and is not listed. */}
                  <div className="min-w-0">
                    <Link
                      href={`${TENANTS_PATH}/${row.id}`}
                      className={`block truncate rounded-sm text-sm font-semibold text-fg hover:text-primary ${FOCUS_RING}`}
                    >
                      {row.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      Created <CreatedCell row={row} />
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell className={`${TD} max-w-64`}>
                {/* Contact details are sensitive: masked until the eye button is used. */}
                <ContactCell row={row} />
              </TableCell>
              <TableCell className={`${TD} max-w-72`}>
                <DomainCell row={row} />
              </TableCell>
              <TableCell className={TD}>
                <DatabaseCell row={row} />
              </TableCell>
              <TableCell className={TD}>
                <TenantStatusCell row={row} />
              </TableCell>
              <TableCell className={`${TD} text-right`}>
                <TenantRowActions
                  tenantId={row.id}
                  tenantName={row.name}
                  status={row.status}
                  can={can}
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
 * Description: Render one tenant as a card (below xl).
 * Input: The row and the owner's row permissions.
 * Output: The same data as a table row (contact details masked), two per row from md.
 * Use case: TenantResults.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
function TenantCard({ row, can }: { row: TenantListRow; can: TenantRowPermissions }) {
  return (
    <Card
      role="article"
      aria-label={row.name}
      className="gap-0 bg-background/40 py-0"
    >
      <CardContent className="flex flex-col gap-5 p-4">
        <div className="flex items-start gap-3">
          <Avatar name={row.name} src={avatarSrc(row)} />
          {/* Name only: the admin username is a credential and is not listed. */}
          <div className="min-w-0 flex-1 self-center">
            <Link
              href={`${TENANTS_PATH}/${row.id}`}
              className={`block truncate rounded-sm font-semibold text-fg hover:text-primary ${FOCUS_RING}`}
            >
              {row.name}
            </Link>
          </div>
          <TenantStatusCell row={row} />
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt className="text-fg-muted">Email</dt>
          <dd className="min-w-0">
            <SensitiveValue value={row.email} noun="email" monospace={false} />
          </dd>
          {row.phone ? (
            <>
              <dt className="text-fg-muted">Phone</dt>
              <dd className="min-w-0">
                <SensitiveValue value={row.phone} noun="phone number" monospace={false} />
              </dd>
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
            can={can}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Description: Render the result position and the page links.
 * Input: The loaded page and the query.
 * Output: "Showing a–b of n · Page x of y" (opens the count dialog with the
 *   calculation and the tenants) and Previous/Next links that keep the filters.
 * Use case: TenantResults.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function Pagination({
  list,
  query,
}: {
  list: TenantListPage;
  query: TenantListQuery;
}) {
  const range = pageRowRange(list.page, list.pageSize, list.total);
  // The "of n" total and the page count open the same records as the header badge.
  const details = tenantListDetails(query, list.total, list.pageSize);
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
      <div className="text-sm text-fg-muted">
        {range ? (
          <CountDetails
            label={`Showing ${range.first} to ${range.last} of ${list.total} tenants, page ${list.page} of ${list.pageCount}. Show how this is calculated.`}
            title={details.title}
            description={details.description}
            calculation={details.calculation}
            records={details.records}
            className="text-sm font-normal text-fg-muted"
          >
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
            {list.pageCount > 1 ? (
              <span className="tabular-nums text-fg-subtle"> · Page {list.page} of {list.pageCount}</span>
            ) : null}
          </CountDetails>
        ) : null}
      </div>
      {list.pageCount > 1 ? (
        <div className="flex items-center gap-2">
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
 * Description: Render one pagination direction.
 * Input: The destination (or null), the icon and the label.
 * Output: A link button, or a disabled button when there is no such page (it never
 *   submits or changes the URL).
 * Use case: Pagination.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
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
 * Description: Show the directory's empty state (shared EmptyState below the toolbar).
 * Input: The icon, heading, description and recovery action.
 * Output: The shared illustrated empty state with a top border under the toolbar.
 * Use case: No tenants yet, no search results, a page number past the end.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function DirectoryEmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: IconName;
  title: string;
  text: string;
  action: ReactNode;
}) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      description={text}
      action={action}
      className="rounded-none border-t border-border py-16"
    />
  );
}
