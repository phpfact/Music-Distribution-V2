# Customer Management (tenant panel, `/tenant/customers`)

## Overview

- **Name:** Customer management — the tenant staff's Customers module.
- **Purpose:** tenant staff can see every main customer of their workspace
  and create new customer accounts themselves (artist, label or white-label
  partner), without waiting for a public sign-up and its approval.
- **Business goal:** PRD 4.3/4.5 "Tenant-authorized users can create and
  manage customers"; tenants onboard their customers directly.
- **Status:** implemented 2026-10-17 (first version: list, create,
  suspend/reactivate). Edit is a planned enhancement.

## Decisions confirmed with the owner (2026-10-17)

- A real **Customers module** replaces the `/tenant/customers` "coming soon"
  placeholder: customers list + "Add customer" form
  (`/tenant/customers/new`).
- Scope of the first version: **List + Create + Suspend/Reactivate** (no edit
  yet). A customer created here has no registration row, so this module is
  the only place where it can be suspended.
- **Password:** the tenant sets the initial password (Password + Confirm with
  eye toggles and the shared checklist) and shares it with the customer
  (the project has no email sending). The customer can log in immediately.
- **List scope:** ALL main customers of the tenant — approved sign-ups and
  customers created here — with a "Source" column (Sign-up / Added by
  tenant). Sub-customers are not listed (they belong to their customer's own
  panel). Suspend/Reactivate works for both sources and stays in sync with
  the Registrations page (a suspended signed-up customer shows "Suspended"
  there too).
- **Dashboard:** the tenant dashboard's "Active customers" card now counts
  every active main customer (sign-ups + created here), opens the exact
  customers in its popup and is shown with `tenant.customers.view`. The
  "Pending approvals" card stays on the registrations data.
- Platform Owner creating customers on behalf of a tenant (PRD multi-tenant
  rules § 3) is NOT part of this version; the service already takes a
  `platform_owner | tenant_user` actor so a later task can add it.

## Features

- Current: customers list (summary, search, status filter, server-side
  pagination, masked username/email, source, account type, status),
  "Add customer" form, Suspend / Reactivate with confirmation, dashboard
  "Active customers" figure.
- Future: edit customer (name, account type, new password), Platform Owner
  "on behalf of tenant" creation, sub-customer counts per customer.

## User flow (tenant staff)

1. Sidebar → Business → **Customers** (only with `tenant.customers.view`).
2. Customers page: Summary (Total, Active, Suspended — each opens a popup
   with the exact customers and the calculation), toolbar (search by name,
   username or email; status filter), the directory (table from xl, cards
   below), paging. Filters live in the URL.
3. "Add customer" (only with `tenant.customers.create`) →
   `/tenant/customers/new`: sidebar secondary menu with **Personal
   Information** (Full name *, Account type *), **Login Information**
   (Username *, Email *, Password *, Confirm password *), **Access**
   (read-only: the account becomes the customer's primary account with the
   Master Customer role). Sticky actions "Create customer" → "Creating…".
4. Success → back to `/tenant/customers?notice=customer-created` with a
   success notice; the customer can log in at `/login` right away.
5. Suspend / Reactivate (only with `tenant.customers.suspend`): confirmation
   dialog → the row refreshes without a full page reload.

## Business rules

- A customer created here = one `customers` row (type, name = full name,
  status active, NO parent) + its `users` row (email, username, Argon2id
  hash, name, status active, `customer_id`, `is_primary = true`) + one
  `user_roles` row with the Master Customer role — all in ONE tenant-database
  transaction (same shape as an approved registration, minus the
  registration row).
- Email / username must be free in this tenant: not used by any user (staff
  or customer) and not held by a pending or rejected registration. Checked
  before and again inside the transaction under the shared identity advisory
  lock (`lockWorkspaceIdentities`), plus the database UNIQUE constraints.
