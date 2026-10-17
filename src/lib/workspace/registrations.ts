import "server-only";
/**
 * Customer registrations of one tenant: public sign-up, review (approve /
 * reject), account suspension and the applicant's review request
 * (.vibe/memory/customer-registration.md).
 *
 * Every function receives the tenant's database client from the caller:
 *   - tenant area: the database of the tenant resolved from the Host header;
 *   - Platform Owner: the database of the tenant chosen by id on the server.
 * Authorization (who may call what) is checked by the calling Server Action;
 * this service enforces the business rules and the status transitions.
 */
import { recordAudit, type AuditAction, type AuditMetadata } from "@/lib/audit";
import { MASTER_SYSTEM_KEYS } from "@/lib/authz/catalog";
import { getControlDb } from "@/lib/db/control";
import type { TenantDb } from "@/lib/db/tenant";
import type { Prisma } from "@/generated/prisma/tenant/client";
import { hashPassword, verifyPassword } from "@/lib/platform-auth/password";
import { describeError } from "@/lib/platform-auth/session";
import { consumeRateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/uuid";
import { lockWorkspaceIdentities } from "./identity";
import {
  REGISTRATION_PAGE_SIZE,
  textOf,
  validateRejectionReason,
  validateReviewMessage,
  validateSignupFields,
  type RegistrationDisplayStatus,
  type RegistrationFilter,
  type RegistrationListQuery,
  type RegistrationPage,
  type RegistrationRow,
  type RegistrationSummary,
  type SignupFieldErrors,
  type ValidSignup,
} from "./rules";

export type { RegistrationPage, RegistrationRow, RegistrationSummary } from "./rules";

// Every write that can claim an email or username (sign-up, approval and the
// sub-user service) serializes on the shared identity lock (./identity.ts).

// Rate limits (Redis, fail closed).
const SIGNUP_LIMIT          = 5;
const SIGNUP_WINDOW_SECONDS = 60 * 60;
const REVIEW_LIMIT          = 3;
const REVIEW_WINDOW_SECONDS = 24 * 60 * 60;

// Prisma's error code for a violated unique constraint.
const UNIQUE_VIOLATION = "P2002";

/** Who reviews: a Platform Owner (control-plane id) or a tenant staff user. */
export type RegistrationActor = { type: "platform_owner" | "tenant_user"; id: string };

/** The outcome of one review action (approve, reject, suspend, reactivate). */
export type ReviewOutcome =
  | { ok: true }
  | { ok: false; problem: "not_found" | "already_reviewed" | "identity_taken" | "invalid_reason" | "unavailable"; message: string };

const REVIEW_MESSAGES = {
  not_found: "This registration no longer exists. Refresh the page.",
  already_reviewed: "This registration was already reviewed. Refresh the page to see its current status.",
  identity_taken: "Another account already uses this email or username, so this registration cannot be approved.",
  unavailable: "The change could not be saved. Please try again.",
} as const;

// The columns every list needs (the password hash is never selected).
const ROW_SELECT = {
  id: true,
  fullName: true,
  email: true,
  username: true,
  accountType: true,
  status: true,
  createdAt: true,
  reviewedAt: true,
  reviewedByType: true,
  rejectionReason: true,
  reviewRequestedAt: true,
  reviewRequestMessage: true,
  user: { select: { status: true } },
} as const satisfies Prisma.CustomerRegistrationSelect;

type SelectedRow = Prisma.CustomerRegistrationGetPayload<{ select: typeof ROW_SELECT }>;

// ---------------------------------------------------------------------------
// Helpers

/**
 * Description: Write an audit event for a tenant-database change that already committed.
 * Input: The audit fields (tenant, actor, action, target, metadata, address).
 * Output: Nothing. The registration lives in the tenant database and the audit
 *   log in the control plane, so they cannot share one transaction: the event
 *   is written right after the commit and a failure is only logged.
 * Use case: Every write of this module.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
async function auditAfterCommit(entry: {
  tenantId: string;
  actor: RegistrationActor | null;
  action: AuditAction;
  targetId: string;
  metadata?: AuditMetadata;
  ipAddress?: string | null;
}): Promise<void> {
  try {
    await recordAudit(getControlDb(), {
      // Platform Owners are "super_admin", tenant staff "tenant_user", the public "system".
      actorType: entry.actor?.type === "platform_owner" ? "super_admin" : entry.actor ? "tenant_user" : "system",
      actorId: entry.actor?.id ?? null,
      tenantId: entry.tenantId,
      action: entry.action,
      targetType: entry.action.startsWith("customer_account") ? "customer_account" : "customer_registration",
      targetId: entry.targetId,
      metadata: entry.metadata,
      ipAddress: entry.ipAddress,
    });
  } catch (error) {
    console.error(`[registrations] tenant ${entry.tenantId}: audit "${entry.action}" not written: ${describeError(error)}`);
  }
}

/**
 * Description: Tell whether an error is a violated unique constraint.
 * Input: Any thrown value.
 * Output: True for Prisma's P2002.
 * Use case: Sign-up and approval races that the lock did not prevent.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === UNIQUE_VIOLATION;
}

/**
 * Description: Work out the status a registration row shows.
 * Input: The selected row (registration status, review request, account status).
 * Output: pending, review_requested, active, suspended or rejected.
 * Use case: toRow (lists and popups).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function displayStatus(row: SelectedRow): RegistrationDisplayStatus {
  if (row.status === "pending") return row.reviewRequestedAt ? "review_requested" : "pending";
  if (row.status === "rejected") return "rejected";
  return row.user?.status === "active" ? "active" : "suspended";
}

/**
 * Description: Turn a selected registration into the list shape.
 * Input: The selected row.
 * Output: A RegistrationRow with ISO dates and a readable reviewer.
 * Use case: listRegistrations and listRecentRegistrations.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function toRow(row: SelectedRow): RegistrationRow {
  const reviewedBy =
    row.reviewedByType === "platform_owner"
      ? "Platform Owner"
      : row.reviewedByType === "tenant_user"
        ? "Tenant administrator"
        : null;
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    username: row.username,
    accountType: row.accountType,
    status: displayStatus(row),
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewedBy,
    rejectionReason: row.rejectionReason,
    reviewRequestedAt: row.reviewRequestedAt?.toISOString() ?? null,
    reviewRequestMessage: row.reviewRequestMessage,
  };
}

/**
 * Description: Build the database filter of a list status.
 * Input: The status filter.
 * Output: The Prisma where-condition ("active"/"suspended" look at the account).
 * Use case: listRegistrations and getRegistrationSummary (same definitions everywhere).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function statusWhere(filter: RegistrationFilter): Prisma.CustomerRegistrationWhereInput {
  if (filter === "pending") return { status: "pending" };
  if (filter === "rejected") return { status: "rejected" };
  if (filter === "active") return { status: "approved", user: { is: { status: "active" } } };
  if (filter === "suspended") return { status: "approved", user: { is: { status: { not: "active" } } } };
  return {};
}

/**
 * Description: Build the database filter of a search text.
 * Input: The trimmed search text ("" for none).
 * Output: A case-insensitive match on full name, email or username (Prisma
 *   escapes LIKE wildcards in `contains`), or no condition.
 * Use case: listRegistrations.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function searchWhere(q: string): Prisma.CustomerRegistrationWhereInput {
  if (!q) return {};
  const lower = q.toLowerCase();
  return {
    OR: [
      { fullName: { contains: q, mode: "insensitive" } },
      { email: { contains: lower } },
      { username: { contains: lower } },
    ],
  };
}

// ---------------------------------------------------------------------------
// Lists and counts (database-level filtering, search and pagination)

/**
 * Description: List one page of a tenant's registrations.
 * Input: The tenant database and the list query (search, status, page).
 * Output: The rows (newest first), the total and the page count; a page beyond
 *   the end shows the last page.
 * Use case: The registrations pages and the count-details popups.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function listRegistrations(db: TenantDb, query: RegistrationListQuery): Promise<RegistrationPage> {
  const where: Prisma.CustomerRegistrationWhereInput = { AND: [statusWhere(query.status), searchWhere(query.q)] };

  // Step 1: how many match (decides the page count).
  const total     = await db.customerRegistration.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / REGISTRATION_PAGE_SIZE));
  const page      = Math.min(query.page, pageCount);

  // Step 2: only the requested page leaves the database.
  const rows = await db.customerRegistration.findMany({
    where,
    select: ROW_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * REGISTRATION_PAGE_SIZE,
    take: REGISTRATION_PAGE_SIZE,
  });

  return { rows: rows.map(toRow), total, page, pageCount, pageSize: REGISTRATION_PAGE_SIZE };
}

/**
 * Description: Count a tenant's registrations by status.
 * Input: The tenant database.
 * Output: Pending, active, suspended and rejected counts and their total.
 * Use case: Summary cards (each opens the exact records) and the tenant dashboard.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function getRegistrationSummary(db: TenantDb): Promise<RegistrationSummary> {
  // One readable count per figure, with the same conditions as the list filters.
  const pending   = await db.customerRegistration.count({ where: statusWhere("pending") });
  const active    = await db.customerRegistration.count({ where: statusWhere("active") });
  const suspended = await db.customerRegistration.count({ where: statusWhere("suspended") });
  const rejected  = await db.customerRegistration.count({ where: statusWhere("rejected") });
  return { pending, active, suspended, rejected, total: pending + active + suspended + rejected };
}

/**
 * Description: List the newest registrations.
 * Input: The tenant database and how many (default 5).
 * Output: The newest rows.
 * Use case: The tenant dashboard's "Recent registrations" table.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function listRecentRegistrations(db: TenantDb, limit = 5): Promise<RegistrationRow[]> {
  const rows = await db.customerRegistration.findMany({
    select: ROW_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return rows.map(toRow);
}

// ---------------------------------------------------------------------------
// Public sign-up

export type SignupResult =
  | { ok: true }
  | { ok: false; reason: "validation"; fieldErrors: SignupFieldErrors }
  /** The applicant's own earlier request was rejected (password matched). */
  | { ok: false; reason: "rejected"; rejectionReason: string | null }
  | { ok: false; reason: "rate_limited" | "unavailable" };

const SIGNUP_CONFLICT_MESSAGES = {
  emailAccount: "An account with this email already exists. Log in instead.",
  usernameAccount: "This username is already taken. Choose another one.",
  emailPending: "A registration with this email is already waiting for approval.",
  usernamePending: "A registration with this username is already waiting for approval.",
  emailRejected: "A registration with this email was not approved. Log in with its password to see the reason and request a review.",
  usernameRejected: "A registration with this username was not approved. Log in with its password to see the reason and request a review.",
} as const;

/**
 * Description: Find what would make a sign-up a duplicate.
 * Input: The tenant database and the validated sign-up values.
 * Output: Field errors for taken emails/usernames (accounts, pending or rejected
 *   requests), or the rejection reason when the applicant's own rejected request
 *   matches this password (owner decision: the reason is shown only then).
 * Use case: submitRegistration, before and (after a race) instead of the insert.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
async function findSignupConflicts(
  db: TenantDb,
  value: ValidSignup,
): Promise<{ fieldErrors: SignupFieldErrors; rejectedReason?: string | null }> {
  const fieldErrors: SignupFieldErrors = {};
  const match = [{ email: value.email }, { username: value.username }];

  // Step 1: existing accounts (tenant staff and customers).
  const users = await db.user.findMany({ where: { OR: match }, select: { email: true, username: true } });
  for (const user of users) {
    if (user.email === value.email) fieldErrors.email = SIGNUP_CONFLICT_MESSAGES.emailAccount;
    if (user.username === value.username) fieldErrors.username = SIGNUP_CONFLICT_MESSAGES.usernameAccount;
  }

  // Step 2: open requests (pending or rejected).
  const open = await db.customerRegistration.findMany({
    where: { status: { in: ["pending", "rejected"] }, OR: match },
    select: { email: true, username: true, status: true, passwordHash: true, rejectionReason: true },
  });
  for (const request of open) {
    if (request.status === "rejected" && (await verifyPassword(request.passwordHash, value.password))) {
      // The applicant's own rejected request: show its reason, never sign up again.
      return { fieldErrors: {}, rejectedReason: request.rejectionReason };
    }
    const pending = request.status === "pending";
    if (request.email === value.email) {
      fieldErrors.email ??= pending ? SIGNUP_CONFLICT_MESSAGES.emailPending : SIGNUP_CONFLICT_MESSAGES.emailRejected;
    }
    if (request.username === value.username) {
      fieldErrors.username ??= pending
        ? SIGNUP_CONFLICT_MESSAGES.usernamePending
        : SIGNUP_CONFLICT_MESSAGES.usernameRejected;
    }
  }
  return { fieldErrors };
}

/**
 * Description: Store a public customer sign-up as a pending registration.
 * Input: The tenant database and id, the submitted fields (untrusted) and the
 *   client address.
 * Output: ok, field errors, the applicant's earlier rejection reason, or
 *   rate_limited/unavailable. Never creates a user and never signs anyone in.
 * Use case: signupAction (/customer/signup).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function submitRegistration(
  db: TenantDb,
  tenantId: string,
  input: Record<string, unknown>,
  clientIp: string,
): Promise<SignupResult> {
  // Step 1: validate every field (same rules as the form).
  const validation = validateSignupFields({
    fullName: textOf(input.fullName),
    accountType: textOf(input.accountType),
    email: textOf(input.email),
    username: textOf(input.username),
    password: textOf(input.password),
    confirmPassword: textOf(input.confirmPassword),
  });
  if (!validation.ok) return { ok: false, reason: "validation", fieldErrors: validation.fieldErrors };
  const value = validation.value;

  // Step 2: rate limit per tenant and client address (fail closed).
  const limit = await consumeRateLimit({
    key: `ws-signup:${tenantId}:ip:${clientIp}`,
    limit: SIGNUP_LIMIT,
    windowSeconds: SIGNUP_WINDOW_SECONDS,
  });
  if (limit === "unavailable") return { ok: false, reason: "unavailable" };
  if (limit === "limited") return { ok: false, reason: "rate_limited" };

  try {
    // Step 3: duplicates (accounts, pending requests, the applicant's own rejected request).
    const conflicts = await findSignupConflicts(db, value);
    if (conflicts.rejectedReason !== undefined) {
      return { ok: false, reason: "rejected", rejectionReason: conflicts.rejectedReason };
    }
    if (Object.keys(conflicts.fieldErrors).length > 0) {
      return { ok: false, reason: "validation", fieldErrors: conflicts.fieldErrors };
    }

    // Step 4: hash outside the transaction (Argon2 is deliberately slow).
    const passwordHash = await hashPassword(value.password);

    // Step 5: insert under the identity lock, re-checking inside it.
    const createdId = await db.$transaction(async (tx) => {
      await lockWorkspaceIdentities(tx);
      const match     = [{ email: value.email }, { username: value.username }];
      const userTaken = await tx.user.count({ where: { OR: match } });
      const openTaken = await tx.customerRegistration.count({
        where: { status: { in: ["pending", "rejected"] }, OR: match },
      });
      if (userTaken > 0 || openTaken > 0) return null;

      const created = await tx.customerRegistration.create({
        data: {
          fullName: value.fullName,
          email: value.email,
          username: value.username,
          passwordHash,
          accountType: value.accountType,
          status: "pending",
        },
        select: { id: true },
      });
      return created.id;
    });

    // Someone claimed the email/username between step 3 and step 5.
    if (!createdId) {
      const again = await findSignupConflicts(db, value);
      return { ok: false, reason: "validation", fieldErrors: again.fieldErrors };
    }

    // Step 6: audit (no personal data in the metadata).
    await auditAfterCommit({
      tenantId,
      actor: null,
      action: "customer_registration.submitted",
      targetId: createdId,
      metadata: { accountType: value.accountType },
      ipAddress: clientIp,
    });
    console.log(`[registrations] tenant ${tenantId}: registration ${createdId} submitted`);
    return { ok: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "validation", fieldErrors: { email: SIGNUP_CONFLICT_MESSAGES.emailPending } };
    }
    console.error(`[registrations] tenant ${tenantId}: sign-up failed: ${describeError(error)}`);
    return { ok: false, reason: "unavailable" };
  }
}

// ---------------------------------------------------------------------------
// Review: approve and reject

/**
 * Description: Explain why a conditional status change touched no row.
 * Input: The tenant database and the registration id.
 * Output: "not_found" when the registration is gone, else "already_reviewed".
 * Use case: Every review action after its conditional update found nothing to change.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
async function missedChange(db: TenantDb, registrationId: string): Promise<ReviewOutcome> {
  const exists = await db.customerRegistration.count({ where: { id: registrationId } });
  const problem = exists === 0 ? "not_found" : "already_reviewed";
  return { ok: false, problem, message: REVIEW_MESSAGES[problem] };
}

/**
 * Description: Approve a pending registration: create the customer and its user.
 * Input: The tenant database and id, the registration id, the reviewer and the client address.
 * Output: ok, or why not (not found, already reviewed, email/username now taken,
 *   unavailable). One transaction: the customer, the user (same password hash,
 *   primary account of the customer), the user's Master Customer role and the
 *   registration's new status are written together or not at all.
 * Use case: Approve buttons of the tenant and Platform Owner registrations pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-16
 */
export async function approveRegistration(
  db: TenantDb,
  tenantId: string,
  registrationId: string,
  actor: RegistrationActor,
  clientIp: string | null,
): Promise<ReviewOutcome> {
  if (!isUuid(registrationId)) return { ok: false, problem: "not_found", message: REVIEW_MESSAGES.not_found };

  try {
    const outcome = await db.$transaction(async (tx): Promise<ReviewOutcome | "approved"> => {
      // Step 1: the identity lock (sign-ups wait until this approval is done).
      await lockWorkspaceIdentities(tx);

      // Step 2: the registration must still be pending.
      const registration = await tx.customerRegistration.findUnique({
        where: { id: registrationId },
        select: { status: true, fullName: true, email: true, username: true, passwordHash: true, accountType: true },
      });
      if (!registration) return { ok: false, problem: "not_found", message: REVIEW_MESSAGES.not_found };
      if (registration.status !== "pending") {
        return { ok: false, problem: "already_reviewed", message: REVIEW_MESSAGES.already_reviewed };
      }

      // Step 3: the email and username must still be free.
      const taken = await tx.user.count({
        where: { OR: [{ email: registration.email }, { username: registration.username }] },
      });
      if (taken > 0) return { ok: false, problem: "identity_taken", message: REVIEW_MESSAGES.identity_taken };

      // Step 3b: the Master Customer role (by its protected system key). Every
      // tenant database has it (rbac migration); without it nothing is written.
      const masterCustomer = await tx.role.findUnique({
        where: { systemKey: MASTER_SYSTEM_KEYS.customer },
        select: { id: true },
      });
      if (!masterCustomer) throw new Error("the Master Customer role is missing");

      // Step 4: the customer account (its category is the chosen account type).
      const customer = await tx.customer.create({
        data: { type: registration.accountType, name: registration.fullName, status: "active" },
        select: { id: true },
      });

      // Step 5: the customer's user, signing in with the password chosen at sign-up.
      const user = await tx.user.create({
        data: {
          email: registration.email,
          username: registration.username,
          passwordHash: registration.passwordHash,
          name: registration.fullName,
          status: "active",
          customerId: customer.id,
          // The main customer's own user is its primary account.
          isPrimary: true,
        },
        select: { id: true },
      });

      // Step 5b: the user's single role — Master Customer.
      await tx.userRole.create({ data: { userId: user.id, roleId: masterCustomer.id } });

      // Step 6: mark the registration approved (conditional: never twice).
      const updated = await tx.customerRegistration.updateMany({
        where: { id: registrationId, status: "pending" },
        data: {
          status: "approved",
          userId: user.id,
          reviewedAt: new Date(),
          reviewedByType: actor.type,
          reviewedById: actor.id,
        },
      });
      if (updated.count !== 1) throw new Error("registration changed during approval");

      // The applicant's limited sessions end: they now sign in normally.
      await tx.registrationSession.deleteMany({ where: { registrationId } });
      return "approved";
    });
    if (outcome !== "approved") return outcome;

    await auditAfterCommit({ tenantId, actor, action: "customer_registration.approved", targetId: registrationId, ipAddress: clientIp });
    console.log(`[registrations] tenant ${tenantId}: registration ${registrationId} approved by ${actor.type}`);
    return { ok: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, problem: "identity_taken", message: REVIEW_MESSAGES.identity_taken };
    }
    console.error(`[registrations] tenant ${tenantId}: approval failed: ${describeError(error)}`);
    return { ok: false, problem: "unavailable", message: REVIEW_MESSAGES.unavailable };
  }
}

