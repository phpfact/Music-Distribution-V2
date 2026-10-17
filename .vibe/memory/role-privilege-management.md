# Role and Privilege Management (RBAC)

## Overview

- **Name:** Role and privilege management — roles, privileges, sub-users and
  module availability for the three panels (Platform Owner, Tenant, Customer).
- **Purpose:** every signed-in person gets exactly one role inside exactly one
  authorization domain; the server decides every page, action and route from
  that role's CURRENT privileges, so a change takes effect on the very next
  request.
- **Business goal:** Platform Owners, Tenants and Customers can each build
  their own team (Sub-Platform Owners, Sub-Tenants, Sub-Customers) with
  precisely delegated access, without any path to another panel's privileges.
- **Status:** design recorded 2026-10-16; implementation in progress on
  branch `feature/rbac-privilege-management`. The FOUNDATION is implemented
  (catalog, migrations, master roles, resolver, guards, writers; see
  "Technical Notes"). Page/action enforcement of the existing features and
  navigation filtering are implemented too ("Enforcement map");
  role/sub-user management and module toggle UIs are later tasks.

## Decisions confirmed with the owner (2026-10-16)

- Three strictly isolated authorization domains: `platform` (Platform Owner +
  Sub-Platform Owners), `tenant` (Tenant + Sub-Tenants) and `customer`
  (Customer + Sub-Customers). Organizational hierarchy never grants
  cross-domain authorization.
- One default **master role** per domain: Master Platform, Master Tenant,
  Master Customer. A master role is identified by a protected `system_key`,
  never by its name. It grants every privilege of its own domain's CURRENT
  catalog (minus centrally disabled modules) and nothing outside it.
- **Master holders may assign the master role** to other users of the same
  domain (and, for customers, of the same main customer). Nobody else can
  assign, edit or manage a master holder.
- **Central module control belongs to the Platform Owner:** a platform-wide
  kill switch for platform modules, and per-tenant switches for tenant and
  customer panel modules. **Core modules** (roles, users/sub-users, platform
  modules) can never be disabled, so nobody can be locked out.
- **Sub-customers are one level deep:** a sub-customer always belongs to a
  main (root) customer and cannot have sub-customers of its own. Custom
  customer roles are owned by the main customer and can be assigned to the
  main customer's sub-customers.
- Personal appearance stays available to every signed-in user (it is a
  personal preference, required by CLAUDE.md). The dashboard landing page is
  available to every active user of the panel; its widgets are filtered by
  privilege. "Coming soon" placeholder modules have no functionality and no
  privileges (CLAUDE.md: no privileges for nonexistent functionality).

## Permission catalog (stable keys)

Defined once in code (`src/lib/authz/catalog.ts`, client-safe) and mirrored
into the database by migrations. A key is `<domain>.<module>.<action>`. Keys
are stable identifiers; labels are display text only. Every non-`view`
privilege of a module that has a `view` privilege requires that `view`
privilege (`requires`), plus the explicit dependencies listed.

### Platform domain (control-plane database)

| Module key | Label | Core | Privileges |
|---|---|---|---|
| `platform.tenants` | Tenant Management | no | `view` (directory, details, summary counts, profile images), `create` (create form, value preview, connection test), `edit` (edit details/domains, domain checks), `suspend` (suspend + reactivate), `provision` (retry setup), `credentials` (reset master password, rotate/update database password) |
| `platform.tenant_registrations` | Tenant Customer Registrations | no | `view` (registrations page + counts; requires `platform.tenants.view`), `review` (approve/reject), `suspend` (suspend/reactivate approved customer accounts) |
| `platform.tenant_modules` | Tenant Module Access | no | `manage` (switch tenant/customer modules of a tenant; requires `platform.tenants.view`) |
| `platform.appearance` | Platform Appearance | no | `manage_global` (apply/reset appearance for everyone; replaces the old `can_manage_appearance` column) |
| `platform.roles` | Roles & Privileges | yes | `view`, `create`, `edit` (incl. disable/enable), `delete` |
| `platform.users` | Sub-Platform Owners | yes | `view`, `create`, `edit` (details, role, password), `suspend` (suspend + reactivate) |
| `platform.modules` | Platform Modules | yes | `manage` (platform kill switch) |

### Tenant domain (tenant database)

| Module key | Label | Core | Privileges |
|---|---|---|---|
| `tenant.registrations` | Customer Registrations | no | `view`, `review` (approve/reject), `suspend` (suspend/reactivate customer accounts) |
| `tenant.appearance` | Workspace Appearance | no | `manage_workspace` (apply/reset the workspace default) |
| `tenant.roles` | Roles & Privileges | yes | `view`, `create`, `edit`, `delete` |
| `tenant.users` | Sub-Tenants | yes | `view`, `create`, `edit`, `suspend` |

### Customer domain (tenant database)

| Module key | Label | Core | Privileges |
|---|---|---|---|
| `customer.roles` | Roles & Privileges | yes | `view`, `create`, `edit`, `delete` |
| `customer.sub_customers` | Sub-Customers | yes | `view`, `create`, `edit`, `suspend` |

## Authorization decision (server, every request)

`src/lib/authz/` resolves the effective privileges of the signed-in person.
Nothing is cached across requests (only React `cache()` memoization within
one request), so revocation, role changes, role disabling, module switches
and account suspension apply on the next request, on every app instance,
without logout or refresh.

1. Authenticated identity: the existing session check (platform:
   `validateSession`; workspace: `validateUserSession`). User status `active`;
   tenant `allowed` (workspace); customer area: own customer `active` AND its
   parent customer (if any) `active`.
2. The user's single role, loaded fresh: must exist, be `active`, belong to
   the session's domain (platform owner → platform role; staff user → tenant
   role; customer user → customer role) and, for a custom customer role,
   be owned by the user's main customer (`COALESCE(customer.parent_id,
   customer.id)`). Otherwise `roleState` is `missing` / `disabled` /
   `invalid` and the effective set is EMPTY (fail secure).
3. Base set: master role → every catalog privilege of the domain; custom
   role → its stored privilege keys ∩ the domain's catalog (unknown keys are
   ignored).
4. Minus every privilege of a centrally disabled, non-core module
   (platform: `platform_module_settings`; tenant/customer:
   `tenant_module_settings` of this tenant, read from the control plane).
5. Deny by default: `can(key)` is true only for keys in the final set.
   Unknown keys, missing roles and invalid roles never grant anything.
6. The service performing the operation then checks resource ownership and
   scope (tenant from the Host header only; customer scope = main customer;
   target user inside the actor's scope) and the business rules below.

A user whose role is missing/disabled/invalid can still sign in and sees the
dashboard with a notice ("Your account has no active role…") plus personal
appearance; every protected page shows the access-denied state and every
protected action is refused.

## Business rules

### Single role

- Platform: `platform_owners.role_id` NOT NULL (one column = one role).
- Tenant database: `user_roles` gets UNIQUE (`user_id`); assignment is an
  upsert on `user_id`, so concurrent assignments can never leave two roles.
- Every request/form carries exactly ONE role id (a string UUID); arrays,
  repeated fields, missing or malformed ids are rejected.
- Reassignment replaces the old role; nothing is merged.
- Role → user FK is ON DELETE RESTRICT, so a role in use can never vanish
  from under its users.

### Master roles and primary accounts

- System roles: `master_platform` (control plane), `master_tenant` (tenant DB,
  keeps the existing key `owner`) and `master_customer` (tenant DB, one per
  tenant database, owner_customer_id NULL). Created idempotently by
  migrations; never editable, disableable or deletable through the app.
- **Primary accounts** (`is_primary = true`): the seeded/oldest Platform
  Owner, the tenant administrator written by provisioning, and the user of
  each approved main customer. A primary account always keeps its master
  role and can never be suspended, edited or reassigned through RBAC paths
  (lockout protection). Rotation stays with the existing flows (seed
  `--rotate-password`, Platform Owner "reset master password").
- Only a current holder of a domain's master role may assign that master
  role, and only to users of the same domain/scope. Only a master holder may
  manage (edit, suspend, change the role of) another master holder.
- Master roles are never auto-granted to new sub-users.

### Delegation ceiling (role create/edit/delete, assignment, reassignment)

- Assignable privileges = the actor's CURRENT effective privileges in the
  same domain. Disabled-module privileges, unknown keys and other domains'
  keys are rejected with a clear message and audited as an escalation
  attempt.
- A role R is **assignable** by actor A when: R is in A's domain scope
  (platform role; tenant role; customer: master_customer or a custom role of
  A's main customer), R is `active`, and either R is master and A holds the
  master role, or R's privileges (ignoring disabled-module ones) ⊆ A's
  effective privileges.
- A role R is **manageable** (edit/disable/delete) by A when: R is a custom
  role in A's scope, R ≠ A's own role, and R's privileges (ignoring
  disabled-module ones) ⊆ A's effective privileges.
- A user U is **manageable** by A when: U is in A's scope (platform owner;
  staff user of this tenant; sub-customer of A's main customer), U ≠ A,
  U is not primary, and U's role is master ⇒ A is master, else U's role
  privileges ⊆ A's effective privileges.
- Nobody can change their own role, status or the role they hold.
- Saving a role keeps its stored privileges of currently disabled modules
  unchanged (they stay inert until the Platform Owner re-enables the module)
  and never adds new ones.
- Role names: trimmed, 3–100 characters, letters/digits/spaces and
  `- _ & ( ) . '`; unique per scope case-insensitively; may not equal any
  master role name. Copying a master role's name or description never grants
  anything (privileges come from `system_key` only).
