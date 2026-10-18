import "server-only";
/**
 * Email / username claims inside ONE tenant database
 * (.vibe/memory/customer-registration.md, role-privilege-management.md
 * "Sub-users").
 *
 * Every write that can claim an email or a username in a tenant database —
 * public sign-up, registration approval, and the creation / email change of
 * Sub-Tenants and Sub-Customers — runs under the same transaction-level
 * advisory lock, so two of them can never claim the same identity at once.
 * The database UNIQUE constraints on users.email / users.username stay the
 * final guard.
 */
import type { Client } from "pg";
import type { Prisma } from "@/generated/prisma/tenant/client";

/**
 * The advisory lock id shared by every identity-claiming write of a tenant
 * database. Any constant works; it only has to be the same everywhere (the
 * registration flow used this value before it moved here).
 */
export const IDENTITY_LOCK_ID = 7_324_515_001;

/** Where a taken email or username is already used. */
export type IdentityClaim = "account" | "pending" | "rejected";

/** What is taken: per field, the claim that holds it (absent = free). */
export type IdentityConflicts = { email?: IdentityClaim; username?: IdentityClaim };

/**
 * What a taken identity says under its field, per kind of claim. One wording
 * for every form that claims an identity (Sub-Tenants, Sub-Customers and the
 * tenant's Customers module), so the same conflict always reads the same.
 */
export const IDENTITY_CONFLICT_MESSAGES: Record<"username" | "email", Record<IdentityClaim, string>> = {
  username: {
    account: "This username is already taken. Choose another one.",
    pending: "A pending customer registration already uses this username. Choose another one.",
    rejected: "A customer registration already uses this username. Choose another one.",
  },
  email: {
    account: "Another account already uses this email address.",
    pending: "A pending customer registration already uses this email address.",
    rejected: "A customer registration already uses this email address.",
  },
};

/**
 * Description: Take the tenant database's identity lock for the current transaction.
 * Input: The interactive transaction (tenant database).
 * Output: Nothing. Blocks until no other identity-claiming transaction holds the
 *   lock; released automatically at commit or rollback.
 * Use case: submitRegistration, approveRegistration and the sub-user service.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function lockWorkspaceIdentities(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${IDENTITY_LOCK_ID}::bigint)`;
}

/**
 * Description: Find which of an email / username is already claimed in a tenant database.
 * Input: The transaction (or client), the normalized email and/or username to
 *   check (omitted fields are not checked) and, on edit, the user to ignore.
 * Output: Per field: "account" (a user already has it), "pending" or
 *   "rejected" (an open customer registration holds it); absent when free.
 *   Approved registrations are covered by their user.
 * Use case: Sub-Tenant / Sub-Customer create and email change (under the lock).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function findIdentityConflicts(
  tx: Pick<Prisma.TransactionClient, "user" | "customerRegistration">,
  identity: { email?: string; username?: string },
  excludeUserId: string | null = null,
): Promise<IdentityConflicts> {
  // Step 1: select only requested identity fields; an omitted field is not checked.
  const match: ({ email: string } | { username: string })[] = [];
  if (identity.email) match.push({ email: identity.email });
  if (identity.username) match.push({ username: identity.username });
  if (match.length === 0) return {};

  // Step 2: accounts hold their names, excluding the edited immutable user.
  const users = await tx.user.findMany({
    where: { OR: match, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
    select: { email: true, username: true },
  });
  // Step 3: pending and rejected applicants still reserve both names.
  const open = await tx.customerRegistration.findMany({
    where: { status: { in: ["pending", "rejected"] }, OR: match },
    select: { email: true, username: true, status: true },
  });
  return classifyIdentityConflicts(identity, users, open);
}

/**
 * Description: Apply the same reservation policy on a short-lived pg connection.
 * Input: The identity-locked transaction, candidate names and excluded immutable user ID.
 * Output: The account/pending/rejected claims for each requested identity field.
 * Use case: Platform changes to a tenant administrator's names.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export async function findIdentityConflictsWithSql(
  client: Pick<Client, "query">,
  identity: { email?: string; username?: string },
  excludeUserId: string,
): Promise<IdentityConflicts> {
  if (!identity.email && !identity.username) return {};
  const values = [identity.email ?? null, identity.username ?? null, excludeUserId];
  const users = await client.query<{ email: string; username: string | null }>(
    "SELECT email, username FROM users WHERE (email = $1 OR username = $2) AND id <> $3", values,
  );
  const open = await client.query<{ email: string; username: string; status: string }>(
    `SELECT email, username, status::text FROM customer_registrations
     WHERE status IN ('pending', 'rejected') AND (email = $1 OR username = $2)`, values.slice(0, 2),
  );
  return classifyIdentityConflicts(identity, users.rows, open.rows);
}

/**
 * Description: Classify fetched identity claims with account precedence and shared policy.
 * Input: Candidate fields, matching accounts and open registrations.
 * Output: The claim that reserves each candidate; absent means available.
 * Use case: Share policy between Prisma workspace writes and short-lived pg admin writes.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
function classifyIdentityConflicts(
  identity: { email?: string; username?: string },
  users: { email: string; username: string | null }[],
  open: { email: string; username: string; status: string }[],
): IdentityConflicts {
  const conflicts: IdentityConflicts = {};
  for (const user of users) {
    if (identity.email && user.email === identity.email) conflicts.email = "account";
    if (identity.username && user.username === identity.username) conflicts.username = "account";
  }
  for (const request of open) {
    const claim: IdentityClaim = request.status === "pending" ? "pending" : "rejected";
    if (identity.email && request.email === identity.email) conflicts.email ??= claim;
    if (identity.username && request.username === identity.username) conflicts.username ??= claim;
  }
  return conflicts;
}

/**
 * Description: Turn taken identities into the messages shown under their fields.
 * Input: The conflicts found by findIdentityConflicts.
 * Output: One message per taken field ({} when nothing is taken).
 * Use case: The sub-user service (create / email change) and the tenant's
 *   customer creation (src/lib/workspace/customers.ts).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export function identityConflictErrors(conflicts: IdentityConflicts): { username?: string; email?: string } {
  const errors: { username?: string; email?: string } = {};
  if (conflicts.username) errors.username = IDENTITY_CONFLICT_MESSAGES.username[conflicts.username];
  if (conflicts.email) errors.email = IDENTITY_CONFLICT_MESSAGES.email[conflicts.email];
  return errors;
}