/**
 * Description: Reject a pending registration with a reason the applicant will see.
 * Input: The tenant database and id, the registration id, the typed reason,
 *   the reviewer and the client address.
 * Output: ok, or why not (invalid reason, not found, already reviewed, unavailable).
 * Use case: Reject confirmation dialogs of both registrations pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function rejectRegistration(
  db: TenantDb,
  tenantId: string,
  registrationId: string,
  reasonInput: unknown,
  actor: RegistrationActor,
  clientIp: string | null,
): Promise<ReviewOutcome> {
  if (!isUuid(registrationId)) return { ok: false, problem: "not_found", message: REVIEW_MESSAGES.not_found };
  const reason = validateRejectionReason(textOf(reasonInput));
  if (!reason.ok) return { ok: false, problem: "invalid_reason", message: reason.error };

  try {
    // Conditional update: only a pending registration changes, exactly once.
    const updated = await db.customerRegistration.updateMany({
      where: { id: registrationId, status: "pending" },
      data: {
        status: "rejected",
        rejectionReason: reason.value,
        reviewedAt: new Date(),
        reviewedByType: actor.type,
        reviewedById: actor.id,
      },
    });
    if (updated.count !== 1) return missedChange(db, registrationId);

    await auditAfterCommit({ tenantId, actor, action: "customer_registration.rejected", targetId: registrationId, ipAddress: clientIp });
    console.log(`[registrations] tenant ${tenantId}: registration ${registrationId} rejected by ${actor.type}`);
    return { ok: true };
  } catch (error) {
    console.error(`[registrations] tenant ${tenantId}: rejection failed: ${describeError(error)}`);
    return { ok: false, problem: "unavailable", message: REVIEW_MESSAGES.unavailable };
  }
}

// ---------------------------------------------------------------------------
// Customer account: suspend and reactivate

/**
 * Description: Suspend or reactivate the customer account of an approved registration.
 * Input: The tenant database and id, the registration id, the change, the
 *   reviewer and the client address.
 * Output: ok, or why not. The user and its main customer row change together
 *   (disabled / active), so every sub-customer of that customer is refused on
 *   its next request too. Suspending also deletes the user's sessions, so
 *   access ends immediately (the session check also refuses suspended users).
 * Use case: Suspend / Reactivate on both registrations pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-16
 */
