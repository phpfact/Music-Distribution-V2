# Workspace Authentication (tenant hosts)

## Overview

- **Name:** Workspace authentication — sign-in, sessions, guards and sign-out
  for everyone who uses a tenant's own domain (tenant staff and customers).
- **Purpose:** let the tenant administrator (credentials created by the
  Platform Owner during tenant creation) and the tenant's approved customers
  sign in on the tenant's subdomain or verified custom domain, each into their
  own, strictly separated area.
- **Business goal:** a tenant's portal works on its own domain without ever
  touching the Platform Owner console, another tenant, or another role's area.
- **Status:** implemented 2026-10-15 (first version).

## Decisions confirmed with the owner (2026-10-15)

- One shared login form at **`/login`** for tenant staff and customers. The
  credentials decide the destination: tenant staff → `/tenant/dashboard`,
  customer → `/customer/dashboard`.
- Users sign in with **username or email** (both unique inside one tenant).
- All tenant-staff pages live under **`/tenant/...`**, all customer pages
  under **`/customer/...`**. Only customers can sign up (see
  `customer-registration.md`); tenant admin / sub-admin accounts are never
  created from a public form.
- Strict isolation between Platform Owner, Tenant (admin/sub-admin) and
  Customer: separate URLs, layouts, cookies, session areas and checks.
- Forgot password and 2FA are NOT built now; the public auth layout applies the
  workspace theme automatically so future auth pages inherit it.

## User flow

1. Visitor opens the tenant's domain → welcome page (`/`) → "Log in".
2. `/login` (public, workspace default theme): username/email + password.
3. Server action `workspaceLoginAction`:
   - tenant staff (user without `customer_id`) with status `active` →
     session in area `tenant`, cookie `md_tenant_session` (path `/tenant`),
     redirect `/tenant/dashboard`;
   - customer user (with `customer_id`) whose user and customer are `active` →
     session in area `customer`, cookie `md_customer_session` (path
     `/customer`), redirect `/customer/dashboard`;
   - suspended account (user `disabled`, or customer `disabled`) → friendly
     "account suspended" message, no session;
   - pending customer registration (correct password) → "awaiting approval"
     message, no session;
   - rejected customer registration (correct password) → limited
     registration session, cookie `md_registration_session` (path
     `/customer/registration`), redirect `/customer/registration` (reason +
     review request, see `customer-registration.md`);
   - anything else → "Invalid username/email or password."
4. Sign-out (account menu in each area) deletes the session row and the
   area's cookie and redirects to `/login`.

## Business rules

- The tenant is resolved ONLY from the Host header with the existing tenant
  gate (`getTenantAccess`, `src/lib/domains/resolve.ts`). Never from a form
  field, query string, cookie or X-Forwarded-Host.
- Every page and every Server Action of `/login`, `/tenant/**` and
  `/customer/**` calls the workspace guard itself (a layout alone is not a
  guard: layouts do not re-render on client navigation).
- Tenant not `allowed` (suspended / setup unfinished) → the guard redirects to
  `/`, which shows the friendly unavailable notice. Unknown host → 404 page.
- Session validity (checked on EVERY request, in the tenant's own database):
  within the 8-hour absolute lifetime, used within 30 minutes, matching area,
  user `active`; area `tenant` additionally requires a user without
  `customer_id`; area `customer` requires a linked customer whose status is
  `active` AND, for a sub-customer, an active main customer (parent). A
  suspension therefore ends access on the very next request (sessions of a
  suspended user are also deleted).
- The session check also reads the user's single role and its privilege keys
  in the same query; the guards attach the effective privileges as
  `area.authz` (role-privilege-management.md). A missing/disabled role keeps
  the session valid with an EMPTY privilege set.
- Owner-only features (registrations, workspace-wide appearance) still use
  `user.isOwner`, now computed as "holds the Master Tenant role" (system key
  `master_tenant`, role key `owner`); later RBAC tasks replace these checks
  with privileges.
- The tenant admin's initial account is never subject to approval: it is a
  staff user created `active` by provisioning; approvals only exist for
  customer registrations.

## Validations

- Frontend (`src/lib/workspace/rules.ts`, client-safe): identifier required,
  trimmed (blur/submit), 3–320 characters; password required, whitespace-only
  rejected, max 256, never trimmed. Validation on blur, live while a field
  shows an error, and on submit (scroll to + focus the first invalid field).
- Backend repeats every check; malformed identifiers are treated like wrong
  credentials (formats are not revealed).

## Security

- Session token: 32 random bytes (base64url). The database stores only
  SHA-256 of `<tenantId>:<area>:<token>`, so a token is bound to its tenant
  and area: a cookie copied to another tenant or area never matches.
- Sessions live in the tenant's own database (`user_sessions`,
  `registration_sessions`), never in the control plane.
- User-session issuance requires the password hash that was verified during
  login. It re-reads the active user under `FOR SHARE` in the same transaction
  as session insertion. A changed/missing hash or missing/disabled user returns
  no token and login reports invalid credentials without clearing its limit.
  Password resets lock/update that same user and delete their sessions before
  committing: reset first prevents issuance; issuance first is revoked by reset.
- Cookies: httpOnly, SameSite=Lax, Secure in production, host-only (no
  `Domain`), path-scoped per area, so a customer cookie is never even sent to
  `/tenant/**` and vice versa, and cookies never cross tenant domains.
- Rate limits (Redis, fail closed, tenant-scoped keys): 5 attempts per
  identifier and 20 per IP per 15 minutes; the identifier counter is cleared
  after a successful sign-in.
