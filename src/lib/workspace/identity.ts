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
  const conflicts: IdentityConflicts = {};

  // Step 1: the conditions to look for (nothing to check → nothing taken).
  // Plain { column: value } conditions fit both the users and the registrations table.
  const match: ({ email: string } | { username: string })[] = [];
  if (identity.email) match.push({ email: identity.email });
  if (identity.username) match.push({ username: identity.username });
  if (match.length === 0) return conflicts;

  // Step 2: existing accounts (tenant staff and customers), except the edited user.
  const users = await tx.user.findMany({
    where: { OR: match, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
    select: { email: true, username: true },
  });
  for (const user of users) {
    if (identity.email && user.email === identity.email) conflicts.email = "account";
    if (identity.username && user.username === identity.username) conflicts.username = "account";
  }

  // Step 3: open registrations (pending or rejected) still hold their identity.
  const open = await tx.customerRegistration.findMany({
    where: { status: { in: ["pending", "rejected"] }, OR: match },
    select: { email: true, username: true, status: true },
  });
  for (const request of open) {
    const claim: IdentityClaim = request.status === "pending" ? "pending" : "rejected";
    if (identity.email && request.email === identity.email) conflicts.email ??= claim;
    if (identity.username && request.username === identity.username) conflicts.username ??= claim;
  }
  return conflicts;
}
