import "server-only";
/**
 * Reading tenants for the console (docs/tenant-management.md §8.2).
 *
 * Every result is a DTO built field by field: password hashes, secret
 * references, ciphertext and connection strings never leave this module.
 */
import { Prisma } from "@/generated/prisma/control/client";
import { getControlDb } from "@/lib/db/control";
import { normalizeHostName, subdomainHost, verificationRecord } from "@/lib/domains/rules";
import { getEnv } from "@/lib/env";
import { describeError } from "@/lib/platform-auth/session";
import { isProvisioningRunning, provisioningPlan } from "@/lib/provisioning";
import {
  escapeLikePattern,
  type TenantCountCategory,
  type TenantCountSource,
  TENANT_LIST_MAX_PAGE,
  TENANT_LIST_PAGE_SIZE,
  TENANT_LIST_STATUS_FILTERS,
  TENANT_SEARCH_MAX_LENGTH,
  type TenantListQuery,
} from "@/lib/tenants/rules";
// Plain data shared with the tenant screens (no server or client dependencies).
import {
  type DomainStatus,
  PROVISIONING_STEP_LABELS,
  type ProvisioningStepName,
  type TenantStatus,
} from "@/app/platform/(console)/tenants/labels";
import { isUuid } from "./common";

// ---------------------------------------------------------------------------
// Summary

export type TenantSummary = {
  total: number;
  active: number;
  suspended: number;
  /** pending + provisioning + failed. */
  pendingSetup: number;
  failed: number;
};

/**
 * Description: Count the tenants per status for the summary widgets.
 * Input: None.
 * Output: Total, active, suspended, pending setup (pending + provisioning +
 *   failed) and failed, from one GROUP BY on tenants.status.
 * Use case: The dashboard's and the tenant directory's summary cards; each
 *   figure's records come from listTenantCountRecords with the same grouping.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function getTenantSummary(): Promise<TenantSummary> {
  // Step 1: one row per status with its count.
  const groups = await getControlDb().tenant.groupBy({ by: ["status"], _count: { _all: true } });

  /**
   * Description: Step 2: read the count of one status from the GROUP BY result.
   * Input: The status.
   * Output: Its count, or 0 when no tenant has it.
   * Use case: getTenantSummary.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  const count = (status: TenantStatus): number =>
    groups.find((group) => group.status === status)?._count._all ?? 0;

  // Step 3: the figures the widgets show.
  return {
    total: groups.reduce((sum, group) => sum + group._count._all, 0),
    active: count("active"),
    suspended: count("suspended"),
    pendingSetup: count("pending") + count("provisioning") + count("failed"),
    failed: count("failed"),
  };
}

// ---------------------------------------------------------------------------
// List

export type DatabaseState = "ready" | "pending" | "provisioning" | "failed";
export type DatabaseModeName = "provisioned" | "existing";

export type TenantListRow = {
  id: string;
  name: string;
  username: string;
  email: string;
  phone: string | null;
  status: TenantStatus;
  statusReason: string | null;
  /** `<label>.<base>`; null only for a tenant without a subdomain row. */
  subdomainHost: string | null;
  customDomain: { host: string; status: DomainStatus } | null;
  databaseMode: DatabaseModeName;
  databaseState: DatabaseState;
  hasProfileImage: boolean;
  /** ISO 8601. */
  createdAt: string;
};

export type TenantListPage = {
  rows: TenantListRow[];
  total: number;
  /** The page served (1-based, after bounds checks). */
  page: number;
  /** At least 1, also when there are no rows. */
  pageCount: number;
  pageSize: number;
};

type ListRow = {
  id: string;
  name: string;
  admin_username: string;
  contact_email: string;
  phone: string | null;
  status: TenantStatus;
  status_reason: string | null;
  database_mode: DatabaseModeName;
  has_profile_image: boolean;
  created_at: Date;
  subdomain: string | null;
  custom_host: string | null;
  custom_status: DomainStatus | null;
};