- Every wrong-credential path costs one Argon2 verification (dummy hash when
  no account exists), so timing does not reveal accounts.
- Passwords, tokens and hashes are never logged or returned to the browser.
- CSRF: Next.js Server Actions' built-in Origin/Host check.
- Back after logout: area layouts render `AuthPageGuard` (bfcache reload) and
  pages are dynamic (no-store), so the server re-checks the session.
- `/login`, `/tenant/**`, `/customer/**` answer 404 on the platform host
  (proxy); `/platform/**` keeps answering 404 on tenant hosts.

## Database (tenant database, migration `*_tenant_portal`)

- `user_sessions` (id, user_id → users ON DELETE CASCADE, area 'tenant' |
  'customer' (CHECK), token_hash UNIQUE, created_at, last_used_at,
  expires_at; indexes on user_id and expires_at).
- `registration_sessions` (id, registration_id → customer_registrations ON
  DELETE CASCADE, token_hash UNIQUE, created_at, last_used_at, expires_at).

## Dependencies

- `src/lib/domains/resolve.ts` (tenant gate), `src/lib/tenants/database-target.ts`
  + `src/lib/db/tenant.ts` (tenant Prisma client), `src/lib/platform-auth/password.ts`
  (Argon2id hashing/verify, dummy verify), `src/lib/rate-limit.ts`,
  `src/lib/platform-auth/rate-limit.ts` (`clientIpFromForwardedFor`).

## Edge cases

- Signed-in visitor opening `/login`: the area cookies are path-scoped, so
  `/login` cannot see them and shows the form; signing in again simply
  creates a new session.
- Tenant suspended while users are signed in: every request is redirected to
  the unavailable notice; sessions resume only if the tenant is reactivated
  and they have not expired.

## Change history

- 2026-10-17: Resolved AUD-20261017-001/002 with transactional master-session
  revocation and hash-checked, locked workspace-session issuance, following the
  platform session pattern. Regression tests in
  `tests/workspace-password-sessions.test.ts` exercise prior-session revocation,
  both concurrent orderings, a full login paused after verification, staff and
  customer stale hashes, rollback on revocation failure, unrelated sessions and
  fresh credentials. Existing authorization fixtures now supply a current hash
  through `tests/support/workspace-session.ts`; production has no bypass mode.
  Validation: `npm run lint`, `npm run typecheck`, and `npm run build` passed;
  the full Vitest run passed 61 files / 1,547 tests with one existing skip.
  The 12 new regression tests passed again after independent read-only review.
  Integration checks used dedicated PostgreSQL/Redis containers and a separate
  app server, without changing the running development services.
- 2026-10-15: Module created — requirements and owner decisions recorded
  before implementation (shared `/login`, username-or-email, area-separated
  sessions and cookies, no forgot-password/2FA yet).

- 2026-10-16: Implemented as recorded above. Verified: TypeScript, ESLint (0 warnings), full Vitest suite 40 files / 1174 tests passed (new: workspace-rules, workspace-portal with two real provisioned tenants, workspace-http). Browser-verified on a test tenant created in the Platform Owner panel: welcome, login (errors, wrong password, admin by username/email), tenant dashboard, dark theme switch persisting after reload, customer sign-up (validation, pending login blocked), tenant-admin approval, logout + Back, customer dashboard, customer blocked from /tenant, Platform Owner registrations page (count popup, reject with reason), rejected login -> status page -> review request, Platform Owner suspension ending the active session. Not browser-verified yet: "Apply to everyone" appearance, phone/tablet layouts.
- 2026-10-16: RBAC foundation (role-privilege-management.md):
  `validateUserSession` reads the role + privilege keys in its query, refuses
  a sub-customer whose main customer is suspended, and takes
  `{ touch?: boolean }` (default true; background polls pass false so they do
  not extend the idle timeout). `WorkspaceUser` gained `isPrimary`, `role`
  and `customer.parentId`; `isOwner` = holds `master_tenant`. Tenant and
  customer areas carry `authz`; `src/lib/authz/workspace.ts` adds
  `requireTenantAccess`, `requireCustomerAccess`, `authorizeTenantAction`,
  `authorizeCustomerAction` (refusals audited as `authz.denied`).

## RBAC (2026-10-16)

- `WorkspaceUser.isOwner` was removed (and its computation in
  `validateUserSession`); `WorkspaceRole` gained the display-only `name`
  (read in the same session query).
- `readAreaFingerprint(area)` (guards.ts) validates the area's session with
  `touch: false` and returns only `{ signedIn, fingerprint }`; used by
  `tenantFingerprintAction` / `customerFingerprintAction` for PermissionSync.
- Pages/actions needing a privilege use `requireTenantAccess` /
  `authorizeTenantAction` (src/lib/authz/workspace.ts).
- Change history: 2026-10-16 — owner flag removed, role name, fingerprint reader.

## Audit remediation requested 2026-10-17 (AUD-014)

Staff, customer and applicant sign-in/out must share structured authentication events with trusted IP, UTC, request correlation, tenant, outcome and verified actor or pseudonymous failure identifier. Applicant logout gains a completion event. Raw identifiers, passwords and tokens are excluded.

## Completion and verification — 2026-10-18

AUD-014 implemented for staff, customer and applicant sign-in/out. Shared logout attribution is best effort, revocation still runs after attribution-read errors, and applicant logout now emits success/failure outcomes. Existing real-database portal tests and database-free logout regressions passed. Root integration retains separate AUD-006 changes to customer-parent suspension checking.
