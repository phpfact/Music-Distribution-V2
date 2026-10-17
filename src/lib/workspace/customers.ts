import "server-only";
/**
 * The tenant's Customers module: list, counts, creation and suspension of the
 * MAIN customers of one tenant (.vibe/memory/customer-management.md).
 *
 * Every function receives the tenant's database client from the caller: the
 * database of the tenant resolved from the Host header (tenant area). A
 * customer of another tenant therefore does not exist here.
 * Authorization (who may call what) is checked by the calling Server Action
 * (tenant.customers.view / create / suspend); this service enforces the
 * business rules, the identity uniqueness and the status transitions.
 */
import { RBAC_PAGE_SIZE } from "@/components/rbac/list-href";
import type { Prisma } from "@/generated/prisma/tenant/client";
import { recordAudit, type AuditAction, type AuditMetadata } from "@/lib/audit";
import { MASTER_SYSTEM_KEYS } from "@/lib/authz/catalog";
import { getControlDb } from "@/lib/db/control";
import type { TenantDb } from "@/lib/db/tenant";
import { hashPassword } from "@/lib/platform-auth/password";
import { describeError } from "@/lib/platform-auth/session";
import { isUuid } from "@/lib/uuid";
import {
  parseCustomerStatusChange,
  validateCustomerFields,
  type CustomerActionResult,
  type CustomerFieldErrors,
  type CustomerListQuery,
  type CustomerPage,
  type CustomerRow,
  type CustomerSummary,
  type ValidCustomer,
} from "./customer-rules";
import { findIdentityConflicts, identityConflictErrors, lockWorkspaceIdentities } from "./identity";
import type { RegistrationActor } from "./registrations";
import { textOf } from "./rules";

/**
 * Who manages customers: a tenant staff user (tenant area) or, later, a
 * Platform Owner acting for a selected tenant (same shape as the registration
 * reviewers, so the audit log names both the same way).
 */
export type CustomerActor = RegistrationActor;

/** Rows per page of the customers list and its popups (server-side pagination). */
export const CUSTOMER_PAGE_SIZE = RBAC_PAGE_SIZE;

// Prisma's error code for a violated unique constraint.
const UNIQUE_VIOLATION = "P2002";

// The friendly messages of this module (technical details are only logged).
const MESSAGES = {
  createFailed: "The customer could not be created right now. Please try again.",
  identityRace: "This username or email address was just taken. Choose another one.",
  invalidChange: "Choose Suspend or Reactivate.",
  notFound: "This customer no longer exists. Refresh the page.",
  alreadySuspended: "This customer is already suspended. Refresh the page.",
  alreadyActive: "This customer is already active. Refresh the page.",
  suspended: "The customer was suspended and signed out. Their sub-customers cannot log in either until you reactivate it.",
  reactivated: "The customer was reactivated and can log in again.",
  changeFailed: "The change could not be saved. Please try again.",
} as const;

// The columns every list needs: the customer and its primary account (never a password hash).
const ROW_SELECT = {
  id: true,
  type: true,
  name: true,
  status: true,
  createdAt: true,
  // The main customer's own login: its primary account (oldest first for legacy rows).
  users: {
    select: { email: true, username: true, registration: { select: { id: true } } },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    take: 1,
  },
} as const satisfies Prisma.CustomerSelect;

type SelectedRow = Prisma.CustomerGetPayload<{ select: typeof ROW_SELECT }>;

/** The outcome of creating a customer. */
export type CustomerCreateResult =
  | { ok: true; customerId: string }
  | { ok: false; reason: "validation"; fieldErrors: CustomerFieldErrors; formMessage?: string }
  | { ok: false; reason: "unavailable"; formMessage: string };

// ---------------------------------------------------------------------------
// Helpers