- At least one privilege per custom role; `requires` dependencies must be
  satisfied.

### Role lifecycle

- Disable (edit privilege): allowed with a confirmation that lists the
  affected users; those users lose all protected access on their next request
  until reassigned. Enable restores it.
- Delete (delete privilege): when users hold the role, a replacement role
  (assignable by the actor, active, different) is required; all holders are
  reassigned and the role deleted in ONE transaction. Never a silent
  fallback.

### Sub-users

- **Sub-Platform Owner:** full name, username, password (+ confirm), one
  platform role. Edit: full name, role, optional new password (revokes the
  user's sessions). Suspend/reactivate (suspend deletes sessions).
- **Sub-Tenant:** staff user (no customer): full name, email, username,
  password (+ confirm), one tenant role. Same edit/suspend rules.
- **Sub-Customer:** a `customers` row with `parent_id` = the actor's main
  customer (type artist/label/white_label, name) plus its login user (full
  name, email, username, password + confirm) and one customer role, created
  in one transaction. Suspend = sub-customer `status = disabled` + its users'
  sessions deleted. A sub-customer can never have sub-customers.
- Email/username uniqueness inside a tenant includes pending/rejected
  registrations (same advisory lock as the registration flow) plus the
  database UNIQUE constraints.

### Account lifecycle

- User suspended → sessions deleted, every request refused.
- Tenant suspended/not ready → whole portal unavailable (existing gate).
- Main customer suspended (registrations page) → the main customer row is
  also set `disabled` (reactivate sets it `active`), so all its
  sub-customers are refused on their next request.
- Platform owners / staff users created by another user do NOT cascade:
  suspending the creator does not suspend them.

### Module availability

- Platform modules: `platform_module_settings` (absent row = enabled), switched
  at `/platform/settings/modules` with `platform.modules.manage`.
- Tenant/customer modules of one tenant: `tenant_module_settings` in the
  control plane (absent row = enabled), switched on the tenant details page
  with `platform.tenant_modules.manage`. Tenants and customers cannot change
  them.
- Core modules are always on and shown as locked.

## Database

### Control plane (`prisma/control`)

- `platform_permissions` (key PK, module_key, action, label, description,
  sort_order) — mirror of the catalog.
- `platform_roles` (id, name, description, status `role_status`
  active|disabled, system_key UNIQUE NULL CHECK in ('master_platform'),
  created_by_id → platform_owners SET NULL, created_at, updated_at); unique
  index on lower(name).
- `platform_role_permissions` (role_id → platform_roles CASCADE,
  permission_key → platform_permissions RESTRICT, PK both).
- `platform_owners` + `role_id` NOT NULL → platform_roles RESTRICT,
  `full_name` NULL, `is_primary` (one TRUE via partial unique index),
  `created_by_id` NULL; `can_manage_appearance` removed after migration.
- `platform_module_settings` (module_key PK, enabled, updated_at, updated_by_id).
- `tenant_module_settings` (tenant_id → tenants, module_key, enabled,
  updated_at, updated_by_id; PK tenant_id + module_key).
- `audit_actor_type` + `customer_user`. `audit_events` rows cannot be
  updated or deleted (trigger).

### Tenant database (`prisma/tenant`)

- `permissions` + domain ('tenant'|'customer'), module_key, action, label,
  sort_order — mirror of the tenant and customer catalogs.
- `roles` + domain, system_key UNIQUE NULL ('master_tenant'|'master_customer'),
  status, owner_customer_id → customers RESTRICT (custom customer roles
  only), created_by_id → users SET NULL; CHECKs tie domain/system_key/owner
  together; unique (domain, owner scope, lower(name)).
- `role_permissions`: trigger rejects a permission of another domain.
- `user_roles`: UNIQUE(user_id); role FK RESTRICT; trigger rejects a role of
  the wrong domain (staff ↔ tenant, customer user ↔ customer) or a custom
  customer role of another main customer.
- `users` + `is_primary` (one primary staff user; one primary per customer).
- `customers`: trigger keeps the hierarchy one level deep.

### Implementation details of the schema (2026-10-16)

- Control: `platform_roles.name` VARCHAR(100), CHECKs `system_key IN
  ('master_platform')`, master always `active`, name not blank; trigger
  `platform_roles_protect_master` refuses deleting the master role and changing
  any `system_key` (even when nobody holds it). `platform_owners_one_primary_key`
  = partial unique index on `is_primary WHERE is_primary`.
  `tenant_module_settings.tenant_id` → tenants ON DELETE CASCADE (pure config).
  Module setting CHECKs: platform rows `platform.%`, tenant rows `tenant.%` /
  `customer.%`. `audit_events`: trigger refuses UPDATE, DELETE and TRUNCATE
  (SQLSTATE 23001).
- Tenant: new enum `authz_domain` ('tenant','customer') for `roles.domain` and
  `permissions.domain`; `roles.key` stays NOT NULL UNIQUE with DEFAULT
  `'custom_' || <uuid hex>` (custom roles never invent a key); `is_system` is
  kept and must equal `system_key IS NOT NULL` (CHECK); CHECKs tie
  system_key ↔ domain, master ⇒ active, and `owner_customer_id IS NOT NULL ⇔
  custom customer role`. Scoped name index: `(domain, COALESCE(owner,
  zero-uuid), lower(name))`. `user_roles` primary key is now `(user_id)`
  (= UNIQUE(user_id)); role FK RESTRICT.
- Tenant triggers (all `SET search_path = pg_catalog, public, pg_temp`, run as
  the writer, i.e. the low-privilege runtime login; verified with a real
  provisioned tenant): `role_permissions_domain_guard`,
  `user_roles_scope_guard` (staff ↔ tenant role, customer user ↔ customer role,
  custom customer role owner = COALESCE(parent_id, id) of the user's customer),
  `roles_scope_guard` (domain/system_key/owner immutable; owner must be a MAIN
  customer), `roles_protect_system` (master roles never deleted),
  `customers_hierarchy_guard` (one level; locks the parent row FOR SHARE; a
  customer with sub-customers OR owning roles cannot become a sub-customer).
  Violations raise SQLSTATE 23514 with a named constraint (e.g.
  `user_roles_domain_match`, `customers_one_level`).

### Migration of existing data (idempotent, retry-safe)

Both rbac migrations (`prisma/control/migrations/20261016120000_rbac`,
`prisma/tenant/migrations/20261016120000_rbac`) are written so the whole file
can run again on a migrated database without failing or changing data
(tested).

- Control: create Master Platform; the oldest ACTIVE platform owner (the
  oldest owner when none is active — refinement so a disabled account cannot
  lock everybody out) → primary + master; any other existing owner → a
  migrated custom role holding exactly the privileges of pre-existing
  capabilities: "Legacy Platform Owner" (`platform.tenants.*`,
  `platform.tenant_registrations.*`, `platform.appearance.manage_global`) when
  `can_manage_appearance` was true, otherwise "Legacy Platform Owner (personal
  appearance)" (without the appearance privilege). New management privileges
  (roles, users, modules, tenant modules) are not granted to them. The
  `can_manage_appearance` column is then dropped.
- Tenant: legacy privileges outside the catalog are deleted (their role links
  cascade); legacy non-owner roles become disabled tenant roles named
  "<name> (<key>)" that nobody holds. The existing `owner` role becomes
  Master Tenant (key kept; created when missing, e.g. a brand-new database);
  its oldest active staff holder becomes primary. Create Master Customer. Each
  approved registration's user of a main customer → Master Customer + primary.
  Links that grant nothing (non-master roles, Master Tenant on a customer
  user, Master Customer on a staff user) are removed; anyone else gets no role
  (fail secure). Duplicate role links are reduced to the oldest before
  user_id becomes the key. An approved account that is suspended also gets
  its main customer row `disabled` (account lifecycle rule).

## Security

- Backend first: every page, Server Action and route handler checks the
  privilege itself; hiding navigation is a convenience only.
- Client-supplied roles, privileges, tenant ids and customer ids are never
  trusted; all ids are validated (UUID) and re-scoped on the server.
- Forbidden responses never reveal internal details; a missing privilege on
  a page shows the access-denied state; a missing privilege on an action
  returns a friendly error.
- Audit (control-plane `audit_events`, after commit): role created/updated/
  disabled/enabled/deleted (privilege keys added/removed), user created/
  updated/role changed/password reset/suspended/reactivated, master role
  assigned, module enabled/disabled, denied actions and blocked escalation
  attempts. Never passwords, hashes, tokens or secrets.

## UI Behavior

- Navigation (sidebar, quick actions, dashboard quick access) shows only what
  the effective privileges allow. A client `PermissionSync` asks the server
  for a privilege fingerprint (every 30 s, on focus, on route change; it does
  not extend the idle timeout) and refreshes the page tree when it changes.
- Detailed screen specs: see "UI specs" below (mockup approved by the owner
  on 2026-10-16).

### UI specs (approved 2026-10-16)

Same pattern in all three panels; one shared implementation under
`src/components/rbac/` (plus generic primitives), each panel only binds its
own Server Actions and paths. Shadcn components and theme tokens only; light,
dark and every accent must work.

**Routes**

| Panel | Roles | Sub-users | Modules |
|---|---|---|---|
| Platform | `/platform/roles`, `/new`, `/[id]`, `/[id]/edit` | `/platform/users` (Sub-Platform Owners), `/new`, `/[id]/edit` | `/platform/settings/modules`; per tenant: "Module access" section on `/platform/tenants/[id]` |
| Tenant | `/tenant/roles`, `/new`, `/[id]`, `/[id]/edit` | `/tenant/users` (Sub-Tenants), `/new`, `/[id]/edit` | — |
| Customer | `/customer/roles`, `/new`, `/[id]`, `/[id]/edit` | `/customer/sub-customers`, `/new`, `/[id]/edit` | — |

**Navigation**: Platform "Platform management": Tenant Management
(`platform.tenants.view`), Roles & Privileges (`platform.roles.view`),
Sub-Platform Owners (`platform.users.view`), Subscriptions (planned); Settings
→ Appearance (everyone), Modules (`platform.modules.manage`). Tenant: an
"Access control" group with Sub-Tenants (`tenant.users.view`) and Roles &
Privileges (`tenant.roles.view`); Registrations (`tenant.registrations.view`).
Customer: an "Account" group with Sub-Customers
(`customer.sub_customers.view`) and Roles & Privileges (`customer.roles.view`).
The account menu shows the user's role name.

**Roles list**: PageHeader (eyebrow "Access control", "Roles & Privileges",
"Create role" only with `*.roles.create`). Secondary menu (top variant):
Summary, Role directory. Summary = 4 StatCards (Total roles, Active,
Disabled, Users assigned), every figure opens CountDetails with the exact
records and the calculation. Toolbar: search (name, description) + status
filter, URL-preserved, server-side pagination (20), no full reload. Table
(cards below xl): Role (name, muted description, "System" badge with lock for
master roles, "Above your authority" badge when not manageable), Status,
Privileges (count, "All (N)" for master; opens a popup grouped by module),
Users (count; opens the assigned users), Updated, row menu (View; Edit,
Disable/Enable, Delete only when manageable and permitted). Empty states with
illustration, heading, text and "Create role" / "Clear filters".

**Role details**: PageHeader with back link, name, badges and the same
actions. Sections: Overview (description, type, status, created/updated),
Privileges (read-only, grouped by module; privileges of disabled modules
marked "Module disabled by the Platform Owner"), Assigned users (name,
masked username/email with eye toggle, status; empty state).

**Role editor (create/edit)**: sidebar secondary menu with Role details,
Privileges, Review; sticky FormActions (Cancel, "Save role" → "Saving…",
duplicate-submit guard). Role details: Role name * (live validation),
Description (≤500 with counter), Status (Active/Disabled). Privileges: search
box filtering by label/description; one collapsible card per module with a
tri-state header checkbox (selects only assignable privileges of that module)
and an "x/y" count; one checkbox per privilege with label + description;
choosing a privilege auto-selects its `requires` (shown as "needs View"),
clearing a required one clears its dependents. Privileges the actor may not
grant are never checkboxes: they appear in a dashed, locked "Not assignable"
group with the reason ("Outside your privileges" or "Module disabled by the
Platform Owner"). Review: selected privileges grouped by module, total, and
on edit "N users affected". Saving a role that has users asks for
confirmation. Errors appear under their field; on failure the first invalid
field is scrolled into view and focused; entered values are kept.

**Disable / delete role**: ConfirmDialog listing the affected users (first
10 + "and N more"). Delete with users requires a replacement role
(searchable select of assignable roles) — "Delete and reassign".

**Sub-users list** (Sub-Platform Owners / Sub-Tenants / Sub-Customers):
PageHeader + "Add …" action (create privilege). Summary StatCards (Total,
Active, Suspended) with CountDetails. Toolbar: search (name, username,
email) + status filter + role filter (searchable). Table (cards below xl):
Name (+ "Primary" / "You" badges), Username and Email masked with eye toggle
(platform owners have no email), Role (+ "Master" badge), Account type
(sub-customers), Status, Created, actions (Edit, Suspend/Reactivate with
confirmation) only where manageable and permitted.

**Sub-user form (create/edit)**: sidebar secondary menu: Personal
Information (Full name *; sub-customers also Account type *), Login
Information (Username *, Email * for tenant/customer, Password * + Confirm *
with eye toggles and the shared password checklist; edit shows username
read-only and an optional "Set a new password"), Access (Role * — searchable
single-role picker listing only active roles the actor may assign, with
privilege count or "All privileges" and a "Master" badge; helper "Exactly one
role. It takes effect on the user's next request."). Sticky actions
("Create sub-tenant" → "Creating…"). Edit forms are prefilled.

**Modules**: `/platform/settings/modules` lists platform modules with a
switch; core modules show a "Core · always on" lock badge. Turning a module
off asks for confirmation ("Every role, including Master Platform, loses these
privileges immediately"). The tenant details page gets a "Module access"
section (in its secondary menu) listing Tenant panel and Customer panel
modules with switches (`platform.tenant_modules.manage`; read-only badges
otherwise).

**Access denied / no role**: a direct visit to a page without its privilege
shows an access-denied state (illustration, "You don't have access to this
page", short explanation, "Go to dashboard"). A user without an active role
sees a warning notice on the dashboard.

## Dependencies

- Platform auth (`platform-auth.md`), workspace auth (`workspace-auth.md`),
  customer registration (`customer-registration.md`), tenant management
  (`tenant-management.md`, provisioning writes Master Tenant), platform and
  workspace appearance, platform navigation, shared UI components.

## Technical Notes

### File map (foundation, 2026-10-16)

- `src/lib/authz/catalog.ts` — client-safe catalog (domains, modules, privileges,
  `MASTER_SYSTEM_KEYS`, `MASTER_ROLE_NAMES`, `TENANT_MASTER_ROLE_KEYS`) and
  helpers. Mirrored by the rbac migrations; `tests/authz-catalog.test.ts` and
  `tests/authz-tenant.test.ts` keep catalog and both mirrors identical.
- `src/lib/authz/resolver.ts` — pure decision (no DB): `resolveEffectiveAccess`,
  `accessFingerprint`, `forbiddenMessage`, `FORBIDDEN_MESSAGE`,
  `NO_ACTIVE_ROLE_MESSAGE`; types `RoleState`, `RoleSnapshot`, `EffectiveAccess`.
- `src/lib/authz/platform-access.ts` (server-only) — `loadPlatformAccess(db, ownerId)`
  and `loadDisabledPlatformModules(db)`; works with a client or a transaction.
- `src/lib/authz/platform.ts` (server-only) — request guards of the Platform Panel.
- `src/lib/authz/workspace-access.ts` (server-only) — `resolveWorkspaceAccess`,
  `loadDisabledTenantModules`, `getDisabledTenantModules` (per-request cache).
- `src/lib/authz/workspace.ts` (server-only) — tenant/customer guards by privilege.
- `src/lib/authz/denials.ts` (server-only) — `recordAuthzDenial` (`authz.denied`).
- `src/lib/workspace/sessions.ts` — `validateUserSession` reads the role and its
  privilege keys in the SAME query, refuses a sub-customer whose main customer
  is not active, and takes `{ touch?: boolean }` (default true).
- `src/lib/workspace/guards.ts` — tenant/customer areas now carry `authz`.

### Guard / resolver API (exact signatures)

```ts
// resolver.ts (pure)
resolveEffectiveAccess<D extends AuthzDomain>(input: {
  domain: D; role: RoleSnapshot | null; inScope?: boolean; disabledModules: Iterable<string>;
}): EffectiveAccess<D>
// EffectiveAccess<D> = { domain; roleId: string | null; roleState: "active"|"missing"|"disabled"|"invalid";
//   isMaster: boolean; permissions: readonly DomainPermissionKey<D>[];
//   can(key: DomainPermissionKey<D>): boolean; fingerprint: string }
forbiddenMessage(access: { roleState }): string

// platform (server-only)
loadPlatformAccess(db: Pick<ControlDb,"platformOwner"|"platformModuleSetting">, ownerId: string): Promise<PlatformAccess>
// PlatformAccess = EffectiveAccess<"platform"> & { ownerId: string; isPrimary: boolean }
getPlatformAccess(): Promise<{ session: PlatformSession; access: PlatformAccess } | null>   // React cache, per request
requirePlatformAccess(): Promise<{ session; access }>                                       // redirect /platform/login
authorizePlatformAction(permission: PlatformPermissionKey, options?: { ipAddress?: string | null }):
  Promise<{ ok: true; session; access } | { ok: false; error: string }>                    // audits authz.denied

// workspace (server-only)
requireTenantAccess(): Promise<TenantArea>       // TenantArea = ReadyWorkspace & { user: WorkspaceUser; authz: EffectiveAccess<"tenant"> }
requireCustomerAccess(): Promise<CustomerArea>   // CustomerArea = ... & { authz: EffectiveAccess<"customer"> }
authorizeTenantAction(permission: TenantPermissionKey, options?: { ipAddress? }): Promise<{ ok: true; area } | { ok: false; error }>
authorizeCustomerAction(permission: CustomerPermissionKey, options?: { ipAddress? }): Promise<{ ok: true; area } | { ok: false; error }>
resolveWorkspaceAccess<A extends "tenant"|"customer">(user: Pick<WorkspaceUser,"role"|"customer">, area: A, disabledModules): EffectiveAccess<A>
validateUserSession(db, tenantId, area, token, options?: { touch?: boolean }): Promise<WorkspaceUser | null>
```

- `requirePlatformOwner()` (session only) and `requireTenantUser()` /
  `requireCustomer()` keep working; the workspace ones now return the area
  WITH `authz`. `WorkspaceUser.isOwner` was REMOVED on 2026-10-16 (every
  former owner check now uses a privilege, see "Enforcement map").
  `WorkspaceUser` also gained `isPrimary`, `role: WorkspaceRole | null`
  (incl. the display-only `name`) and `customer.parentId`. `PlatformAccess`
  carries the display-only `roleName`.
- A missing/disabled/invalid role never ends a session; the guards return the
  area/context with an EMPTY effective set, so pages can show the
  access-denied state.
- Writers that set roles now: seed bootstrap (Master Platform + primary),
  provisioning `writeInitialAdmin` (role key `owner` upserted as Master Tenant,
  admin primary, `user_roles` upsert on user_id; `verify` checks
  `system_key = 'master_tenant'`), `approveRegistration` (Master Customer +
  primary in the same transaction), `setCustomerAccountStatus` (main customer
  row disabled/active together with the user). The appearance service checks
  `platform.appearance.manage_global` (resolved inside its transaction, after
  the owner row lock) instead of the dropped column.
- Audit actions added: role.created/updated/disabled/enabled/deleted,
  user.created/updated/role_changed/password_reset/suspended/reactivated,
  master_role.assigned, platform_module.enabled/disabled,
  tenant_module.enabled/disabled, authz.denied, authz.escalation_blocked;
  actor type `customer_user`.
- Test helpers: `insertOwner` gives Master Platform unless `roleId` is passed;
  `insertPlatformRole`, `masterPlatformRoleId`; `clearPlatformTables` also
  removes custom platform roles and platform module settings.
- After `prisma generate` the running dev server keeps its old Prisma client
  on `globalThis`; restart it (touching next.config.ts makes `next dev` restart).

### Enforcement map (existing features, 2026-10-16)

Pages show the inline `AccessDenied` state (`src/components/shared/access-denied.tsx`,
HTTP 200, nothing protected is read first; Next's experimental
`authInterrupts`/`forbidden()` is NOT used). Actions refuse through
`authorizePlatformAction` / `authorizeTenantAction` (friendly message in the
action's normal error shape, `authz.denied` audit row with the client IP).
Platform tenant actions return `{ ok: false, reason: "forbidden", message }`
(`ForbiddenFailure` in `tenants/action-types.ts`), the connection test
`{ kind: "error", reason: "forbidden" }`, form actions a form-level error.

| Page / action / route | Privilege |
|---|---|
| `/platform/tenants` (list, summary, count dialogs) + `loadTenantCountRecordsAction` | `platform.tenants.view` |
| `/platform/tenants/[id]` (details) + its `generateMetadata` | `platform.tenants.view` |
| `/platform/tenants/[id]/avatar` route | `platform.tenants.view` (else 404) |
| `/platform/tenants/new`, `createTenantAction`, `previewTenantValuesAction`, `testDatabaseConnectionAction`, "Create tenant" buttons | `platform.tenants.create` |
| `/platform/tenants/[id]/edit`, `updateTenantAction`, `verifyCustomDomainAction`, `recheckSubdomainAction`, Edit button/menu item, DNS check buttons | `platform.tenants.edit` |
| `suspendTenantAction`, `reactivateTenantAction`, Suspend/Reactivate buttons and row menu items | `platform.tenants.suspend` |
| `retryProvisioningAction`, Retry setup buttons | `platform.tenants.provision` |
| `resetMasterPasswordAction`, `rotateDatabasePasswordAction`, `updateDatabasePasswordAction` and their buttons | `platform.tenants.credentials` |
| `/platform/tenants/[id]/registrations`, `loadPlatformRegistrationRecordsAction`, Registrations link | `platform.tenant_registrations.view` |
| `approvePlatformRegistrationAction`, `rejectPlatformRegistrationAction` (+ buttons) | `platform.tenant_registrations.review` |
| `suspendPlatformCustomerAction`, `reactivatePlatformCustomerAction` (+ buttons) | `platform.tenant_registrations.suspend` |
| `updateAppearanceAction` scope global (action authorizes first; service re-checks in its transaction); UI `canManageGlobal` | `platform.appearance.manage_global` |
| `/platform/roles/**`, `/platform/users/**` pages and their actions | see "RBAC pages (all panels)" |
| Platform dashboard tenant figures + "Manage tenants" | `platform.tenants.view` |
| `/tenant/registrations`, `loadTenantRegistrationRecordsAction`, dashboard registration cards / recent table / quick action | `tenant.registrations.view` |
| `approveTenantRegistrationAction`, `rejectTenantRegistrationAction` (+ buttons) | `tenant.registrations.review` |
| `suspendTenantCustomerAction`, `reactivateTenantCustomerAction` (+ buttons) | `tenant.registrations.suspend` |
| `saveTenantAppearanceAction` scope workspace (action authorizes first; `saveViewerAppearance` re-checks `canManageWorkspace`); Workspace section of the page | `tenant.appearance.manage_workspace` |

Session only (by design): the three dashboards (widgets filtered), personal
appearance (all panels), the `/platform/settings` redirect, the planned
"coming soon" modules (`/platform/subscriptions`, `/platform/support`,
`/tenant/[module]`, `/customer/[module]`), logout, the fingerprint actions,
`saveCustomerAppearanceAction` (customers never manage the workspace
default; the service refuses that scope).

Navigation: platform `navigation.ts` items/children carry an optional
`permission`; `filterNavSections(permissions)` feeds the sidebar, the top-bar
breadcrumb and the dashboard quick access (the layout passes
`access.permissions` — plain strings — and the role label to `ConsoleShell`).
`tenantDashboardConfig(name, user, authz)` / `customerDashboardConfig(name,
user, authz)` filter the same way. Account menus show the role name or
"No active role" (customer: "<role> · <account type>"). The shared
`RegistrationList` takes `canReview` / `canSuspend` from both panels.

Privilege sync: `PermissionSync` (`src/components/shared/permission-sync.tsx`)
is rendered by the three layouts with `platformFingerprintAction`
(`src/app/platform/actions.ts`), `tenantFingerprintAction` and
`customerFingerprintAction` (both via `readAreaFingerprint(area)` in
`src/lib/workspace/guards.ts`). Each validates the session with
`touch: false` and returns only `{ signedIn, fingerprint }`; the client checks
every 30 s while visible, on focus/visibilitychange and on route change,
never overlapping, silent on errors, and calls `router.refresh()` when signed
out or changed. Dashboards of a person without an active role show
`NoActiveRoleNotice` and hide the gated widgets.

Tests: `tests/rbac-enforcement.test.ts` (each action above refuses without /
passes with its key, audit row; revocation, role change, disabled role and
switched-off module apply on the next call; fingerprint changes and keeps
`last_used_at`; tenant registrations page denied; workspace navigation) and
`tests/rbac-enforcement-http.test.ts` (platform pages, avatar, sidebar and a
role change between two HTTP requests against the dev server).

### Services (role + sub-user management, 2026-10-16)

Server-side library only; pages / Server Actions stay thin: authorize with
`authorize*Action(privilege)` → build the actor → call ONE service function →
show `error` / `fieldErrors`. One implementation for all three domains; the
storage differs through `storeFor(actor)` (`src/lib/authz/stores/`:
`platform.ts` control plane, `workspace.ts` tenant DB, contract `types.ts`).

Files: `policy.ts` (pure, client-safe), `actor.ts`, `management-model.ts`
(client-safe DTOs, query parsing, `MANAGEMENT_PRIVILEGES`),
`management-common.ts`, `role-service.ts`, `sub-user-service.ts`,
`src/lib/workspace/identity.ts` (shared identity advisory lock — the
registration flow now uses it too, same lock id, behaviour unchanged).

```ts
// actor.ts (server-only) — built ONLY from server-resolved data
platformActor(ctx: Pick<PlatformAccessContext,"access">, opts?: { ipAddress?; disabledModules? }): Promise<PlatformAuthzActor>
tenantActor(area: Pick<TenantArea,"tenant"|"db"|"user"|"authz">, opts?): Promise<TenantAuthzActor>
customerActor(area: Pick<CustomerArea,"tenant"|"db"|"user"|"authz">, opts?): Promise<CustomerAuthzActor>
// AuthzActor = { domain, userId, roleId, isMaster, isPrimary, permissions, disabledModules, ipAddress,
//   scope: {kind:"platform"} | {kind:"tenant",tenantId,db} | {kind:"customer",tenantId,db,mainCustomerId,customerId} }
toPolicyActor(actor): PolicyActor

// policy.ts (pure) — every decision returns { ok: true } | { ok: false; reason: PolicyDenial }
checkRoleAssignable / isRoleAssignable(actor: PolicyActor, role: PolicyRole)
checkRoleManageable / isRoleManageable(actor, role)
checkUserManageable / isUserManageable(actor, target: PolicyUser)
validatePrivilegeRequest(actor, submitted: unknown, existingKeys?): PrivilegeRequestResult
  // problems: empty | unknown | other_domain | module_disabled | above_ceiling | missing_requires (escalation flag)
finalStoredKeys(domain, requested, existing, disabledModules) // requested ∪ existing disabled-module keys
privilegeLockReason(actor, key): "outside_privileges" | "module_disabled" | null
validateRoleFields({ name, description, status })            // role-rules.ts rules incl. reserved master names
parseSingleRoleId(value: FormDataEntryValue[] | unknown): { ok: true; roleId } | { ok: false; error }
roleCeilingKeys(role, disabledModules), isMasterRole(role), isRoleInScope(actor, role)

// role-service.ts (server-only)
listRoles(actor, query: RoleListQuery): Promise<QueryResult<RoleListPage>>            // *.roles.view
getRoleSummary(actor): Promise<QueryResult<RoleSummary>>                               // total/active/disabled/usersAssigned
listRoleCountRecords(actor, category: unknown, page: unknown): Promise<QueryResult<RoleCountRecords>>
getRoleDetails(actor, roleId: unknown): Promise<QueryResult<RoleDetails>>
listRoleUsers(actor, roleId: unknown, page: unknown): Promise<QueryResult<ManagementPage<AssignedUserRow>>>
getRoleEditorModel(actor, roleId?: unknown): Promise<QueryResult<RoleEditorModel>>     // create | edit
listAssignableRoles(actor, opts?: { excludeRoleId? }): Promise<QueryResult<AssignableRoleOption[]>>
createRole(actor, input: RoleInput): Promise<RoleMutationResult>                       // *.roles.create
updateRole(actor, roleId: unknown, input: RoleInput): Promise<RoleMutationResult>      // *.roles.edit
setRoleStatus(actor, roleId: unknown, status: unknown): Promise<RoleMutationResult>    // "active" | "disabled"
deleteRole(actor, roleId: unknown, input?: { replacementRoleId?: unknown }): Promise<RoleMutationResult>
// RoleInput = { name, description, status, permissions /* FormData.getAll */ } (all unknown)
// RoleMutationResult = { ok: true; roleId; message; affectedUserCount } | { ok: false; reason; error; fieldErrors? }
//   fieldErrors keys: name | description | status | permissions | replacementRoleId

// sub-user-service.ts (server-only)
listSubUsers(actor, query: SubUserListQuery): Promise<QueryResult<ManagementPage<SubUserRow>>>
getSubUserSummary(actor): Promise<QueryResult<SubUserSummary>>                         // total/active/suspended
listSubUserCountRecords(actor, category: unknown, page: unknown): Promise<QueryResult<SubUserCountRecords>>
getSubUserEditModel(actor, userId: unknown): Promise<QueryResult<SubUserEditModel>>
createSubUser(actor, input: SubUserCreateInput): Promise<SubUserMutationResult>
updateSubUser(actor, userId: unknown, input: SubUserUpdateInput): Promise<SubUserMutationResult>
setSubUserStatus(actor, userId: unknown, change: unknown): Promise<SubUserMutationResult> // "suspend" | "reactivate"
// SubUserMutationResult = { ok: true; userId; message } | { ok: false; reason; error; fieldErrors?: SubUserFieldErrors }
// QueryResult<T> = { ok: true; data: T } | { ok: false; reason; error }
// reason: validation | forbidden | not_found | conflict | unavailable
```

Rules implemented by every mutation: the management privilege is checked on
the snapshot AND on the actor re-read inside the transaction. `reloadActor` is
the FIRST step and share-locks, in a fixed order, the actor's own rows before
reading them: platform → `platform_owners` row, then its `platform_roles` row;
workspace → `users` row, (customer) its own + main `customers` rows, its
`user_roles` row, then its `roles` row. A concurrent reassignment, edit of the
actor's role (role row FOR UPDATE), or suspension therefore serializes with the
mutation: a revocation committed first is seen; one that comes later waits —
never a grant from a stale ceiling (tested in both role and sub-user suites).
Lock order is always actor rows (SHARE) → target role (UPDATE/SHARE) → target
user / holders (UPDATE); a mutation of the actor's own role or own account is
refused BEFORE any exclusive lock (own_role / system_role / self), so it cannot
self-deadlock. A deadlock / serialization abort (40P01, 40001, P2034) rolls
everything back, is logged as a `[rbac]` warning and returns the friendly
"could not be saved, please try again". Then: the role (FOR UPDATE, or FOR
SHARE when only assigned) and the target user (FOR UPDATE) are locked; role
holders are locked before reassignment (sorted); ids outside the scope are
"not found" (tenant DB from the actor; customer roles = Master Customer + roles
of the actor's main customer; customer team = sub-customers of the main
customer; role holder counts = the main customer's tree only); master/system
roles are never mutable; the own role and self/primary accounts are never
managed; refusals for scope / ceiling / master / foreign-key attempts write
`authz.escalation_blocked` (metadata `attempt`, offending `keys`); successes
audit after commit (`role.*` with `added`/`removed` keys, `user.*`,
`user.role_changed` per user or one event with `userIds`,
`master_role.assigned`). Role name uniqueness: pre-check with the index's own
comparison + P2002 mapped to the name field. Workspace email/username: the
identity advisory lock + users + pending/rejected registrations + DB unique
indexes. Sub-customer = customer row (parent = MAIN customer, never the
acting sub-customer) + its user + one role in one transaction; its customer
name mirrors the full name; suspend/reactivate switch the customer row and
suspend deletes the sessions of its users. A new password deletes that user's
sessions and audits `user.password_reset`. Edit changes ONLY full name, role
and the optional new password (business rule); `SubUserUpdateInput` has no
email / username / account type, and extra fields of a crafted request are
ignored (tested).

Tests: `tests/rbac-policy.test.ts` (pure), `tests/rbac-roles.test.ts`
(platform roles on the control plane; tenant + customer roles on two
provisioned tenants; atomic delete via a simulated failure trigger),
`tests/rbac-sub-users.test.ts` (all three sub-user kinds, concurrency,
sessions, isolation). Helpers: `tests/support/rbac.ts`.

### Module switches (2026-10-16)

Files: `src/lib/authz/module-model.ts` (client-safe view/result types and
the confirmation texts), `src/lib/authz/module-service.ts` (server-only),
`src/app/platform/(console)/settings/modules/{page.tsx,loading.tsx,actions.ts}`,
`src/app/platform/(console)/tenants/[id]/module-actions.ts`, the shared client
list `src/app/platform/(console)/_components/module-toggle-list.tsx` and the
shadcn `src/components/ui/switch.tsx`.

```ts
// module-service.ts (server-only)
listPlatformModules(db: Pick<ControlDb,"platformModuleSetting">): Promise<ModuleStateView[]>
listTenantModules(db: Pick<ControlDb,"tenantModuleSetting">, tenantId: string): Promise<TenantModuleGroups> // { tenant, customer }
setPlatformModuleEnabled(actor: { ownerId }, moduleKey: unknown, enabled: unknown, ipAddress?): Promise<ModuleToggleResult>
setTenantModuleEnabled(actor: { ownerId }, tenantId: unknown, moduleKey: unknown, enabled: unknown, ipAddress?): Promise<ModuleToggleResult>
// ModuleStateView = { key, label, description, core, enabled, privileges: { key, label, description }[] }
// ModuleToggleResult = { ok: true; module; changed } | { ok: false; reason: "forbidden"|"invalid"|"not_found"|"unavailable"; error }
```

- Absent setting row = enabled; a core module is always reported enabled.
- A setter validates everything first: `enabled` must be a boolean; the key
  must be a catalog module of the right domain (platform → `platform.*`;
  tenant → `tenant.*` / `customer.*`) and not core; the tenant id a UUID of an
  existing tenant. Unknown, cross-domain and core keys can only come from a
  tampered request, so they are refused with a friendly message AND audited as
  `authz.escalation_blocked` (target `module`, metadata `attempt`).
- Inside one transaction: a per-module advisory lock, the actor's privilege
  re-resolved fresh (`loadPlatformAccess` on the transaction; refusal →
  `authz.denied`), the current state read, then an upsert with
  `updated_by_id`. Already in the requested state → no write, no audit
  (`changed: false`). After commit: `platform_module.enabled|disabled` or
  `tenant_module.enabled|disabled` (tenant id set), metadata `{ moduleKey }`.
- Effect is immediate: `loadPlatformAccess` / `loadDisabledTenantModules`
  read the tables on every request (proved in `tests/rbac-modules.test.ts`).
- Actions (`setPlatformModuleAction(moduleKey, enabled)`,
  `setTenantModuleAction(tenantId, moduleKey, enabled)`) start with
  `authorizePlatformAction(<key>, { ipAddress })`, re-validate the arguments
  in the service, and revalidate `/platform` (layout: navigation changes) or
  the tenant details page.
- Pages: `/platform/settings/modules` (needs `platform.modules.manage`, else
  `AccessDenied`); the tenant details page's "Module access" section (visible
  with `platform.tenants.view`; switches only with
  `platform.tenant_modules.manage`, otherwise read-only On/Off badges). Core
  modules show a "Core · always on" lock badge. Turning a module off asks for
  confirmation; turning it on applies directly. The switch shows a spinner and
  is disabled while saving; the result appears as a dismissible notice; the
  shown state changes only after the server confirms (kept on error).

### RBAC pages (all panels) (2026-10-16)

ONE implementation of the role and sub-user pages for the Platform, Tenant
and Customer panels (owner's approved design + CLAUDE.md "Reuse, Don't
Duplicate"). The two earlier copies (platform pages, workspace `_rbac`
screens) were merged on 2026-10-16; behaviour follows the approved UI spec
and the former workspace screens (see "Design decisions" below for what that
changed on the platform pages).

Layers (top → bottom):

1. Route files (per panel, thin): every `page.tsx` only renders a shared
   screen with its panel binding, e.g.
   `<RolesListScreen binding={TENANT_ROLE_SCREENS} searchParams={…} />`.
   Fixed metadata titles ("Roles & Privileges" / nav label, "Create role",
   "Role details", "Edit role", "<plural>", "Add …", "Edit …"), so no record
   name leaks into a tab title. `loading.tsx` only on `(list)` route groups
   and `/new`.
2. Panel bindings (`rbac-bindings.ts`, one per panel):
   `src/app/platform/(console)/rbac-bindings.ts` (`PLATFORM_RBAC_PANEL`,
   `PLATFORM_ROLE_SCREENS`, `SUB_PLATFORM_OWNER_SCREENS`),
   `src/app/(workspace)/tenant/rbac-bindings.ts` (`TENANT_RBAC_PANEL`,
   `TENANT_ROLE_SCREENS`, `SUB_TENANT_SCREENS`),
   `src/app/(workspace)/customer/(portal)/rbac-bindings.ts`
   (`CUSTOMER_RBAC_PANEL`, `CUSTOMER_ROLE_SCREENS`, `SUB_CUSTOMER_SCREENS`).
   A binding = `RbacPanelBinding` { `home` (dashboard), `eyebrow` ("Access
   control" platform/tenant, "Account" customer), `gutterClassName` (""
   in the platform console whose shell pads, "px-4 lg:px-6" in the portals),
   `pageActor(operation)` } + role screens { `list`, `actions` } or sub-user
   screens { `list`, `variant` platform|tenant|customer, `plural`,
   `singular`, `addLabel`, `description`, `actions` }. Types:
   `src/components/rbac/screens/types.ts`.
3. Panel actor (`rbac-actor.ts`, one per panel, server-only — the ONLY
   area-specific code): `PLATFORM_RBAC_PATHS` / `TENANT_RBAC_PATHS` /
   `CUSTOMER_RBAC_PATHS` ({ roles, users }); `authorizePlatformActor(key)` /
   `authorizeTenantActor(key)` / `authorizeCustomerActor(key)` = client IP →
   `authorize*Action(key, { ipAddress })` (refusal: friendly error +
   `authz.denied`) → `*Actor(...)` via `actorOrFailure`;
   `platformPageActor(op)` / `tenantPageActor(op)` / `customerPageActor(op)`
   = `requirePlatformAccess` / `requireTenantAccess` / `requireCustomerAccess`
   → `can(MANAGEMENT_PRIVILEGES[domain][op])` (else `PAGE_DENIED`) → actor via
   `pageActorOf`.
4. Server Actions (`roles/actions.ts`, `users/actions.ts` /
   `sub-customers/actions.ts` per panel, `"use server"`): one line each —
   `handleX(() => authorize<Panel>Actor("<exact key>"), …, <PANEL>_RBAC_PATHS)`.
   Names unchanged: platform `createRoleAction`, `updateRoleAction(roleId, …)`,
   `setRoleStatusAction(roleId, status)`, `deleteRoleAction(roleId,
   replacementRoleId)`, `loadRolePrivilegesAction`, `loadRoleUsersAction`,
   `loadRoleRecordsAction`, `loadAssignedUserRecordsAction`,
   `createSubPlatformOwnerAction`, `updateSubPlatformOwnerAction(userId, …)`,
   `setSubPlatformOwnerStatusAction(userId, change)`,
   `loadSubPlatformOwnerRecordsAction`; tenant `…Tenant…` / `…SubTenant…`;
   customer `…Customer…` / `…SubCustomer…` (same shapes).
5. Shared action handlers `src/lib/authz/management-actions.ts`
   (server-only): `handleLoadRolePrivileges`, `handleLoadRoleUsers`,
   `handleLoadRoleRecords`, `handleLoadAssignedUserRecords`,
   `handleCreateRole`, `handleUpdateRole`, `handleSetRoleStatus`,
   `handleDeleteRole`, `handleLoadSubUserRecords`, `handleCreateSubUser`,
   `handleUpdateSubUser`, `handleSetSubUserStatus`. Same pattern everywhere:
   authorize → read input → ONE service call → refresh pages (logged on
   failure) → map. Private helpers live only here: `roleInputOf` (FormData →
   RoleInput), `refusedFormState`, `refreshPages`. Sub-user create AND edit
   read `parseSingleRoleId(formData.getAll("roleId"))` first (zero / several /
   malformed → error under Role, nothing written; the service re-validates).
   Edit reads only full name, role and the password pair. Create/edit
   redirect with fixed codes (role → `<roles>/<id>?notice=role-created|
   role-saved`; sub-user → `<users>?notice=user-created|user-saved`).
   Revalidated: role changes → roles list + details; delete → roles + users
   lists; sub-user create/edit → users + roles lists; status → users list.
6. Shared plumbing `src/lib/authz/page-support.ts` (server-only):
   `requestIpAddress`, `actorOrFailure` (friendly `ACTOR_UNAVAILABLE`, logs
   `[rbac] could not build the actor for <key>`), `pageActorOf` (friendly
   `PAGE_UNAVAILABLE`), `PAGE_DENIED`, types `AuthorizedActor`,
   `PageActorResult`.
7. Shared screens `src/components/rbac/screens/` (server components unless
   noted; NO panel guard/session/action import): `roles-screens.tsx`
   (`RolesListScreen`, `RoleDetailsScreen`, `RoleEditorScreen`),
   `sub-users-screens.tsx` (`SubUsersListScreen`, `SubUserFormScreen`),
   `screen-parts.tsx` (`ScreenFrame` = relative frame + PageHeader + notice
   with the binding's gutters, `DeniedScreen`, `ActorFallback` (denied →
   AccessDenied, unavailable → friendly notice), `LoadFailed`, `DetailRow`),
   `role-details-actions.tsx` (client: Edit, Disable/Enable, Delete with the
   shared dialogs; status change → `router.replace(<details>?notice=
   role-disabled|role-enabled)`, delete → list `?notice=role-deleted`),
   `notices.ts` (fixed codes role-created, role-saved, role-deleted,
   role-disabled, role-enabled, user-created, user-saved; client-safe),
   `skeletons.tsx` (`RbacListSkeleton({ figures, gutterClassName })`,
   `RbacFormSkeleton({ gutterClassName })`), `types.ts` (bindings).
   Each screen first calls `binding.pageActor(<operation>)` (list/details
   `rolesView` / `usersView`, new `rolesCreate` / `usersCreate`, edit
   `rolesEdit` / `usersEdit`) and reads the viewer's other management
   privileges from the actor (`holdsPrivilege(actor, "rolesCreate")`, …;
   identical to `can()`). Variant platform: search "Name or username", no
   email column / field.
8. DTO → view mapping stays in `src/lib/authz/management-view.ts`; role
   filter choices in `src/lib/authz/role-filter.ts` `listRoleFilterOptions`
   (all panels).

| Route (each panel) | Privilege (else inline `AccessDenied`, HTTP 200) | Notes |
|---|---|---|
| `…/roles` (`roles/(list)/page.tsx`) | `*.roles.view` | PageHeader "Create role" with `.create`; SectionedLayout top (Summary, Role directory); `RolesSummary`, `RbacToolbar`, `RolesDirectory`; replacement roles only with `.delete` |
| `…/roles/new` | `*.roles.create` | `RoleEditor` create (assignable privileges as checkboxes, rest locked) |
| `…/roles/[id]` | `*.roles.view`; unknown / malformed / foreign id → HTTP 404 | sidebar menu: Overview (privileges + users counts open popups; "Changes" row with the policy reason when not manageable), Privileges, Assigned users (first page + "Show all N" popup); header actions only when manageable + permitted |
| `…/roles/[id]/edit` | `*.roles.edit` + manageable (else AccessDenied with the reason) | `RoleEditor` edit, prefilled, affected users |
| `/platform/users` "Sub-Platform Owners", `/tenant/users` "Sub-Tenants", `/customer/sub-customers` "Sub-Customers" (`(list)/page.tsx`) | users view | "Add …" with `.create`; `SubUsersSummary`, `RbacToolbar` (Active/Suspended; role filter from `listRoleFilterOptions`), `SubUsersDirectory` with the binding's variant |
| `…/new` | users create | `SubUserForm` create (customer: account type), roles = `listAssignableRoles` |
| `…/[id]/edit` | users edit + manageable (own / primary / above ceiling → AccessDenied with the reason); unknown id → HTTP 404 | `SubUserForm` edit, prefilled |

Not-found UI: platform keeps `roles/[id]/not-found.tsx` ("Role not found")
and `users/[id]/not-found.tsx` ("Account not found"); the workspace panels
use the area's default not-found UI.

Design decisions:
- Status toggles carry the intended change: the shared row / details actions
  call `toggleStatusAction(id, next)` — roles `"disabled"` for a row shown
  active, `"active"` for one shown disabled (computed in `RoleStatusDialog`);
  users `"suspend"` / `"reactivate"` (computed in `SubUserRowActions`). The
  services refuse a change to the state the record already has ("Refresh the
  page"), so a stale page never flips a record back. (Replaced the platform
  client wrapper components and the workspace "intents" map bound into the
  action.)
- Real HTTP 404 in all panels: no Suspense boundary may wrap the `[id]`
  routes, otherwise the shell streams first and `notFound()` answers 200.
  Therefore list skeletons live in `(list)` route groups, `[id]` routes have
  no `loading.tsx`, and the platform console has NO console-wide
  `loading.tsx` any more: its generic skeleton moved to
  `(console)/_components/console-loading.tsx` (`ConsoleLoading`) and is
  rendered by `loading.tsx` of `dashboard`, `settings`, `subscriptions` and
  `support` (same loading state as before for those sections; tenants,
  roles, users, settings/appearance, settings/modules have their own).
- Unifying on the former workspace screens changed these platform details:
  notice codes/texts (`?notice=role-created` etc. with the longer shared
  wording instead of "Role created." / "Sub-Platform Owner created."), role
  details title fixed ("Role details" instead of the role name), assigned
  users = first page + "Show all N" popup (instead of `?page=` paging),
  Overview counts open popups (instead of in-page anchors), edit-denied pages
  show the standard AccessDenied heading with the policy reason (instead of
  "You can't edit this role/account"), list sections as Card + visible
  "Summary" heading, roles list description and gap sizes from the shared
  screens, no `max-w-6xl` on the platform forms.

Tests: `tests/rbac-platform-pages.test.ts` (platform actions: refusals +
`authz.denied`, create role → `?notice=role-created`, escalation under
Privileges, Sub-Platform Owner single role, own / primary account),
`tests/rbac-platform-pages-http.test.ts` (platform pages over HTTP;
unknown / malformed ids → 404), `tests/rbac-workspace-actions.test.ts`
(tenant + customer actions; status with the intended value, stale / missing
value refused), `tests/rbac-workspace-http.test.ts` (tenant + customer pages
over HTTP on a real tenant host; 404 for unknown / foreign ids).

### Security test matrix (2026-10-16)

Every security scenario required by the owner maps to at least one passing
automated test (`file › test name`; `describe ›` prefixes only where a name
is ambiguous). `matrix` = `tests/rbac-security-matrix.test.ts` (added for the
scenarios that had no direct test; real control plane + two provisioned
tenants; Server Actions invoked like Next.js does).

| # | Scenario | Covering tests |
|---|---|---|
| a | Master Platform: every platform privilege, no tenant/customer | `authz-resolver › the %s master holds every key of its domain and none of another domain` (platform); `authz-platform › Master Platform holds every platform privilege` |
| b | Master Tenant: every tenant privilege, no platform/customer | `authz-tenant › Master Tenant: every tenant privilege and no customer or platform privilege`; `authz-resolver › the %s master …` (tenant) |
| c | Master Customer: every customer privilege, no tenant/platform | `authz-tenant › approval gives the customer's user Master Customer and the primary flag`; `authz-resolver › the %s master …` (customer) |
| d | Tenant cannot create a role with platform privileges | `rbac-workspace-actions › refuses a tenant role with a platform or customer privilege and audits the escalation`; `rbac-roles › a tenant actor cannot use platform or customer keys; a Sub-Tenant cannot reach tenant B` |
| e | Customer cannot create a role with tenant privileges | `rbac-roles › stays inside the main customer: no tenant keys, no other main customer's roles, owner = main customer`; `rbac-policy › rejects empty, unknown, other-domain, above-ceiling keys and missing requires with typed reasons` |
| f | Sub-Tenant cannot reach another tenant's roles/users | `rbac-roles › a tenant actor cannot use platform or customer keys; a Sub-Tenant cannot reach tenant B`; `rbac-sub-users › suspend deletes the sessions; tenant B's users are not found from tenant A`; `rbac-workspace-actions › refuses zero, several, customer-domain and foreign-tenant role ids; nothing is created` |
| g | Sub-Customer cannot reach another customer's roles/users | `rbac-workspace-actions › a sub-customer creates under the MAIN customer only and never reaches another main customer`; `rbac-sub-users › creates sub-customers under the MAIN customer only, with roles of that main customer only`; `rbac-workspace-http › answer 404 for another main customer's role or sub-customer and for unknown ids` |
| h | Sub-Platform Owner limited to the assigned role | `rbac-enforcement › platform Server Actions › %s refuses without %s and audits authz.denied`; `rbac-platform-pages › every action without its privilege › %s refuses without %s …`; `rbac-platform-pages-http › %s answers 200 with the access-denied state and no data`; `rbac-modules › a role with only platform.tenant_modules.manage can switch tenant modules but not platform modules` |
| i | Creating each sub-user kind without a role fails | `matrix › Sub-Platform Owner: none, several, a tenant/customer role or a tampered id is refused; nothing is created`, `› Sub-Tenant: none, several, …`, `› Sub-Customer: none, several, … no customer row is left`; `rbac-sub-users › needs exactly one valid, assignable role id` |
| j | Two or more roles fail | same three `matrix` tests; `rbac-platform-pages › createSubPlatformOwnerAction refuses zero, two, a tenant role and a malformed role id; nothing is created`; `rbac-policy › parseSingleRoleId accepts exactly one UUID string`; `role-rules › requires exactly one UUID role id` |
| k | Role from another domain fails | same three `matrix` tests (platform ↔ tenant/customer roles, tenant ↔ customer/platform, customer ↔ tenant/platform, other main customer / other tenant); `authz-tenant › a user holds a role of their own domain and scope only` (DB trigger) |
| l | Tampered role id fails safely | same three `matrix` tests (`not-a-uuid`, SQL text, comma list, random/zero UUID, empty) |
| m | Concurrent assignments never give several roles | `authz-tenant › allows one role per user: a second row fails and concurrent assignments leave exactly one`; `rbac-sub-users › reassignment replaces; concurrent assignments leave exactly one role`; `matrix › concurrent Sub-Customer reassignments leave exactly one role`; platform: one NOT NULL column (`authz-platform › requires a role for every owner and refuses to delete a role in use`) |
| n | Reassignment replaces, never merges | `rbac-sub-users › reassignment replaces the old role; a new password ends the sessions; suspend ends them too` (platform), `› reassignment replaces; concurrent assignments …` (tenant); `matrix › Sub-Customer reassignment replaces the role (never merges); several role ids on edit change nothing` |
| o | Cannot grant a privilege the admin lacks | `rbac-roles › refuses keys outside the actor's effective set and unknown keys`; `rbac-platform-pages › createRoleAction refuses a privilege above the actor's ceiling under Privileges and audits the attempt`; `rbac-sub-users › needs exactly one valid, assignable role id` (role above the ceiling); `rbac-roles › a revocation committed while the actor's mutation waits is honoured (never a stale ceiling)` |
| p | Cannot grant outside the panel's domain | `rbac-roles › refuses tenant and customer keys and audits the escalation attempt`; `rbac-workspace-actions › refuses a tenant role with a platform or customer privilege …`; `rbac-modules › tampered and malformed requests are refused` (it.each); `matrix › every privilege an action names exists in the catalog and belongs to its own panel's domain` |
| q | User cannot modify own role | `rbac-roles › never the own role, a master role or a role above the ceiling`; `rbac-sub-users › never manages self or the primary account; master holders only by masters`; `rbac-platform-pages › updateSubPlatformOwnerAction refuses the own account and the primary account`; `matrix › nobody modifies their own role or account (tenant and customer)` |
| r | Copying a master role's name/description grants nothing | `matrix › copying a master role's name or description grants nothing (platform, tenant, customer)`; `rbac-roles › rejects a copy of a master role's name (it would grant nothing) and duplicate names`; `authz-resolver › a master role's stored keys are irrelevant (privileges come from the system key)` |
| s | Disabled permissions cannot be re-enabled via role editing | `rbac-roles › refuses disabled-module keys and preserves (never adds) existing ones on edit` (platform); `matrix › disabled-module privileges cannot be (re-)enabled through tenant role editing; …`; `rbac-policy › rejects disabled-module keys and preserves (never adds) the role's existing ones`. Customer modules are all core (cannot be disabled) |
| t | Removing a privilege blocks the next request | `rbac-enforcement › revoking the privilege, changing the role or disabling the role denies the next call` (platform), `› revoked privilege, changed role and disabled module deny the next call` (tenant); `authz-tenant › shows a revocation and a disabled role on the next request (written through another connection)` |
| u | Disabling a module blocks its operations | `rbac-enforcement › switching the module off denies even Master Platform on the next call`; `rbac-modules › switching platform.tenants off removes its privileges from Master Platform on the next read; on restores them`, `› switching tenant.registrations off for tenant A removes it from A's Master Tenant but not from tenant B` |
| v | Changing a user's role applies immediately | `rbac-enforcement-http › applies on the very next request, without signing in again`; the two `rbac-enforcement` tests of row t; `rbac-sub-users` reassignment tests (row n) |
| w | Disabling an account blocks further operations | `matrix › platform: a stale fingerprint changes … a suspended account is signed out`, `› tenant: … a suspended staff account is signed out`, `› customer: a sub-customer suspended by its main customer is refused on its next request`; `session › returns null for an existing session once its owner is disabled`; `rbac-sub-users › suspend disables the sub-customer and ends its sessions; a suspended main customer blocks every sub-customer` |
| x | Stale pages / sessions cannot bypass | `matrix › platform: a stale fingerprint changes and an old form posted after the revocation is refused; …`, `› tenant: a disabled role changes the fingerprint and refuses the old form; …`; `rbac-enforcement › the fingerprint action follows the privileges and never moves last_used_at`; `rbac-workspace-actions › disables a role with the intended status and refuses a stale or missing one` |
| y | Consistent across app instances (no cross-request cache) | `matrix › two independent app instances (separate tenant database clients) agree on the next request — no cross-request cache`; `authz-platform › makes revocation, role changes and role disabling visible on the next read through another client` |
| z | A failed permission update never grants partially | `matrix › a failed permission update never grants partially: an invalid mix is refused whole, a database failure rolls everything back`; `rbac-roles › is atomic: a failure after the reassignment leaves everything unchanged`; `rbac-modules › malformed values are refused without touching anything` |
| aa | Existing authentication works | `login › returns a token that validates as a session of that owner`; `platform-http › [R5][R8] valid credentials: 303 to the dashboard and a session cookie`; `workspace-portal › signs the tenant admin in with the username or the email chosen by the Platform Owner`, `› approves once: creates the customer and its user, then the customer signs in to the customer area` |
| bb | Tenant and customer isolation intact | `workspace-portal › refuses wrong, unknown and other-tenant credentials the same way`, `› never lets one tenant review another tenant's registrations`, `› bind a token to its tenant and area, and end on revoke or idleness`; `tenant-gate-http › %s answers 404` (/platform on a tenant host); `rbac-workspace-http › never open for a customer session (redirect to the login page)`, `› never open for a staff session (redirect to the login page)` |
| cc | Legitimate existing users keep mapped access | `rbac-migration › maps existing owners: the oldest active one becomes primary master, others keep only their old capabilities`, `› maps existing roles and users: owner → Master Tenant + primary, approved customers → Master Customer + primary, nobody else` |
| dd | Every dynamic module/action is covered | `matrix › every Server Action is guarded or explicitly session-only` (static TypeScript scan of every `"use server"` module under `src/app`: each exported action must reach `authorizePlatformAction` / `authorizeTenantAction` / `authorizeCustomerAction`, directly, through a local helper or a panel `authorize*Actor`; only the allow-list — logins, logouts, sign-up, review request, fingerprints, personal appearance (`refreshAppearanceAction`, `saveCustomerAppearanceAction`) — is exempt, and stale allow-list entries fail too); the it.each refusal suites of `rbac-enforcement`, `rbac-platform-pages`, `rbac-workspace-actions`, `rbac-modules › switching needs its privilege` |
| ee | Hidden menu ≠ accessible backend | `matrix › platform: without the privilege the entry is hidden AND the direct action is refused`, `› tenant and customer: hidden Access control / Account entries and refused direct actions`; `rbac-enforcement-http › %s answers 200 with the access-denied state`; `rbac-platform-pages-http › %s answers 200 with the access-denied state and no data`; `rbac-workspace-http › answer the access-denied state without the privilege and render with Master Tenant`; `rbac-modules-http › answers 200 with the access-denied state without platform.modules.manage` |

## Change history

- 2026-10-16: Module created — requirements and owner decisions recorded
  before implementation (three isolated domains, master roles with
  system keys, master holders may assign master, Platform Owner module
  control with locked core modules, one-level sub-customers).
- 2026-10-16: Foundation implemented — catalog, control + tenant rbac
  migrations (schema, mirrors, master roles, data mapping, triggers),
  resolver, platform and workspace guards, role-aware writers (seed,
  provisioning, approval, account status, appearance), audit actions, test
  helpers and tests (catalog/mirrors, resolver, platform, tenant with a real
  provisioned database, migration mapping + idempotency). Refinements over the
  design: primary owner = oldest ACTIVE owner; master roles additionally
  protected against deletion by triggers; legacy tenant roles renamed
  "<name> (<key>)" and disabled; suspended approved accounts get their main
  customer row disabled by the migration.
- 2026-10-16: Enforcement on the existing features — every platform tenant,
  registration and appearance page/action/route checks its privilege
  (inline access-denied pages, audited refusals), navigation of all three
  panels filtered by privilege (new nav entries Roles & Privileges,
  Sub-Platform Owners, Settings → Modules, tenant "Access control", customer
  "Account"), role name in the account menus, `WorkspaceUser.isOwner` removed,
  `PermissionSync` + per-area fingerprint actions, no-role dashboard notice,
  tests `rbac-enforcement(.http).test.ts`. See "Enforcement map".
- 2026-10-16: Role and sub-user management services (backend only) — pure
  delegation-ceiling policy, server-built actors, one role service and one
  sub-user service for all three domains over per-domain stores, shared
  identity advisory lock (`src/lib/workspace/identity.ts`, registrations now
  use it), audit incl. escalation attempts, tests `rbac-policy`,
  `rbac-roles`, `rbac-sub-users`. No schema change. See "Services".
- 2026-10-16: Module switches — `/platform/settings/modules` (platform kill
  switch) and the tenant details "Module access" section (tenant + customer
  panel modules per tenant), module service with tamper audit, shadcn
  Switch, tests `rbac-modules(.http).test.ts`. No schema change. See
  "Module switches".
- 2026-10-16: Services hardened after review — `reloadActor` share-locks the
  actor's own rows and role first (no stale-ceiling grant under concurrency;
  deadlocks mapped to "try again"); sub-user edit limited to full name, role
  and password (email / account type update path removed).
- 2026-10-16: Platform role + Sub-Platform Owner pages — `/platform/roles`
  (placeholder replaced), `/new`, `/[id]`, `/[id]/edit`, `/platform/users`,
  `/new`, `/[id]/edit` composing the shared RBAC UI; thin Server Actions (one
  service call each, exact privilege first); DTO → view mapping in
  `src/lib/authz/management-view.ts`; tests `rbac-platform-pages(-http)`.
  No schema or service change. See "Platform role + Sub-Platform Owner pages".
- 2026-10-16: Tenant + Customer RBAC pages — `/tenant/roles` (+ `/new`,
  `/[id]`, `/[id]/edit`), `/tenant/users` (Sub-Tenants, `/new`, `/[id]/edit`),
  `/customer/roles` (same four) and `/customer/sub-customers` (`/new`,
  `/[id]/edit`) as shared server screens under `src/app/(workspace)/_rbac/`
  with per-panel bindings; thin Server Actions per panel; bound status
  intents; real 404 for unknown / foreign ids; `management-view.ts` gained
  `toRecordsResult`, `toPrivilegesResult`, `toActionResult`; new
  `role-filter.ts`. Tests `rbac-workspace-actions`, `rbac-workspace-http`.
  No schema or service change. See "Workspace RBAC pages".
- 2026-10-16: RBAC pages unified for all three panels — one screen layer
  (`src/components/rbac/screens/`) driven by per-panel bindings
  (`rbac-bindings.ts`) and panel actors (`rbac-actor.ts`); one set of action
  handlers (`src/lib/authz/management-actions.ts`) and page plumbing
  (`page-support.ts`); platform client wrappers, platform notices /
  skeletons, workspace `_rbac/` folder and the intents map removed; row
  actions pass the intended status (`toggleStatusAction(id, next)`); every
  sub-user create/edit parses one role id first; real HTTP 404 for unknown
  ids on all `[id]` routes (platform `(list)` groups, console-wide
  loading.tsx replaced by per-section loading files). No schema or service
  change. See "RBAC pages (all panels)".
- 2026-10-16: Final security verification — every owner-required security
  scenario mapped to automated tests ("Security test matrix"); new
  `tests/rbac-security-matrix.test.ts` for the gaps (single role for all three
  sub-user kinds via the actions, customer reassignment/concurrency, master
  name/description copies, tenant disabled-module editing, own role/account,
  stale fingerprint/old form/suspended accounts, two tenant DB clients,
  partial-update failure, hidden navigation vs direct calls, static Server
  Action guard scan). No production behaviour change.