export async function setCustomerAccountStatus(
  db: TenantDb,
  tenantId: string,
  registrationId: string,
  change: "suspend" | "reactivate",
  actor: RegistrationActor,
  clientIp: string | null,
): Promise<ReviewOutcome> {
  if (!isUuid(registrationId)) return { ok: false, problem: "not_found", message: REVIEW_MESSAGES.not_found };
  const from = change === "suspend" ? "active" : "disabled";
  const to   = change === "suspend" ? "disabled" : "active";

  try {
    const changed = await db.$transaction(async (tx) => {
      // Step 1: the account created when this registration was approved.
      const registration = await tx.customerRegistration.findUnique({
        where: { id: registrationId },
        select: { status: true, userId: true, user: { select: { customerId: true } } },
      });
      if (!registration || registration.status !== "approved" || !registration.userId) return false;

      // Step 2: conditional status change (never applied twice).
      const updated = await tx.user.updateMany({
        where: { id: registration.userId, status: from, customerId: { not: null } },
        data: { status: to },
      });
      if (updated.count !== 1) return false;

      // Step 2b: the main customer row follows (account lifecycle rule of the
      // RBAC spec): its sub-customers are refused while it is disabled.
      const customerId = registration.user?.customerId;
      if (customerId) {
        await tx.customer.updateMany({ where: { id: customerId, parentId: null }, data: { status: to } });
      }

      // Step 3: a suspension ends every open session of that user right away.
      if (change === "suspend") await tx.userSession.deleteMany({ where: { userId: registration.userId } });
      return true;
    });
    if (!changed) return missedChange(db, registrationId);

    const action = change === "suspend" ? "customer_account.suspended" : "customer_account.reactivated";
    await auditAfterCommit({ tenantId, actor, action, targetId: registrationId, ipAddress: clientIp });
    console.log(`[registrations] tenant ${tenantId}: account of registration ${registrationId} ${change}d by ${actor.type}`);
    return { ok: true };
  } catch (error) {
    console.error(`[registrations] tenant ${tenantId}: account ${change} failed: ${describeError(error)}`);
    return { ok: false, problem: "unavailable", message: REVIEW_MESSAGES.unavailable };
  }
}