/**
 * Description: Derive the directory's database column from the tenant status.
 * Input: The tenant status.
 * Output: "pending" / "provisioning" / "failed" while setup is not done, otherwise "ready".
 * Use case: The Database column of the tenant directory.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function databaseState(status: TenantStatus): DatabaseState {
  if (status === "pending" || status === "provisioning" || status === "failed") return status;
  // Active, suspended and deprovisioning tenants were fully provisioned.
  return "ready";
}

// Fixed SQL per filter: nothing from the request is spliced in.
const STATUS_CONDITIONS: Record<TenantListQuery["status"], Prisma.Sql> = {
  all: Prisma.sql`TRUE`,
  active: Prisma.sql`t.status = 'active'`,
  suspended: Prisma.sql`t.status = 'suspended'`,
  pending: Prisma.sql`t.status IN ('pending', 'provisioning')`,
  failed: Prisma.sql`t.status = 'failed'`,
};

// Fixed SQL per summary figure, matching getTenantSummary exactly:
// "setup" (Pending setup) = pending + provisioning + failed.
const COUNT_CATEGORY_CONDITIONS: Record<TenantCountCategory, Prisma.Sql> = {
  all: Prisma.sql`TRUE`,
  active: Prisma.sql`t.status = 'active'`,
  suspended: Prisma.sql`t.status = 'suspended'`,
  setup: Prisma.sql`t.status IN ('pending', 'provisioning', 'failed')`,
  failed: Prisma.sql`t.status = 'failed'`,
};

/**
 * Description: Build the SQL condition of the directory search.
 * Input: The bounded search text and the platform base domain.
 * Output: TRUE for an empty search, otherwise a case-insensitive match on the
 *   name, admin username, email, subdomain host (with or without the base
 *   domain) and custom domain host.
 * Use case: listTenants (directory and its total's details dialog).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function searchCondition(q: string, baseDomain: string): Prisma.Sql {
  if (q.length === 0) return Prisma.sql`TRUE`;
  const pattern = `%${escapeLikePattern(q)}%`;
  // "acme.localhost" finds the tenant whose subdomain label is "acme".
  const suffix       = `.${normalizeHostName(baseDomain)}`;
  const lowered      = q.toLowerCase();
  const label        = lowered.endsWith(suffix) ? lowered.slice(0, -suffix.length) : "";
  const labelPattern = label.length > 0 ? `%${escapeLikePattern(label)}%` : pattern;
  // ESCAPE '\': the JavaScript string below holds one backslash.
  return Prisma.sql`(
    t.name ILIKE ${pattern} ESCAPE '\\'
    OR t.admin_username ILIKE ${pattern} ESCAPE '\\'
    OR t.contact_email ILIKE ${pattern} ESCAPE '\\'
    OR sd.hostname ILIKE ${pattern} ESCAPE '\\'
    OR sd.hostname ILIKE ${labelPattern} ESCAPE '\\'
    OR cd.hostname ILIKE ${pattern} ESCAPE '\\'
  )`;
}

/**
 * Description: Re-apply the bounds of parseTenantListQuery (callers may pass anything).
 * Input: A list query from any caller.
 * Output: The query with a trimmed search (≤100 characters), a known status and a page 1–10000.
 * Use case: listTenants, before the values reach SQL.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function boundedQuery(query: TenantListQuery): TenantListQuery {
  const q      = typeof query.q === "string" ? query.q.trim().slice(0, TENANT_SEARCH_MAX_LENGTH).trim() : "";
  const status = TENANT_LIST_STATUS_FILTERS.includes(query.status) ? query.status : "all";
  const page =
    Number.isInteger(query.page) && query.page >= 1 && query.page <= TENANT_LIST_MAX_PAGE
      ? query.page
      : 1;
  return { q, status, page };
}

/**
 * Description: Read one page of tenants for the directory's search and status filter.
 * Input: The list query (search text, status filter, page); re-bounded here.
 * Output: The page's rows (newest first), the total for the same filters and the page count.
 * Use case: The tenant directory and the details dialog of its result total.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function listTenants(query: TenantListQuery): Promise<TenantListPage> {
  const { q, status, page } = boundedQuery(query);
  return queryTenantPage(STATUS_CONDITIONS[status], q, page);
}

/**
 * Description: Read one page of the tenants behind a count shown in the console.
 * Input: The count's source (a summary figure, or the directory total with its
 *   search and status) and the page number (bounded here).
 * Output: The page's rows (newest first), the total and the page count. For a
 *   summary figure the total equals that figure in getTenantSummary.
 * Use case: The count-details dialogs (CLAUDE.md count transparency): dashboard
 *   and directory summary cards, the "failed" note and the directory total.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function listTenantCountRecords(
  source: TenantCountSource,
  page: number,
): Promise<TenantListPage> {
  // The directory total uses exactly the directory's own query.
  if (source.kind === "list") {
    return listTenants({ q: source.q, status: source.status, page });
  }
  // A summary figure: its fixed status group, no search.
  const bounded = boundedQuery({ q: "", status: "all", page });
  return queryTenantPage(COUNT_CATEGORY_CONDITIONS[source.category], "", bounded.page);
}

/**
 * Description: Run the paged tenant query shared by the directory and the count dialogs.
 * Input: A fixed status condition (never request text), the bounded search text and page.
 * Output: The rows mapped to DTOs (no secrets), the total, the page and the page count.
 * Use case: listTenants and listTenantCountRecords, so both read tenants the same way.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
async function queryTenantPage(
  statusCondition: Prisma.Sql,
  q: string,
  page: number,
): Promise<TenantListPage> {
  const { platformBaseDomain } = getEnv();

  // Step 1: the shared FROM/WHERE. One subdomain and at most one custom row
  // per tenant (partial unique indexes), so the joins never duplicate a tenant.
  const from = Prisma.sql`
    FROM tenants t
    LEFT JOIN tenant_domains sd ON sd.tenant_id = t.id AND sd.type = 'subdomain'
    LEFT JOIN tenant_domains cd ON cd.tenant_id = t.id AND cd.type = 'custom'
    WHERE ${statusCondition} AND ${searchCondition(q, platformBaseDomain)}`;
  const offset = (page - 1) * TENANT_LIST_PAGE_SIZE;

  // Step 2: count and page in one transaction, so a page and its "of n" come
  // from the same request to the database.
  const db = getControlDb();
  const [counted, rows] = await db.$transaction([
    db.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total ${from}`,
    db.$queryRaw<ListRow[]>`
      SELECT t.id::text AS id, t.name, t.admin_username, t.contact_email, t.phone,
             t.status::text AS status, t.status_reason, t.database_mode::text AS database_mode,
             (t.profile_image_key IS NOT NULL) AS has_profile_image, t.created_at,
             sd.hostname AS subdomain, cd.hostname AS custom_host, cd.status::text AS custom_status
      ${from}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT ${TENANT_LIST_PAGE_SIZE} OFFSET ${offset}`,
  ]);

  // Step 3: map every row field by field; nothing else leaves this module.
  const total = counted[0]?.total ?? 0;
  return {
    rows: rows.map((row) => ({
      id: row.id,
      name: row.name,
      username: row.admin_username,
      email: row.contact_email,
      phone: row.phone,
      status: row.status,
      statusReason: row.status_reason,
      subdomainHost: row.subdomain ? subdomainHost(row.subdomain, platformBaseDomain) : null,
      customDomain:
        row.custom_host && row.custom_status
          ? { host: row.custom_host, status: row.custom_status }
          : null,
      databaseMode: row.database_mode,
      databaseState: databaseState(row.status),
      hasProfileImage: row.has_profile_image,
      createdAt: row.created_at.toISOString(),
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / TENANT_LIST_PAGE_SIZE)),
    pageSize: TENANT_LIST_PAGE_SIZE,
  };
}

// ---------------------------------------------------------------------------
// Details

export type ProvisioningStepState = "done" | "running" | "failed" | "waiting";

export type TenantHistoryAction =
  | "tenant.created"
  | "tenant.provisioned"
  | "tenant.provisioning_failed"
  | "tenant.suspended"
  | "tenant.reactivated";

const HISTORY_ACTIONS: readonly TenantHistoryAction[] = [
  "tenant.created",
  "tenant.provisioned",
  "tenant.provisioning_failed",
  "tenant.suspended",
  "tenant.reactivated",
];
const HISTORY_LIMIT = 50;

export type TenantHistoryEntry = {
  action: TenantHistoryAction;
  /** ISO 8601. */
  occurredAt: string;
  /** The platform owner's user name, "Platform owner" (deleted account) or "System". */
  actor: string;
  /**
   * True when `actor` is a platform owner's user name: sensitive, so the
   * page masks it behind an eye button. False for "System" and "Platform owner".
   */
  actorIsUsername: boolean;
  /** The suspension reason; null for other events. */
  reason: string | null;
};