- Only the six form fields are read; anything else in the request (role id,
  primary flag, parent id, tenant id, status) is ignored. The role is always
  Master Customer (found by its system key); the account is always primary.
- Suspend = main customer row `disabled` + its users `disabled` + their
  sessions deleted, in one transaction; sub-customers are refused on their
  next request because their main customer is not active (existing session
  rule). Reactivate = customer row + users `active`. Conditional updates: a
  stale page (already suspended / already active) gets "refresh the page".
- Only MAIN customers (`parent_id IS NULL`) are listed or switched here; a
  sub-customer id is "not found".
- The tenant is always the one resolved from the Host header; another
  tenant's customers do not exist for this database.

## Validations

- Frontend and backend use the same rules (`src/lib/workspace/customer-rules.ts`,
  delegating to the Sub-Customer form rules in `src/lib/authz/sub-user-rules.ts`):
  - Full name: required, letters/spaces/`. ' - &`, 2–200 characters.
  - Account type: artist | label | white_label (required).
  - Username: 3–64, lower-case letters, digits, `. _ -` (trimmed).
  - Email: valid, normalized lower-case, max 320 (trimmed).
  - Password: master-password rule (12–256, two character classes, must not
    contain the username); Confirm must match.
- Live validation on blur/typing, first invalid field scrolled into view and
  focused, errors under each field (backend errors too), values kept after
  errors (passwords cleared), duplicate-submit guard, Cancel asks before
  discarding typed values.

## Database

- No schema change. One tenant migration (`20261017090000_tenant_customers`)
  adds the three `tenant.customers.*` privileges to the `permissions` mirror
  (idempotent upsert).
- Reads `customers` (main rows), their users (primary account: email,
  username) and `customer_registrations.user_id` (source = Sign-up when the
  primary user came from an approved registration).

## Authorization (RBAC)

- New tenant-domain module `tenant.customers` ("Customers", not core, so the
  Platform Owner can switch it off per tenant on the tenant details page):
  - `tenant.customers.view` — Customers page, summary popups, dashboard
    "Active customers" card, sidebar link.
  - `tenant.customers.create` — "Add customer" page and action (requires view).
  - `tenant.customers.suspend` — Suspend / Reactivate (requires view).
- Master Tenant gets them automatically (it holds every tenant privilege);
  custom roles only when granted (delegation ceiling of the role editor).
- Every page and Server Action checks its privilege on the server
  (`authorizeTenantAction`, refusal audited as `authz.denied`); pages without
  it show the inline access-denied state.

## APIs (Server Actions, `src/app/(workspace)/tenant/customers/actions.ts`)

- `loadTenantCustomerRecordsAction(filter, page)` → `{ ok, page }` | `{ ok: false, error }` (view).
- `createTenantCustomerAction(state, formData)` → field errors / form message,
  or redirect `/tenant/customers?notice=customer-created` (create).
- `setTenantCustomerStatusAction(customerId, change)` → `{ ok, message }` |
  `{ ok: false, error }`; change = "suspend" | "reactivate" (suspend).

## Security

- Backend enforcement on every action; ids validated as UUIDs; tenant from
  the Host header only; crafted fields ignored; friendly messages only
  (technical errors logged with `[customers]`).
- Audit (control plane, after commit): `customer_account.created` (target
  `customer`, metadata `accountType`), `customer_account.suspended` /
  `customer_account.reactivated` (target `customer`, metadata `via:
  "customers"`). Never names, emails, usernames or passwords in metadata.
- Username and email are masked with an eye toggle in the list, popups and form.

## Dependencies

- `role-privilege-management.md` (catalog, guards, Master Customer role),
  `customer-registration.md` (registration source, shared identity lock,
  suspension sync), `tenant-dashboard.md` (navigation, dashboard card),
  shared UI (`src/components/shared`, RBAC toolbar/paging/records shell).

## Technical notes

