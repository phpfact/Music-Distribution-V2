# Customer Registration and Approval

## Overview

- **Name:** Customer registration (public sign-up) with mandatory approval.
- **Purpose:** artists, labels and white-label partners can request an account
  on a tenant's portal; nobody gets access until the tenant administrator or
  a Platform Owner approves the request.
- **Business goal:** tenants grow their customer base themselves while staying
  in control of who may use their portal.
- **Status:** implemented 2026-10-15 (first version).

## Decisions confirmed with the owner (2026-10-15)

- Only **customers** can sign up (`/customer/signup`). Tenant admin,
  sub-admin and tenant accounts never have a public sign-up.
- The sign-up form asks for the **account type**: Artist, Label or White
  Label (the existing tenant `customer_type` enum).
- Approval authorities: the tenant administrator (`/tenant/registrations`,
  own tenant only) and any Platform Owner
  (`/platform/tenants/<id>/registrations`).
- Rejection needs a **reason**. A rejected applicant can NOT sign up again
  with the same email/username; the sign-up shows the rejection reason only
  when the submitted password matches that rejected request (otherwise a
  generic "not approved — log in to see the reason" message), so nobody can
  read someone else's reason by typing their email.
- A rejected applicant can **log in** (limited registration session, no
  dashboard) to see the reason and send a **review request** with an
  optional message (max 1000 characters). The request returns to
  "Pending (review requested)". One open request at a time.

## User flow (applicant)

1. Welcome page → "Sign up" → `/customer/signup` (workspace default theme).
2. Sections: **Personal Information** (full name, account type) and **Login
   Information** (email, username, password, confirm password with live
   checklist). Client validation on blur/typing/submit; first invalid field
   scrolled into view and focused; values kept after server errors (never the
   passwords).
3. Submit → registration stored as `pending` → confirmation panel: "awaiting
   approval"; no session, no dashboard access.
4. Login while pending → "awaiting approval" message.
5. Approved → normal customer sign-in to `/customer/dashboard`.
6. Rejected → login opens `/customer/registration`: reason, status, optional
   review request form; after sending, status shows "review requested".

## Admin flow (tenant administrator and Platform Owner)

- Registrations page: summary counts (Pending, Active, Suspended, Rejected,
  Total — each opens a details popup with the exact records and the
  calculation), search (name, email, username), status filter, server-side
  pagination (20 per page), URL-preserved filters.
- Actions with confirmation dialogs: Approve (pending), Reject (pending,
  reason required 3–500 characters), Suspend (active account), Reactivate
  (suspended account).
- Approve = one tenant-database transaction: lock the registration, re-check
  email/username are free, create the `customers` row (type, name, active)
  and the `users` row (status active, linked to the customer, same password
  hash), mark the registration `approved` with reviewer and time.
- Suspend deletes the user's sessions immediately; Reactivate restores access.

## Business rules

- Uniqueness inside one tenant: email and username must not belong to any
  user or to any pending/rejected registration (checked in the service under
  a transaction-level advisory lock, plus partial UNIQUE indexes on the
  registration table for pending/rejected rows and the users table's own
  UNIQUE constraints). The lock lives in `src/lib/workspace/identity.ts`
  (`lockWorkspaceIdentities`, same lock id as before) and is shared with the
  Sub-Tenant / Sub-Customer creation of role-privilege-management.md.
- Status transitions are conditional updates (`WHERE status = 'pending'`
  etc.), so repeated or concurrent approvals/rejections are reported as
  "already reviewed" and never applied twice.
- Pending/rejected applicants have NO `users` row: they cannot have a
  dashboard session at all.
- Approval also gives the new customer user the Master Customer role (found
  by system key `master_customer`) and marks it the customer's primary
  account, in the same transaction (role-privilege-management.md).
- Suspending / reactivating an approved account also sets the main customer
  row `disabled` / `active`, so every sub-customer of that customer is
  refused on its next request.
- A tenant administrator only ever reaches the database of the tenant
  resolved from the Host header, so registrations of another tenant do not
  exist for them; a Platform Owner selects the tenant by id on the server.
- Audit: every submission, approval, rejection, review request, suspension
  and reactivation is written to the control-plane `audit_events`
  (actor: `super_admin` for Platform Owners, `tenant_user` for tenant staff,
  `system` for public submissions; metadata never holds personal data or
  secrets). Written after the tenant-database commit (two databases cannot
  share one transaction); a failed audit write is logged.

## Validations