export type TenantDetails = {
  id: string;
  name: string;
  status: TenantStatus;
  statusReason: string | null;
  hasProfileImage: boolean;
  createdAt: string;
  activatedAt: string | null;
  suspendedAt: string | null;
  profile: { name: string; phone: string | null; email: string };
  login: { username: string; email: string; twoFactor: "unavailable" };
  database: {
    mode: DatabaseModeName;
    name: string | null;
    user: string | null;
    port: number | null;
    /** POSTGRES_HOST, as a label: the server the database lives on. */
    host: string;
    /** Whether a password is stored. Never the password. */
    hasPassword: boolean;
    schemaStatus: "pending" | "current" | "failed";
    schemaVersion: string | null;
  };
  domains: {
    baseDomain: string;
    subdomain: {
      label: string;
      host: string;
      status: DomainStatus;
      lastCheckError: string | null;
    } | null;
    custom: {
      host: string;
      status: DomainStatus;
      verifiedAt: string | null;
      lastCheckedAt: string | null;
      lastCheckError: string | null;
      /** The TXT record to add, while the domain is not active yet. */
      verification: { name: string; value: string } | null;
    } | null;
  };
  provisioning: {
    steps: { step: ProvisioningStepName; label: string; state: ProvisioningStepState }[];
    /** The latest run's attempt number; 0 before the first run. */
    attempt: number;
    lastError: { code: string; message: string } | null;
    canRetry: boolean;
  };
  /**
   * Set while the tenant is suspended, from the latest suspension event.
   * `byIsUsername` says whether `by` is a platform owner's user name (masked on the page).
   */
  suspension: {
    at: string | null;
    by: string | null;
    byIsUsername: boolean;
    reason: string | null;
  } | null;
  /** Newest first. */
  history: TenantHistoryEntry[];
};