- Service: `src/lib/workspace/customers.ts` (server-only): `listCustomers`,
  `getCustomerSummary`, `createCustomer`, `setCustomerStatus`.
- Rules/types: `src/lib/workspace/customer-rules.ts` (client-safe).
- UI: `src/components/customers/` (`customer-form.tsx`,
  `customers-directory.tsx`, `customer-summary.tsx`, `customer-records.tsx`).
  The list reuses the RBAC toolbar, URL query helpers and paging
  (`src/components/rbac/`), the records popup shell (`PagedRecords`) and the
  page frame (`ScreenFrame`, skeletons).
- Identity conflict messages are shared with the sub-user service through
  `identityConflictErrors` in `src/lib/workspace/identity.ts`.
- Pages: `src/app/(workspace)/tenant/customers/(list)/page.tsx` (+ loading),
  `new/page.tsx` (+ loading). Static routes win over the `/tenant/[module]`
  placeholder; "customers" was removed from the planned modules.

## Edge cases

- Two staff create the same username/email at the same time → the identity
  lock lets one win; the other gets the error under the field.
- A pending sign-up uses the email → error asks to choose another (approve
  the request on Registrations instead).
- Master Customer role missing in a tenant database → nothing written,
  friendly "could not be created" message, logged.
- Suspending a customer twice (two tabs) → second answer "already suspended,
  refresh the page".

## Tests

- `tests/tenant-customers.test.ts` (two real provisioned tenants, Server
  Actions invoked like Next.js): each action refuses without its exact
  privilege (+ `authz.denied`), revoked privilege / disabled role on the next
  call, module switched off for one tenant only, customer sessions and
  visitors redirected to `/login`, navigation link by privilege; creation
  shape (main customer, primary, Master Customer, audit, immediate login),
  crafted extra fields ignored, invalid values per field, taken identities
  (account / pending / rejected, case and spaces), concurrent duplicate
  username → one account, same username allowed in another tenant;
  suspend / reactivate (sessions deleted, sub-customer refused, stale change
  refused, Registrations page in sync), sub-customer / foreign / malformed
  ids "not found"; lists and counts limited to this tenant's main customers.
- `tests/rbac-workspace-http.test.ts` → "tenant Customers pages": access-denied
  without the privilege, renders with Master Tenant, lists signed-up customers
  with their source and never sub-customers, customer sessions redirected.
- `tests/authz-catalog.test.ts` (module + keys), `tests/rbac-migration.test.ts`
  (the rbac migration's own keys; later migrations complete the mirror and
  are idempotent).

## Known bugs

- None known.

## Change history

- 2026-10-17: Module created — owner decisions recorded (Customers module
  with list + create + suspend, tenant-set password, all main customers with
  source column, dashboard card from customers).
- 2026-10-17: Implemented as recorded above. Verified: TypeScript, ESLint
  (0 warnings), full Vitest suite 60 files / 1535 tests passed (1 existing
  skip). Tenant migration applied to the 5 dev tenant databases (backup
  `backups/music_distribution_20261017T025416Z.dump` taken first).
- 2026-10-17: Browser-verified on the dev tenant "Test Review Records"
  (Master Tenant admin): empty list state + count popup, Add customer form
  (client errors under every field and focus on the first, live "passwords do
  not match", server error "username already taken" under the field with
  values kept and passwords cleared, Cancel → discard confirmation), creation
  → success notice + counts, Suspend / Reactivate dialogs updating the row and
  counts without a reload, URL-kept search/status filters, "No customers
  match" + Clear filters, dashboard "Active customers" popup, dark theme (list
  and form), phone 375px and tablet 768px without horizontal overflow. Fixes
  from these checks: the shared CountDetails popup clipped wide tables
  (min-w-0 wrapper, see ui-components.md); the Full name placeholder now uses
  a neutral example name. A test customer "Asha Rao Browser"
  (`vt-asha-browser`, Added by tenant, active) remains in that dev tenant.