- Full name: existing tenant name rule (letters, spaces, . ' - &, 2–200).
- Email: existing rule (normalized lower-case, max 320).
- Username: existing tenant username rule (3–64, a-z 0-9 . _ -).
- Password: existing master-password rule (12–256 characters, 2 character
  classes, must not contain the username) + confirm must match.
- Account type: artist | label | white_label.
- Rejection reason: required, 3–500 characters after trimming.
- Review message: optional, max 1000 characters.
- Rate limits: sign-up 5 per IP per hour per tenant; review requests 3 per
  registration per day.

## Database (tenant database, migration `*_tenant_portal`)

- New enum `registration_status` (pending, approved, rejected).
- `customer_registrations`: id, full_name, email (lower-case CHECK), username
  (format CHECK), password_hash, account_type (`customer_type`), status,
  rejection_reason, review_request_message, review_requested_at, reviewed_at,
  reviewed_by_type ('platform_owner' | 'tenant_user' CHECK), reviewed_by_id,
  user_id (→ users, UNIQUE), created_at, updated_at. Partial UNIQUE indexes on
  email and username WHERE status <> 'approved'; CHECKs: rejected ⇒ reason,
  approved ⇒ user_id. Index (status, created_at).

## Security

- Every action checks on the server: Platform Owner session (platform
  pages) or tenant staff session + `owner` role (tenant pages). Hidden buttons
  are never the only protection.
- Registration ids are validated as UUIDs; anything else is "not found".
- Emails and usernames are masked in tables/popups with an eye toggle.

## Change history

- 2026-10-15: Module created — owner decisions recorded before
  implementation (customer-only sign-up with account type, rejection reason
  privacy, review requests, approval by tenant admin and Platform Owner).

- 2026-10-16: Implemented as recorded above. Verified: TypeScript, ESLint (0 warnings), full Vitest suite 40 files / 1174 tests passed (new: workspace-rules, workspace-portal with two real provisioned tenants, workspace-http). Browser-verified on a test tenant created in the Platform Owner panel: welcome, login (errors, wrong password, admin by username/email), tenant dashboard, dark theme switch persisting after reload, customer sign-up (validation, pending login blocked), tenant-admin approval, logout + Back, customer dashboard, customer blocked from /tenant, Platform Owner registrations page (count popup, reject with reason), rejected login -> status page -> review request, Platform Owner suspension ending the active session. Not browser-verified yet: "Apply to everyone" appearance, phone/tablet layouts.
- 2026-10-16: Browser follow-up checks. "Apply selection to everyone" saved the workspace default (Dark + Emerald) and the public /login page of that tenant switched to it at once, while another tenant (mr-arun) stayed Light / Neutral. Phone (375x812) and tablet (768x1024): welcome, sign-up, login, tenant dashboard, mobile sidebar Sheet (closes on navigation), registrations and appearance pages show no horizontal page overflow. Fixes from these checks: the registrations list shows cards below xl (the table hid Status/Actions behind horizontal scroll next to the sidebar on tablets); the reviewer note reads "Approved by …" so a later suspension is not attributed to the approver.
- 2026-10-16: RBAC foundation: `approveRegistration` writes the user's
  Master Customer role + `is_primary` in its transaction (missing role →
  "unavailable", nothing written); `setCustomerAccountStatus` also switches
  the main customer row. The rbac tenant migration gave existing approved
  users Master Customer + primary and disabled the customer rows of already
  suspended accounts.

## RBAC enforcement (2026-10-16)

- Tenant side: `/tenant/registrations` needs `tenant.registrations.view`
  (inline access-denied otherwise); load → view, approve/reject → review,
  suspend/reactivate customer → suspend, each via `authorizeTenantAction`
  (audited refusal with the friendly message). The tenant owner flag is gone.
- Platform side: the same with `platform.tenant_registrations.*`.
- The shared `RegistrationList` receives `canReview` / `canSuspend` from both
  panels and renders no button the viewer may not use (the server checks again).
- Change history: 2026-10-16 — owner-only checks replaced by privileges.
- Change history: 2026-10-16 — identity advisory lock moved to
  `src/lib/workspace/identity.ts` (shared with sub-user creation); behaviour unchanged.

## Customers module sync (2026-10-17)

- Tenant staff can also create customers directly (`customer-management.md`);
  those have no registration row. Sign-up and created customers share the
  identity rules (one email/username per tenant, the same advisory lock).
- The Customers page can suspend / reactivate a signed-up customer as well
  (by customer id): it switches the same user + main customer rows, so the
  Registrations page shows the same Active / Suspended state.
- The tenant dashboard's "Active customers" figure now comes from the
  Customers module (all active main customers), not from registrations.

## Audit correction (2026-10-17)

- AUD-20261017-011: selecting a status, Clear filters, or navigating to an
  externally changed query invalidates the pending search debounce. A stale
  callback cannot restore an earlier search/status after the newer choice.