// ---------------------------------------------------------------------------
// The applicant's review request

export type ReviewRequestResult =
  | { ok: true }
  | { ok: false; reason: "validation"; error: string }
  | { ok: false; reason: "not_rejected" | "rate_limited" | "unavailable" };

/**
 * Description: Ask the tenant to review a rejected registration again.
 * Input: The tenant database and id, the applicant's registration id (from
 *   their verified registration session, never from the form), the optional
 *   message and the client address.
 * Output: ok (the registration is pending again, marked "review requested"),
 *   or why not (message too long, not rejected any more, rate limited, unavailable).
 * Use case: requestReviewAction (/customer/registration).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function requestRegistrationReview(
  db: TenantDb,
  tenantId: string,
  registrationId: string,
  messageInput: unknown,
  clientIp: string,
): Promise<ReviewRequestResult> {
  // Step 1: the optional message.
  const message = validateReviewMessage(textOf(messageInput));
  if (!message.ok) return { ok: false, reason: "validation", error: message.error };

  // Step 2: a few requests per day per registration.
  const limit = await consumeRateLimit({
    key: `ws-review:${tenantId}:${registrationId}`,
    limit: REVIEW_LIMIT,
    windowSeconds: REVIEW_WINDOW_SECONDS,
  });
  if (limit === "unavailable") return { ok: false, reason: "unavailable" };
  if (limit === "limited") return { ok: false, reason: "rate_limited" };

  try {
    // Step 3: only a rejected registration goes back to pending (one open request at a time).
    const updated = await db.customerRegistration.updateMany({
      where: { id: registrationId, status: "rejected" },
      data: { status: "pending", reviewRequestedAt: new Date(), reviewRequestMessage: message.value },
    });
    if (updated.count !== 1) return { ok: false, reason: "not_rejected" };

    await auditAfterCommit({
      tenantId,
      actor: null,
      action: "customer_registration.review_requested",
      targetId: registrationId,
      metadata: { withMessage: message.value !== null },
      ipAddress: clientIp,
    });
    console.log(`[registrations] tenant ${tenantId}: review requested for registration ${registrationId}`);
    return { ok: true };
  } catch (error) {
    console.error(`[registrations] tenant ${tenantId}: review request failed: ${describeError(error)}`);
    return { ok: false, reason: "unavailable" };
  }
}