/**
 * Description: Write an audit event for a tenant-database change that already committed.
 * Input: The tenant, the actor, the action, the customer id, metadata and the client address.
 * Output: Nothing. The customer lives in the tenant database and the audit log in
 *   the control plane, so they cannot share one transaction: the event is written
 *   right after the commit and a failure is only logged.
 * Use case: createCustomer and setCustomerStatus.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
async function auditAfterCommit(entry: {
  tenantId: string;
  actor: CustomerActor;
  action: AuditAction;
  customerId: string;
  metadata: AuditMetadata;
  ipAddress: string | null;
}): Promise<void> {
  try {
    await recordAudit(getControlDb(), {
      // Platform Owners are "super_admin", tenant staff "tenant_user" (same as registrations).
      actorType: entry.actor.type === "platform_owner" ? "super_admin" : "tenant_user",
      actorId: entry.actor.id,
      tenantId: entry.tenantId,
      action: entry.action,
      targetType: "customer",
      targetId: entry.customerId,
      metadata: entry.metadata,
      ipAddress: entry.ipAddress,
    });
  } catch (error) {
    console.error(`[customers] tenant ${entry.tenantId}: audit "${entry.action}" not written: ${describeError(error)}`);
  }
}

/**
 * Description: Tell whether an error is a violated unique constraint.
 * Input: Any thrown value.
 * Output: True for Prisma's P2002.
 * Use case: createCustomer, when a race slipped past the identity lock.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === UNIQUE_VIOLATION;
}

/**
 * Description: Turn a selected customer into the list shape.
 * Input: The selected row (customer + its primary account).
 * Output: A CustomerRow with an ISO date and the source (Sign-up when the
 *   primary account came from an approved registration, otherwise Added by tenant).
 * Use case: listCustomers.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
function toRow(row: SelectedRow): CustomerRow {
  const account = row.users[0] ?? null;
  return {
    id: row.id,
    name: row.name,
    accountType: row.type,
    status: row.status,
    username: account?.username ?? null,
    email: account?.email ?? null,
    source: account?.registration ? "signup" : "tenant",
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Description: Build the database filter of a status filter.
 * Input: "all", "active" or "disabled" (Suspended).
 * Output: The Prisma where-condition on the customer's own status.
 * Use case: listCustomers and getCustomerSummary (same definitions everywhere).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
function statusWhere(status: CustomerListQuery["status"]): Prisma.CustomerWhereInput {
  if (status === "active") return { status: "active" };
  if (status === "disabled") return { status: "disabled" };
  return {};
}

/**
 * Description: Build the database filter of a search text.
 * Input: The trimmed search text ("" for none).
 * Output: A case-insensitive match on the customer's name, or its account's
 *   email or username (stored lower-case; Prisma escapes LIKE wildcards in
 *   `contains`), or no condition.
 * Use case: listCustomers.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
function searchWhere(q: string): Prisma.CustomerWhereInput {
  if (!q) return {};
  const lower = q.toLowerCase();
  return {
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      { users: { some: { email: { contains: lower } } } },
      { users: { some: { username: { contains: lower } } } },
    ],
  };
}

// ---------------------------------------------------------------------------
// List and counts (database-level filtering, search and pagination)

/**
 * Description: List one page of the tenant's main customers.
 * Input: The tenant database and the list query (search, status, page).
 * Output: The rows (newest first), the total and the page count; a page beyond
 *   the end shows the last page. Sub-customers are never listed.
 * Use case: /tenant/customers, its count-details popups and the dashboard popup.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export async function listCustomers(db: TenantDb, query: CustomerListQuery): Promise<CustomerPage> {
  // Main customers only (parent_id IS NULL), then the status and the search.
  const where: Prisma.CustomerWhereInput = { AND: [{ parentId: null }, statusWhere(query.status), searchWhere(query.q)] };

  // Step 1: how many match (decides the page count).
  const total     = await db.customer.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE));
  const page      = Math.min(Math.max(query.page, 1), pageCount);

  // Step 2: only the requested page leaves the database.
  const rows = await db.customer.findMany({
    where,
    select: ROW_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * CUSTOMER_PAGE_SIZE,
    take: CUSTOMER_PAGE_SIZE,
  });

  return { rows: rows.map(toRow), total, page, pageCount, pageSize: CUSTOMER_PAGE_SIZE };
}

/**
 * Description: Count the tenant's main customers by status.
 * Input: The tenant database.
 * Output: Active, suspended and their total (a customer is either active or disabled).
 * Use case: The Customers summary cards and the dashboard's "Active customers" figure.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export async function getCustomerSummary(db: TenantDb): Promise<CustomerSummary> {
  // One readable count per figure, with the same conditions as the list filters.
  const active    = await db.customer.count({ where: { AND: [{ parentId: null }, statusWhere("active")] } });
  const suspended = await db.customer.count({ where: { AND: [{ parentId: null }, statusWhere("disabled")] } });
  return { total: active + suspended, active, suspended };
}

// ---------------------------------------------------------------------------
// Create

/**
 * Description: Write the customer, its primary account and its Master Customer role.
 * Input: The open transaction (identity lock already held), the validated
 *   values and the password hash.
 * Output: The new customer's id. Throws when the Master Customer role is
 *   missing (nothing is then written: the transaction rolls back).
 * Use case: createCustomer, inside its transaction.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
async function insertCustomerAccount(
  tx: Prisma.TransactionClient,
  value: ValidCustomer,
  passwordHash: string,
): Promise<string> {
  // Step 1: the Master Customer role, found by its protected system key (every
  // tenant database has it since the rbac migration).
  const masterCustomer = await tx.role.findUnique({
    where: { systemKey: MASTER_SYSTEM_KEYS.customer },
    select: { id: true },
  });
  if (!masterCustomer) throw new Error("the Master Customer role is missing");

  // Step 2: the main customer (no parent); its category is the chosen account type.
  const customer = await tx.customer.create({
    data: { type: value.accountType, name: value.fullName, status: "active", parentId: null },
    select: { id: true },
  });

  // Step 3: its login — the customer's primary account, active at once.
  const user = await tx.user.create({
    data: {
      email: value.email,
      username: value.username,
      passwordHash,
      name: value.fullName,
      status: "active",
      customerId: customer.id,
      isPrimary: true,
    },
    select: { id: true },
  });

  // Step 4: exactly one role — Master Customer (a primary account always keeps it).
  await tx.userRole.create({ data: { userId: user.id, roleId: masterCustomer.id } });
  return customer.id;
}

/**
 * Description: Create a main customer that can log in right away.
 * Input: The tenant database and id, the submitted fields (untrusted; only the
 *   six form fields are read), the acting staff user and the client address.
 * Output: The new customer's id, field errors (invalid values, taken email or
 *   username) or a friendly "unavailable" message. One transaction writes the
 *   customer (no parent), its primary user (Argon2id hash) and the user's
 *   Master Customer role, or nothing at all.
 * Use case: createTenantCustomerAction (/tenant/customers/new).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export async function createCustomer(
  db: TenantDb,
  tenantId: string,
  input: Record<string, unknown>,
  actor: CustomerActor,
  clientIp: string | null,
): Promise<CustomerCreateResult> {
  // Step 1: validate exactly the form's fields (same rules as the form).
  const validation = validateCustomerFields({
    fullName: textOf(input.fullName),
    accountType: textOf(input.accountType),
    username: textOf(input.username),
    email: textOf(input.email),
    password: textOf(input.password),
    confirmPassword: textOf(input.confirmPassword),
  });
  if (!validation.ok) return { ok: false, reason: "validation", fieldErrors: validation.fieldErrors };
  const value    = validation.value;
  const identity = { email: value.email, username: value.username };

  try {
    // Step 2: a quick duplicate check before the slow hash (re-checked under the lock).
    const early = identityConflictErrors(await findIdentityConflicts(db, identity));
    if (Object.keys(early).length > 0) return { ok: false, reason: "validation", fieldErrors: early };

    // Step 3: hash outside the transaction (Argon2 is deliberately slow).
    const passwordHash = await hashPassword(value.password);

    // Step 4: one transaction under the identity lock: re-check, then write.
    const outcome = await db.$transaction(async (tx): Promise<{ customerId: string } | { taken: CustomerFieldErrors }> => {
      await lockWorkspaceIdentities(tx);
      const taken = identityConflictErrors(await findIdentityConflicts(tx, identity));
      if (Object.keys(taken).length > 0) return { taken };
      return { customerId: await insertCustomerAccount(tx, value, passwordHash) };
    });
    // Someone claimed the email/username between step 2 and step 4.
    if ("taken" in outcome) return { ok: false, reason: "validation", fieldErrors: outcome.taken };

    // Step 5: audit (no personal data in the metadata) and log.
    await auditAfterCommit({
      tenantId,
      actor,
      action: "customer_account.created",
      customerId: outcome.customerId,
      metadata: { accountType: value.accountType },
      ipAddress: clientIp,
    });
    console.log(`[customers] tenant ${tenantId}: customer ${outcome.customerId} created by ${actor.type} ${actor.id}`);
    return { ok: true, customerId: outcome.customerId };
  } catch (error) {
    // A race the lock did not see (e.g. a write outside it) hits the UNIQUE constraints.
    if (isUniqueViolation(error)) {
      const again = identityConflictErrors(await findIdentityConflicts(db, identity).catch(() => ({})));
      return { ok: false, reason: "validation", fieldErrors: again, formMessage: MESSAGES.identityRace };
    }
    console.error(`[customers] tenant ${tenantId}: customer creation failed: ${describeError(error)}`);
    return { ok: false, reason: "unavailable", formMessage: MESSAGES.createFailed };
  }
}

// ---------------------------------------------------------------------------
// Suspend and reactivate

/**
 * Description: Suspend or reactivate a main customer of this tenant.
 * Input: The tenant database and id, the customer id and the change (both
 *   untrusted), the acting staff user and the client address.
 * Output: A success message, or a friendly error (invalid change, not found —
 *   also for sub-customers and other tenants' ids —, already in that state).
 *   One transaction: the customer row changes conditionally (never twice), its
 *   users follow, and a suspension deletes their sessions so access ends at
 *   once; sub-customers are refused on their next request because their main
 *   customer is not active.
 * Use case: setTenantCustomerStatusAction (Suspend / Reactivate on /tenant/customers).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export async function setCustomerStatus(
  db: TenantDb,
  tenantId: string,
  customerIdInput: unknown,
  changeInput: unknown,
  actor: CustomerActor,
  clientIp: string | null,
): Promise<CustomerActionResult> {
  // Step 1: a known change and a well-formed id (anything else is refused / "not found").
  const change = parseCustomerStatusChange(changeInput);
  if (!change) return { ok: false, error: MESSAGES.invalidChange };
  const customerId = textOf(customerIdInput);
  if (!isUuid(customerId)) return { ok: false, error: MESSAGES.notFound };
  const from = change === "suspend" ? "active" : "disabled";
  const to   = change === "suspend" ? "disabled" : "active";

  try {
    const outcome = await db.$transaction(async (tx): Promise<"changed" | "not_found" | "stale"> => {
      // Step 2: the customer must be a MAIN customer of this tenant database.
      const customer = await tx.customer.findFirst({ where: { id: customerId, parentId: null }, select: { id: true } });
      if (!customer) return "not_found";

      // Step 3: conditional status change (a stale page or a second tab changes nothing).
      const updated = await tx.customer.updateMany({
        where: { id: customerId, parentId: null, status: from },
        data: { status: to },
      });
      if (updated.count !== 1) return "stale";

      // Step 4: the customer's own users follow (its primary account).
      await tx.user.updateMany({ where: { customerId }, data: { status: to } });

      // Step 5: a suspension ends every open session of those users right away.
      if (change === "suspend") await tx.userSession.deleteMany({ where: { user: { customerId } } });
      return "changed";
    });

    if (outcome === "not_found") return { ok: false, error: MESSAGES.notFound };
    if (outcome === "stale") return { ok: false, error: change === "suspend" ? MESSAGES.alreadySuspended : MESSAGES.alreadyActive };

    // Step 6: audit after the commit (same actions as the registrations page, target = the customer).
    await auditAfterCommit({
      tenantId,
      actor,
      action: change === "suspend" ? "customer_account.suspended" : "customer_account.reactivated",
      customerId,
      metadata: { via: "customers" },
      ipAddress: clientIp,
    });
    console.log(`[customers] tenant ${tenantId}: customer ${customerId} ${change === "suspend" ? "suspended" : "reactivated"} by ${actor.type} ${actor.id}`);
    return { ok: true, message: change === "suspend" ? MESSAGES.suspended : MESSAGES.reactivated };
  } catch (error) {
    console.error(`[customers] tenant ${tenantId}: customer ${change} failed: ${describeError(error)}`);
    return { ok: false, error: MESSAGES.changeFailed };
  }
}