const SYSTEM_ACTOR  = "System";
const UNKNOWN_OWNER = "Platform owner";

/**
 * Description: Serialize an optional timestamp for the DTO.
 * Input: A date or null.
 * Output: The ISO 8601 text, or null.
 * Use case: getTenantDetails (activation, suspension and domain check times).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/**
 * Description: Read the suspension reason stored in an audit event's metadata.
 * Input: The audit event's JSON metadata.
 * Output: The reason text, or null when the metadata has none.
 * Use case: Status history and the suspension notice of the details page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function metadataReason(metadata: Prisma.JsonValue | null): string | null {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const reason = (metadata as Record<string, unknown>).reason;
    return typeof reason === "string" ? reason : null;
  }
  return null;
}

/**
 * Description: Decide whether the owner may retry the tenant's setup.
 * Input: The tenant id and status.
 * Output: True for a failed setup, or a "provisioning" tenant whose runner lock
 *   is free (the run was interrupted); false on a lock check failure (logged).
 * Use case: The Retry setup button of the details page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
async function canRetrySetup(id: string, status: TenantStatus): Promise<boolean> {
  if (status === "failed") return true;
  if (status !== "provisioning") return false;
  try {
    // `provisioning` with nobody holding the lock: the run was interrupted.
    return !(await isProvisioningRunning(id));
  } catch (error) {
    console.error(`[tenants] could not check the provisioning lock: ${describeError(error)}`);
    return false;
  }
}

/**
 * Description: Read everything the tenant details page shows.
 * Input: The tenant id from the URL (UUID-validated here).
 * Output: The details DTO (profile, login, database without secrets, domains,
 *   setup progress, suspension and status history), or null when there is no
 *   such tenant.
 * Use case: The details page and its metadata.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function getTenantDetails(id: string): Promise<TenantDetails | null> {
  if (!isUuid(id)) return null;
  const db = getControlDb();
  const tenant = await db.tenant.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      status: true,
      statusReason: true,
      contactEmail: true,
      adminUsername: true,
      phone: true,
      profileImageKey: true,
      databaseMode: true,
      databaseName: true,
      databaseUser: true,
      databasePort: true,
      databaseSecretRef: true,
      schemaStatus: true,
      schemaVersion: true,
      activatedAt: true,
      suspendedAt: true,
      createdAt: true,
      domains: {
        select: {
          type: true,
          hostname: true,
          status: true,
          verificationToken: true,
          verifiedAt: true,
          lastCheckedAt: true,
          lastCheckError: true,
        },
      },
      provisioningRuns: {
        orderBy: { attempt: "desc" },
        take: 1,
        select: { attempt: true, status: true, step: true, errorCode: true, errorMessage: true },
      },
      provisioningSteps: { select: { step: true } },
    },
  });
  if (!tenant) return null;

  const [events, canRetry] = await Promise.all([
    db.auditEvent.findMany({
      where: { tenantId: id, action: { in: [...HISTORY_ACTIONS] } },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: HISTORY_LIMIT,
      select: { action: true, occurredAt: true, actorType: true, actorId: true, metadata: true },
    }),
    canRetrySetup(id, tenant.status),
  ]);

  // actor_id is free text; only well-formed ids are looked up.
  const ownerIds = [
    ...new Set(
      events
        .filter((event) => event.actorType === "super_admin" && isUuid(event.actorId))
        .map((event) => event.actorId as string),
    ),
  ];
  const owners =
    ownerIds.length > 0
      ? await db.platformOwner.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, username: true },
        })
      : [];
  const ownerNames = new Map(owners.map((owner) => [owner.id, owner.username]));

  const history: TenantHistoryEntry[] = events.map((event) => {
    // A known owner's user name is sensitive; the placeholders are not.
    const ownerName =
      event.actorType === "super_admin" ? ownerNames.get(event.actorId ?? "") : undefined;
    return {
      action: event.action as TenantHistoryAction,
      occurredAt: event.occurredAt.toISOString(),
      actor:
        event.actorType === "super_admin" ? (ownerName ?? UNKNOWN_OWNER) : SYSTEM_ACTOR,
      actorIsUsername: ownerName !== undefined,
      reason: event.action === "tenant.suspended" ? metadataReason(event.metadata) : null,
    };
  });

  const { postgres, platformBaseDomain } = getEnv();
  const subdomain = tenant.domains.find((domain) => domain.type === "subdomain");
  const custom    = tenant.domains.find((domain) => domain.type === "custom");

  const run       = tenant.provisioningRuns[0];
  const completed = new Set<string>(tenant.provisioningSteps.map((row) => row.step));
  const steps = provisioningPlan(tenant.databaseMode).map((step) => {
    let state: ProvisioningStepState = "waiting";
    if (completed.has(step)) state = "done";
    else if (run?.step === step && run.status === "running") state = "running";
    else if (run?.step === step && run.status === "failed") state = "failed";
    return { step, label: PROVISIONING_STEP_LABELS[step], state };
  });

  const lastSuspension =
    tenant.status === "suspended" ? history.find((entry) => entry.action === "tenant.suspended") : undefined;

  return {
    id: tenant.id,
    name: tenant.name,
    status: tenant.status,
    statusReason: tenant.statusReason,
    hasProfileImage: tenant.profileImageKey !== null,
    createdAt: tenant.createdAt.toISOString(),
    activatedAt: iso(tenant.activatedAt),
    suspendedAt: iso(tenant.suspendedAt),
    profile: { name: tenant.name, phone: tenant.phone, email: tenant.contactEmail },
    login: { username: tenant.adminUsername, email: tenant.contactEmail, twoFactor: "unavailable" },
    database: {
      mode: tenant.databaseMode,
      name: tenant.databaseName,
      user: tenant.databaseUser,
      port: tenant.databasePort,
      host: postgres.host,
      hasPassword: tenant.databaseSecretRef !== null,
      schemaStatus: tenant.schemaStatus,
      schemaVersion: tenant.schemaVersion,
    },
    domains: {
      baseDomain: platformBaseDomain,
      subdomain: subdomain
        ? {
            label: subdomain.hostname,
            host: subdomainHost(subdomain.hostname, platformBaseDomain),
            status: subdomain.status,
            lastCheckError: subdomain.lastCheckError,
          }
        : null,
      custom: custom
        ? {
            host: custom.hostname,
            status: custom.status,
            verifiedAt: iso(custom.verifiedAt),
            lastCheckedAt: iso(custom.lastCheckedAt),
            lastCheckError: custom.lastCheckError,
            verification:
              custom.status !== "active" && custom.verificationToken
                ? verificationRecord(custom.hostname, custom.verificationToken)
                : null,
          }
        : null,
    },
    provisioning: {
      steps,
      attempt: run?.attempt ?? 0,
      lastError:
        run?.status === "failed"
          ? { code: run.errorCode ?? "internal", message: run.errorMessage ?? "Setup failed." }
          : null,
      canRetry,
    },
    suspension:
      tenant.status === "suspended"
        ? {
            at: iso(tenant.suspendedAt),
            by: lastSuspension?.actor ?? null,
            byIsUsername: lastSuspension?.actorIsUsername ?? false,
            reason: tenant.statusReason ?? lastSuspension?.reason ?? null,
          }
        : null,
    history,
  };
}
