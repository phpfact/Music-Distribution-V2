# Tenant Management — design spec

Status: approved design for the Platform Owner's Tenant Management module.
Every implementation task for this module follows this file. If code and this
file disagree, stop and report; do not improvise.

Read first: `TRD.md` §3–§5 and §11 (isolation, provisioning, domains, migrations),
`prisma/control/schema.prisma`, `prisma/tenant/schema.prisma`,
`src/lib/db/tenant.ts`, `src/lib/platform-auth/*`, `src/app/platform/(console)/*`.

Decisions taken with the product owner:
- Layout as in §9 (list page + full-page create form + details page + edit page).
- Every tenant always gets a **SaaS subdomain**. A **custom domain** is optional,
  verified by a DNS TXT record, and never blocks activation.
- Provisioning and migrations use the existing administrative login
  (`POSTGRES_USER`), as `prisma/migrate-tenants.ts` already does. Tenant runtime
  queries always use the tenant's own non-superuser role. A dedicated
  CREATEDB/CREATEROLE provisioner login is a documented follow-up.

Out of scope: billing/plans UI, tenant-side login/RBAC/customers, deleting
tenants or their databases, 2FA (not implemented anywhere: show it as "Not
available yet", never as a working toggle).

---

## 1. Module layout

| Path | Responsibility |
|---|---|
| `src/lib/tenants/rules.ts` | Pure validation + normalization (no `server-only`, no node-only imports): full name, phone, email, username (reuses `src/lib/platform-auth/username.ts`), master password policy, DB identifiers, DB passwords, port, list query parsing. Imported by client components too. |
| `src/lib/tenants/generate.ts` | Server-only CSPRNG generators (`node:crypto`). |
| `src/lib/domains/rules.ts` | Pure hostname/subdomain/custom-domain normalization + reserved names. Client-safe. |
| `src/lib/domains/dns.ts` | Server-only DNS checks with an injectable resolver (tests). |
| `src/lib/domains/resolve.ts` | Server-only: request host → tenant; the tenant access gate. |
| `src/lib/secrets/*` | AES-256-GCM secret store in the control plane. |
| `src/lib/storage/*` | Local-filesystem file storage under `STORAGE_ROOT`; image sniffing. |
| `src/lib/rate-limit.ts` | Generic Redis fixed-window limiter (fails closed). |
| `src/lib/audit.ts` | Writes `audit_events`. |
| `src/lib/provisioning/*` | Admin PostgreSQL operations, SQL migration applier, existing-DB checker, provisioning runner. No UI imports. |
| `src/lib/tenants/service/*` | Tenant use cases (create, preview, list, summary, details, update, suspend, reactivate, retry, credential rotation, domain verification). Returns DTOs that never contain secrets. |
| `src/app/platform/(console)/tenants/**` | Pages, client components, Server Actions (thin: auth → parse → service → result). |

Rules: `server-only` on every module that touches the DB, secrets, env, fs or
DNS. Pure rule modules must not import anything server-only. Keep the existing
code style: explanatory comments on *why*, small functions, no new runtime
dependencies.

## 2. Configuration (src/lib/env.ts, compose, .env.example)

| Variable | Rule |
|---|---|
| `TENANT_SECRETS_KEY` | Required, validated with the existing `secret()` helper (placeholder + min length in production). The 32-byte AES key is derived with HKDF-SHA256 (salt `"md-tenant-secrets"`, info `"aes-256-gcm v1"`). `.env.example`: `TENANT_SECRETS_KEY=change-me-tenant-secrets-key` so `make init` generates it. Never logged. Losing it makes stored DB passwords unrecoverable: document this. |
| `PLATFORM_BASE_DOMAIN` | Default `localhost`. Lower-case hostname, validated with `domains/rules.ts`. Tenant subdomain = `<label>.<base>`. `*.localhost` resolves to loopback in browsers (RFC 6761), so dev needs no DNS. |
| `STORAGE_ROOT` | Default `path.resolve("storage")` (= `/app/storage` in the containers). Must be absolute after resolving. |

Compose `app.environment` lists variables explicitly: add the three. Dev: the
project is bind-mounted, so `storage/` lands in the repo dir → add `storage/` to
`.gitignore`. Production: named volume `app_storage:/app/storage`; the runner
stage creates `/app/storage` owned by `node` (so a new volume inherits it) and
copies `prisma/tenant/migrations` (the in-app migration applier reads it).
`next.config.ts`: `experimental.serverActions.bodySizeLimit: "3mb"` (2 MB image
+ form fields); add `"*.localhost"` to `allowedDevOrigins`.

## 3. Data model changes

### 3.1 Control plane (one migration, `tenant_management`)

`tenants`:
- `name` = the tenant profile's **Full name** (existing column).
- `contact_email` = the tenant admin's email: add CHECK `= lower(contact_email)` and a UNIQUE index.
- `admin_username VARCHAR(64) NOT NULL UNIQUE`, CHECK same format as `platform_owners_username_format_check`.
- `phone VARCHAR(16) NULL`, CHECK `phone ~ '^\+?[0-9]{7,15}$'`.
- `profile_image_key VARCHAR(255) NULL` (storage key, never a URL).
- `database_mode tenant_database_mode NOT NULL DEFAULT 'provisioned'` — enum (`provisioned`, `existing`).
- `database_port INTEGER NULL`, CHECK 1–65535.
- `pending_admin_password_hash VARCHAR(255) NULL` — Argon2id hash of the master password, held only until the `create_initial_admin` step writes it into the tenant database, then set to NULL.
- existing `database_name`, `database_user` (unique), `database_secret_ref` (= `secrets.id` as text).

`tenant_domains`:
- `status tenant_domain_status NOT NULL DEFAULT 'pending'` — enum (`pending`, `active`, `failed`).
- `verification_token VARCHAR(64) NULL` (custom domains only), `verified_at`, `last_checked_at` TIMESTAMPTZ NULL, `last_check_error VARCHAR(300) NULL` (safe to display).
- Partial unique indexes: one `subdomain` row per tenant, at most one `custom` row per tenant.

`provisioning_step` enum: add `check_database` (existing-database mode).

New `tenant_provisioning_steps (tenant_id uuid FK→tenants RESTRICT, step provisioning_step, completed_at timestamptz, run_id uuid FK→tenant_provisioning_runs, PRIMARY KEY (tenant_id, step))` — which steps have *succeeded* for this tenant. Retries skip completed steps except migration reconciliation, which always checks the deployed migration set.

New `secrets (id uuid pk, purpose varchar(50), key_version smallint, nonce bytea, ciphertext bytea, auth_tag bytea, created_at, updated_at)`.

Hand-written SQL at the end of the migration: the CHECKs above, and
`REVOKE CONNECT ON DATABASE <current_database()> FROM PUBLIC` (via `DO $$ … EXECUTE format(…) $$`), so tenant roles cannot even connect to the control plane.

### 3.2 Tenant database (one migration, `tenant_admin_login`)

`users`: add `username VARCHAR(64) NULL UNIQUE` (same CHECK format) and
`password_hash VARCHAR(255) NULL` (Argon2id PHC). Customer users may have
neither; the tenant admin has both. Nothing else.

## 4. Rules (src/lib/tenants/rules.ts, src/lib/domains/rules.ts)

All rules are applied on the server (source of truth); the client uses the same
functions for instant feedback. Error messages say what is wrong and how to fix it.

| Field | Normalize | Valid |
|---|---|---|
| Full name | trim, collapse inner whitespace | 2–200 chars; letters of any script, spaces and `. ' - &` only (no digits, no other symbols; owner decision 2026-10-15) |
| Phone (optional) | trim (the form keeps digits only while typing/pasting and drops a pasted `+91`/`0` prefix) | Indian mobile: `^[6-9][0-9]{9}$`, stored as the 10 digits (owner decision 2026-10-15; the DB CHECK below is unchanged and still satisfied) |
| Email | trim, lower-case | ≤320, one `@`, local 1–64, domain has a dot and valid labels; unique across tenants |
| Username | `normalizeUsername` | `isValidUsername` (3–64, `^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$`); unique across tenants |
| Master password | never trimmed | 12–256 chars; at least 2 of {lower, upper, digit, symbol}; must not contain the username (case-insensitive) |
| DB name / DB user | trim (no case folding: reject upper-case) | `^[a-z_][a-z0-9_]{0,62}$` (≤63 bytes); not starting `pg_`; not one of `postgres`, `template0`, `template1`, `public`, `none`, `current_user`, `session_user`, `current_role`, the control-plane DB name, `POSTGRES_USER`; DB user ≠ DB name is allowed |
| DB password, new database (manual) | none | 16–128 printable ASCII `0x21–0x7E` |
| DB password, existing database | none | 1–128 chars, no NUL |
| DB port | integer | 1–65535; default `POSTGRES_PORT` |
| Subdomain label | trim, lower-case | 3–63, `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`, not starting `xn--`, not reserved |
| Custom domain (optional) | trim, lower-case, strip one trailing dot, IDN → punycode (`node:url` `domainToASCII`, server only) | ≥2 labels, ≤253, valid labels, TLD not numeric, not an IP, not `localhost`, TLD not in {local, localhost, test, example, invalid, internal, onion}, not equal to or under the base domain |

Reserved subdomain labels: `www api app admin administrator platform dashboard console auth login logout signin signup register account accounts billing pay payments mail email smtp imap pop ftp ns ns1 ns2 dns cdn static assets media files upload uploads img images status health support help docs blog news root system internal staging dev test demo localhost`.

Generators (`generate.ts`, `crypto.randomInt`/`randomBytes` only):
- slug base from full name: ASCII-fold (NFKD, drop marks), lower-case, non-alnum → `-`, collapse, trim `-`, max 40, fallback `tenant`.
- subdomain / username candidates: the slug base; if taken or reserved, append `-` + 4 chars `[a-z0-9]`; check again (max 5 tries, then error).
- DB name: `t_<slug base with - → _, max 40>_<6 chars [a-z0-9]>`; DB user: `<db name>_app`. Both checked against the control plane **and** `pg_database` / `pg_roles`.
- master password: 20 chars, alphabet without look-alikes, at least one of each class.
- DB password: 32 random bytes, base64url (43 chars).
- verification token: 16 random bytes hex.

## 5. Secrets

`src/lib/secrets`: `encryptSecret(plain, aad)` / `decryptSecret(record, aad)`
(AES-256-GCM, 12-byte random nonce, AAD = `secret:<id>:<purpose>`);
`createSecret(tx, purpose, plain)` → id; `readSecret(id, purpose)`;
`replaceSecret(tx, id, purpose, plain)`. Tampered ciphertext or wrong key →
throws a typed error without the value. Plaintext secrets exist only in server
memory for the duration of a call. Never return them from a service, never log
them, never put them in an error message, a URL, browser storage or an audit row.

Tenant DB target: `loadTenantDatabase(tenantId)` (server-only) builds
`TenantDatabase` = `{ tenantId, database, user, password, port }` from the
control plane + secret store. `getTenantDb` connects to `POSTGRES_HOST` on that
port. Add `evictTenantDb(tenantId)` (closes the cached client) — called on
suspension and on credential rotation.

## 6. Provisioning (src/lib/provisioning)

### 6.1 Logins and connections
- **Admin** = `POSTGRES_USER`/`POSTGRES_PASSWORD` on `POSTGRES_HOST`, port = the tenant's `database_port`. Short-lived `pg.Client`s, `connectionTimeoutMillis: 5000`, never the app pool. Maintenance database `postgres` for cluster-level statements.
- **Tenant runtime role** = the tenant's own login. Used for `create_initial_admin` and `verify` (proves the runtime credentials work) and later by the app.
- Identifiers are validated by `rules.ts` **and** quoted with `escapeIdentifier`. DDL cannot take bind parameters; literals use `escapeLiteral`.
- Passwords are sent to PostgreSQL only as a **SCRAM-SHA-256 verifier** (`SCRAM-SHA-256$4096:<salt>$<StoredKey>:<ServerKey>`, computed in Node), so plaintext never appears in server logs (`log_min_duration_statement` is on).
- Error handling: map `pg` errors to safe codes/messages (`auth_failed` 28P01/28000, `database_missing` 3D000, `unreachable` ECONNREFUSED/ETIMEDOUT/ENOTFOUND, `permission_denied` 42501, `conflict`, `internal`). Full detail goes to the server log through a redactor (like `describeError`): never a password or connection string.

### 6.2 Steps

Provisioned mode, in order: `create_database_user` → `create_database` →
`grant_privileges` → `apply_migrations` → `create_initial_admin` →
`register_domain` → `verify`.
Existing mode: `check_database` → `grant_privileges` → `apply_migrations` →
`create_initial_admin` → `register_domain` → `verify`.

A step listed in `tenant_provisioning_steps` is skipped on retry except
`apply_migrations`, which always reconciles the currently deployed migration set.
Every step is idempotent in itself as well. Ownership marker: `COMMENT … IS 'md-tenant:<tenantId>'`.

| Step | What it does | Re-run / conflict rule |
|---|---|---|
| `create_database_user` | In ONE transaction on `postgres`: `CREATE ROLE r LOGIN PASSWORD '<verifier>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20` + `COMMENT ON ROLE`. | Role exists with our marker → `ALTER ROLE … PASSWORD` to the stored secret, continue. Exists without our marker → fail `resource_conflict` (never touch it). |
| `create_database` | `CREATE DATABASE d TEMPLATE template0 ENCODING 'UTF8'` (owner = admin), then `COMMENT ON DATABASE`. | Exists with our marker → continue. Exists without marker: adopt **only if** the previous run of this tenant failed/was interrupted at `create_database`, the DB is owned by the admin login and has no relations outside system schemas — then add the marker. Otherwise fail `resource_conflict`. |
| `check_database` (existing) | Same checks as the connection test (§6.4). Any failing check fails the step. | Re-runs every time it is not completed. |
| `grant_privileges` | Provisioned: `REVOKE ALL ON DATABASE d FROM PUBLIC; GRANT CONNECT, TEMPORARY ON DATABASE d TO r`. Both modes, on `d` as admin: `REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO r; ALTER DEFAULT PRIVILEGES FOR ROLE <admin> IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO r; … GRANT USAGE, SELECT ON SEQUENCES TO r`. Existing mode does **not** revoke PUBLIC at database level (not ours to change). | Naturally idempotent. |
| `apply_migrations` | Apply `prisma/tenant/migrations/*/migration.sql` in name order, as admin, Prisma-compatible (§6.3). Then `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO r`, `GRANT USAGE, SELECT ON ALL SEQUENCES …`, `REVOKE ALL ON TABLE _prisma_migrations FROM r`. Update `tenants.schema_status/version/migrated_at`. | Applied migrations are skipped by name; a checksum mismatch or an unknown applied migration fails the step (`schema_mismatch`). |
| `create_initial_admin` | As the tenant role: upsert system role `key='owner'` (`is_system=true`, name "Owner"); insert user (`username`, `email`, `name`, `password_hash` = `pending_admin_password_hash`, status active) unless a user with this username exists; ensure the `owner` role link. Then set `pending_admin_password_hash = NULL`. | Same username exists → update its password hash only while a pending hash exists. Email held by another user → fail `admin_conflict`. |
| `register_domain` | Confirms the tenant's subdomain row exists (rows are inserted at creation to reserve names). | — |
| `verify` | Subdomain DNS check (§7.2) → domain `active`, else fail with the instruction. Then as the tenant role: `SELECT 1` + the admin user exists + the schema version is the latest. | Re-runs every time it is not completed. |

### 6.3 Migration applier (Prisma-compatible)
The production runner image has no Prisma CLI, so the app applies the SQL
itself, keeping Prisma's bookkeeping so `prisma migrate deploy/status`
(used by `prisma/migrate-tenants.ts`) agrees afterwards:
- take `pg_advisory_lock(72707369)` (Prisma's own migration lock) on the connection;
- `CREATE TABLE IF NOT EXISTS "_prisma_migrations"` with Prisma's exact columns;
- per pending migration: insert a row (`id` uuid, `checksum` = sha256 hex of the file, `migration_name`, `started_at`), run the file inside `BEGIN … COMMIT`, set `finished_at` and `applied_steps_count = 1`; on error roll back, record `logs`, and fail.
- A test proves `prisma migrate status` reports the database as up to date.

### 6.4 Existing database checks (also the "Test connection" action)
One short-lived client per check, rate-limited. Returns
`{ id, label, status: "pass" | "warn" | "fail", message }[]`:
1. connect as the supplied role to the supplied database (mapped errors);
2. role is not superuser and has not `BYPASSRLS` (fail); `CREATEDB`/`CREATEROLE` → warn; role ≠ `POSTGRES_USER` (fail);
3. not already used by another tenant (control plane `database_name` / `database_user`);
4. contents: no relations outside system schemas → pass ("schema will be installed"); `_prisma_migrations` present and every applied name is one of ours → pass ("N pending migrations"); anything else → fail ("not empty and not this platform's schema; it will not be modified");
5. the admin login can reach this database and create in schema `public` (superuser or `has_schema_privilege(… 'CREATE')`) → else fail with the GRANT that fixes it.
Host is always `POSTGRES_HOST` (shown read-only in the form).

### 6.5 Runner
`runProvisioning(tenantId, actor)`:
1. On a dedicated control-plane connection take `pg_try_advisory_lock(hashtext('md:tenant-provisioning'), hashtext(tenantId))`. Not acquired → `already_running` (no change).
2. Any run of this tenant still `running` → mark `failed`, `error_code='interrupted'` (we hold the lock, so its process is gone).
3. Allowed only from tenant status `pending`, `failed`, or `provisioning` (interrupted). Never from `active`/`suspended`.
4. New run `attempt = max+1`; tenant `status='provisioning'`; audit `tenant.provisioning_started` (attempt 1) / `tenant.provisioning_retried`.
5. Each step: set `run.step`, execute, insert into `tenant_provisioning_steps`.
6. Success: run `succeeded`; tenant `status='active'`, `activated_at` (first time), `status_reason=NULL`; audit `tenant.provisioned`.
7. Failure: run `failed` with code + safe message; tenant `status='failed'`, `status_reason` = safe message; audit `tenant.provisioning_failed`. Never active.
8. Always release the lock.
Started in the background after the create/retry response (`after()` from `next/server`); the UI polls. Nothing is ever dropped or deleted automatically; there is no cleanup of partial resources (retry converges instead).

## 7. Domains

### 7.1 Rows
Created in the same transaction as the tenant: one `subdomain` row
(`hostname` = label, `status='pending'`), and optionally one `custom` row
(`status='pending'`, new `verification_token`). The unique indexes reserve the names.

### 7.2 Checks (`domains/dns.ts`, resolver injectable)
- Subdomain `<label>.<base>`: base is `localhost` or ends with `.localhost` → pass (RFC 6761). Otherwise `lookup` must return an address; else message: "`<host>` does not resolve. Add a wildcard DNS record `*.<base>` pointing to the application, then retry."
- Custom domain: TXT `_md-verify.<host>` must contain `md-verify=<token>` **and** the host must resolve. Pass → `status='active'`, `verified_at`. Fail → stays `pending`, `last_check_error`. Shown with the exact record to add. The app never creates DNS records or certificates: the UI says HTTPS for the host must be configured at the proxy/hosting.

### 7.3 Request resolution and the tenant gate (`domains/resolve.ts`)
`resolveHost(hostHeader)`: strip port, lower-case, strip trailing dot. IP
addresses and the base domain itself → `platform`. `<label>.<base>` (exactly one
extra label) → subdomain row lookup. Any other host → custom row lookup, only
`status='active'`. Result: `platform` | `unknown` | `{ tenant: { id, name, status, schemaStatus } }`.
`getTenantAccess(host)` → `allowed` only for `status='active'` and
`schema_status='current'`; otherwise `suspended` | `not_ready` | `unknown`.
**Every future tenant-facing route must go through this gate.**
- `src/app/page.tsx`: on a tenant host render a minimal status page (active →
  "<name> — the tenant portal isn't available yet"; suspended → "This workspace is
  suspended."; not ready → "This workspace is being set up."; unknown → `notFound()`).
  On the platform host keep the current page unchanged.
- `src/proxy.ts`: requests for `/platform/**` whose host is not the platform host
  (base domain, `localhost`, `127.0.0.1`, IPs) → 404. Pure string logic, no DB.

## 8. Service behaviour

### 8.1 Create (`createTenant(input, actor)`)
1. Rate limit (per owner, 20/hour). 2. Validate every field (§4); collect all field errors at once. 3. Mode rules: one switch per form section — `loginMode`, `databaseCredentialMode`, `subdomainMode`, each `∈ {auto, manual}` — and `databaseMode ∈ {provisioned, existing}`; `existing` requires `databaseCredentialMode = manual`. An `auto` section submits its *previewed* identifiers (login: username; database: DB name + DB user; subdomain: subdomain) and the server validates them like manual input. Secrets of an `auto` section are always generated on the server: `loginMode = auto` → master password; `databaseCredentialMode = auto` → DB password and the configured port. Sections are independent (e.g. generated login with a typed database). 4. Uniqueness: control plane (username, email, subdomain, custom domain, DB name, DB user) and, for `provisioned`, `pg_database` / `pg_roles`; a conflict on a generated value (its own section on `auto`) says "<value> is no longer available — regenerate". 5. `existing`: run §6.4; any `fail` → reject with the check list. 6. Profile image (optional): validate (§8.6), store. 7. One transaction: tenant (`status='pending'`, `slug` = subdomain label), domain rows, DB secret, Argon2id `pending_admin_password_hash` (reuse `hashPassword`), audit `tenant.created`. Unique violations (races) → field errors. Image stored but transaction failed → delete that new file. 8. Start the runner in the background. 9. Return `{ tenantId, generatedMasterPassword? }` — the generated master password is returned **only** when `loginMode = auto`, **once**, and is never stored or logged. Audit metadata records the three section modes, `databaseMode` and `hasCustomDomain` (never values).

`previewGeneratedValues(fullName)` → `{ username, subdomain, databaseName, databaseUser, port }` (no passwords), rate-limited (60/5 min).

### 8.2 Read
- `getTenantSummary()` → `{ total, active, suspended, pendingSetup, failed }` from one `GROUP BY status` (`pendingSetup` = pending + provisioning + failed).
- `listTenants({ q, status, page })`: page size 20; `page` 1–10000 (invalid → 1); `q` trimmed ≤100, `%`/`_`/`\` escaped, `ILIKE` on name, admin username, email, domain hostnames (strip a trailing `.<base>`); `status ∈ all|active|suspended|pending|failed` (`pending` = pending + provisioning). Ordered `created_at DESC, id DESC`. Returns rows + `total` + `pageCount`.
- `getTenantDetails(id)` (UUID-validated, else not found): profile, login (username, email, 2FA "not available"), database (mode, name, user, port, host label, `hasPassword: true` — never the value), domains (with verification instructions), provisioning (steps with done/failed/pending, last run, attempt, safe error, `canRetry`), status history from `audit_events` (suspended/reactivated/created/provisioned/failed, actor username, time, reason).
DTOs never contain password hashes, secret refs, ciphertext or connection strings.

### 8.3 Lifecycle
- `suspendTenant(id, reason, actor)`: only from `active`; reason trimmed, 1–500 chars, whitespace-only rejected; sets `status='suspended'`, `status_reason=reason`, `suspended_at=now()`; audit `tenant.suspended` with the reason; `evictTenantDb`. Data, database and files untouched.
- `reactivateTenant(id, actor)`: only from `suspended`; sets `status='active'`, `status_reason=NULL` (keeps `suspended_at`); audit `tenant.reactivated`. History stays in `audit_events`.
- `retryProvisioning(id, actor)`: only when `canRetry` (status `failed`, or `provisioning` with no lock held); rate-limited; starts the runner.
- All state changes use a conditional update (`WHERE id = $1 AND status = <expected>`) so concurrent clicks cannot double-apply.

### 8.4 Edit (`updateTenantProfile`)
Editable: full name, phone, profile image (replace/remove), email, username,
subdomain label, custom domain (add/change/remove). Unchanged fields are left
alone. Username/email when the tenant admin already exists in the tenant DB:
hold the shared workspace identity lock, validate the primary staff account and
check user plus pending/rejected registration reservations. Save the desired
profile with its immutable `admin_user_id`, incremented `admin_identity_version`
and `admin_identity_sync_pending` marker in the control-plane transaction, then
commit the tenant identity change by that immutable ID. A stale profile version
is refused. Interrupted tenant commits retain durable desired state; the next
edit (including a no-change submission) or master-password reset reconciles it
under the same lock. Only the matching revision may clear the recovery marker.
Control-plane refusals happen before the tenant write; after a durable profile
commit, a tenant failure reports pending synchronization and preserves any new
referenced image.
Subdomain change → row `pending` → immediate DNS check. Custom domain
change → new token, `pending`. Audit `tenant.updated` with the changed field
*names* only. Never regenerates credentials.

### 8.5 Credentials (deliberate, separate actions, audited, rate-limited 10/15 min)
- **Reset master password**: auto (generated, shown once) or manual (policy §4). Tenant admin exists → update `users.password_hash` in the tenant DB; else → replace `pending_admin_password_hash`. Audit `tenant.admin_password_reset`.
- **Rotate database password** (provisioned mode): new secret → `ALTER ROLE … PASSWORD '<verifier>'` → replace secret → `evictTenantDb`. Audit `tenant.database_password_rotated`.
- **Update database password** (existing mode): the owner enters the new password; it is verified by connecting before it is saved. Audit `tenant.database_password_updated`.
- Changing database name, user, port or mode is not supported after creation; the UI says so.

### 8.6 Profile images
PNG, JPEG or WebP only, ≤ 2 MB (2 097 152 bytes), detected from magic bytes
(never the client's content type or file name). No SVG. Key
`tenants/<tenantId>/profile/<uuid>.<png|jpg|webp>`; path built only from that
pattern, resolved under `STORAGE_ROOT` and checked to stay inside it. Written to a
temp file then renamed. Served by `GET /platform/tenants/[id]/avatar` (platform
session required, else 404; `Content-Type` from the extension,
`X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`,
`Cache-Control: private, max-age=300`). Old file deleted after a successful replace/remove.

### 8.7 Security checklist (every action)
`requirePlatformOwner()` first; never trust client status/ids (UUID-validate,
re-read from DB); Server Actions keep Next's Origin check (CSRF); Prisma or
parameterized SQL only, identifiers validated + quoted; rate limits fail closed;
audit with `actor_type='super_admin'`, `actor_id` = owner id, `ip_address` from
`clientIpFromForwardedFor`; errors to the browser are safe messages, detail to the
log via a redactor.

## 9. UI

Follow the existing console: tokens `bg-canvas bg-surface bg-surface-2 border-line text-fg text-fg-muted text-fg-subtle text-accent bg-accent-soft bg-accent text-accent-fg`, `FOCUS_RING`, `Icon` (add Lucide paths as needed), cards `rounded-xl border border-line bg-surface`, page header pattern of `dashboard/page.tsx` (eyebrow `text-xs font-medium tracking-wider text-accent uppercase`, `h1 text-2xl sm:text-3xl font-semibold tracking-tight`). Light and dark must both work (theme resolves from the owner's personal override, the platform default, then the application default; see `docs/appearance.md`). Status colours (Tailwind palette, always with `dark:` variants): emerald = active/ready/pass, amber = pending/provisioning/warn, red = suspended/failed/fail, zinc = neutral. Every status is text + colour, never colour alone.

### 9.1 Shared primitives (`(console)/_components/`)
`ui/button` class helpers (primary = `bg-accent text-accent-fg`, secondary = bordered, danger = red), `Field` (label, required marker, hint, error with `aria-describedby`, optional "Generated"/"Manual" tag), input/select/textarea classes (h-10, `rounded-lg border border-line bg-surface`, error border red, focus ring), `PasswordInput` (Show/Hide toggle with `aria-pressed`, as the login form), `CopyButton` (clipboard, "Copied" state with `aria-live`), `FormSection` (numbered card with title + description), `Notice` (success/error/warning/info; `role="status"` or `role="alert"`), `ConfirmDialog` (native `<dialog>` + `showModal()`, focus trap, Escape, labelled title/description, optional required reason textarea, pending state), `StatusBadge` (tenant status), `Spinner`, `Avatar` (image or initials via `getInitials`).

### 9.2 `/platform/tenants` (server component; nav item becomes `available`)
Header: eyebrow "Platform management", h1 "Tenant Management", text "Create, review and manage the tenants registered on the platform.", primary "Create tenant" (→ `/platform/tenants/new`).
Widgets (4 cards, as the dashboard's): Total tenants, Active, Suspended, Pending setup (sub-line "N failed" in red when > 0). Real values; zero is shown as 0; if the summary query fails each card shows "—" + "Couldn't load" (no fake numbers).
Toolbar: search input (debounced 300 ms, updates `?q=` via `router.replace` in a transition, resets page), status `<select>` with optgroups "Account status" (Active, Suspended) and "Setup status" (Pending setup, Failed), "All statuses" default. Filter state lives in the URL (survives reload/back). Pending transition → table dims + spinner.
Secondary menu (top bar, sticky): Summary, Tenant Directory. Summary cards (Total, Active, Suspended, Pending setup and its "N failed" note), the directory total badge and the "Showing a–b of n · Page x of y" line are buttons that open a count-details dialog: how the figure is calculated, and the exact tenants (id, name, status, created date only), paged on the server (`loadTenantCountRecordsAction` → `listTenantCountRecords`).
Table (`xl:` and up) with columns: avatar, Tenant (name + "Created <date>" below it; the admin username is not listed — it is a credential, masked on the details page), Contact (email + phone below, each masked behind an eye button), Domain (subdomain host; custom host + "pending" tag), Database (Ready / Provisioning / Failed / Pending + "Existing" tag), Status (StatusBadge, suspended shows reason in `title`), Actions: "View" link, overflow menu with Edit, Suspend/Reactivate (only when valid). Below `md`: stacked cards with the same data. Pagination: "Showing a–b of n", Previous/Next links (disabled states), only when `pageCount > 1`.
Empty states: no tenants at all → icon, "No tenants yet", "Create the first tenant to give it its own database and subdomain.", "Create tenant". No match → "No tenants match your search" + "Clear filters".
`loading.tsx` skeleton for the route. Notices for action results (`?notice=…` codes mapped to fixed messages; never free text from the URL).

### 9.3 `/platform/tenants/new` (client form, full page)
Back link "Tenants". Header h1 "Create tenant". Secondary menu (sticky; beside the form from `lg`, a top bar below it): Personal Information, Login Information, Database Information, Domain Information; it hides itself once the success panel replaces the form. No global mode control: each section that has generated values (2, 3, 4) has its own segmented **Auto-Generate | Manual** switch in its header; all start on Auto-Generate. Values typed in Manual are kept if the section is switched back and forth; the first switch of a section to Manual fills that section's empty identifiers from the preview (never passwords).
Sections (FormSection, numbered):
1. **Personal Information** — Full name* (hint "Use letters, spaces and . ' - & (no digits)."); Phone (masked `SensitiveInput`, digits only, hint "10-digit Indian mobile number, e.g. 9876543210"); Profile image: round preview (initials until chosen), "Upload image" / "Change" / "Remove", hint "PNG, JPEG or WebP, up to 2 MB", client-side type/size check with inline error; preview via object URL (revoked on change/unmount).
2. **Login Information** — Username*; Email* (masked `SensitiveInput`, trimmed on blur); Master password* (manual: PasswordInput + strength checklist live; auto: read-only text "Generated when you create the tenant — shown once"); Two-factor authentication: disabled row "Not available yet — two-factor sign-in isn't supported for tenant accounts." (no toggle).
3. **Database Information** — Auto: a note that a new database, user and password are created on the configured server (its host masked behind an eye button) and port, password stored encrypted and never shown, and that attaching an existing database needs Manual. Manual: radio "Create a new database" | "Use an existing database"; Database name, Database user, Database password (PasswordInput), Port (default from server), Server (read-only, host label, masked). Existing mode: "Test connection" secondary button → check list (pass/warn/fail rows with icons + messages); hint "The database must be empty or already contain this platform's schema. Nothing in it is deleted or overwritten."
4. **Domain Information** — SaaS subdomain* (input with trailing `.<base>` addon); Custom domain (optional) with hint "Requires a DNS TXT record before it becomes active. Your SaaS subdomain works in the meantime."
Auto-Generate section: its generated fields are **hidden**; a note says what will be generated, with a live status (waiting for the full name / preparing values / ready). The preview is requested (debounced on full-name change) only while at least one section is on Auto. A preview failure, or an error on a hidden value (e.g. "<value> is no longer available — regenerate."), is shown in that note with a "Regenerate" button; the error-summary link focuses the section's switch. Fields that always need input stay visible (Email, Custom domain). Manual section: its fields are editable. Username, database name and database user inputs are masked (`SensitiveInput`, eye button); passwords use `PasswordInput`.
The section switches are disabled while generated values load. Submit "Create tenant" (pending: spinner + "Creating…", disabled to prevent duplicates); "Cancel" → list, after a confirmation when anything was entered. Errors: field errors inline + a summary Notice at the top listing each section with problems and, by name, every invalid field (each a link that focuses it; no bare counts); first invalid field focused; all non-secret values preserved (passwords are re-entered only if the server rejected them).
Success: replace the form with a success panel: "Tenant created", text "Setup runs in the background: database, schema, admin account and domain.", a "Generated values" list of the identifiers the Auto sections submitted (username, database name/user, subdomain host), each masked (`SensitiveValue`: eye + Copy); and, when the login was generated, a highlighted box "Master password — copy it now. It won't be shown again." with the value masked (eye) + Copy; buttons "Create another tenant" and "View tenant" (→ details); while a generated master password is shown, both ask "Have you copied the master password?" first. The password lives only in component state; no storage, no URL.

### 9.4 `/platform/tenants/[id]` details
Header: Avatar, name, StatusBadge, created date (no username: it is masked in the Login Information card); actions: Edit, Suspend (danger, only active), Reactivate (only suspended), Retry setup (only `canRetry`). Suspended → red Notice "Suspended on <date> by <owner>: <reason>" (an owner's username is masked behind an eye button; "System" is not).
Secondary menu (sticky; beside the content from `lg`): Setup Progress (only while that card is shown), Personal Information, Login Information, Database Information, Domain Information, Status History.
Setup in progress → progress card: steps list (done ✓ / running spinner / failed ✕ / waiting ○) with labels ("Create database user", "Create database", "Check existing database", "Grant privileges", "Install schema", "Create admin account", "Register domain", "Verify"), attempt number, auto-refresh every 2 s (`router.refresh()`) while `pending`/`provisioning`, stops otherwise. The progress sentence ("n of m steps done") opens a dialog listing every step with its state. Failed → error Notice with the safe message + "Retry setup".
Cards: **Personal Information** (name; phone and email masked with eye buttons); **Login Information** (username and email masked with eye buttons, 2FA "Not available yet", "Reset master password"); **Database Information** (mode, name, user and server masked with eye buttons, port, password "Stored encrypted", schema status/version; "Rotate password" (provisioned) or "Update password" (existing); note "Database name, user and port can't be changed after creation."); **Domain Information** (subdomain host + status; custom domain + status; when pending: the TXT record (name/value with CopyButtons) + "Check DNS"; HTTPS note); **Status History** (timeline from audit events; owner usernames masked; shared empty state).
Dialogs (ConfirmDialog): Suspend (required reason textarea, 500 max with counter, explains "The tenant loses access immediately. Its database, files and domain are kept."), Reactivate (confirm), Retry setup (confirm), Reset master password (Auto/Manual; result shows the password once with CopyButton), Rotate DB password (confirm), Update DB password (password input; verified before saving).

### 9.5 `/platform/tenants/[id]/edit`
Same section look as create, with the same secondary menu (Personal, Login and Domain Information), prefilled from persisted values: Personal Information (name, phone, image change/remove), Login Information (username, email — both masked; note "Passwords are changed with Reset master password on the tenant page."), Domain Information (subdomain, custom domain). No secret fields. "Save changes" (pending/disabled) + "Cancel" (asks first when there are unsaved changes). After save → back to details with a success notice; when a domain change needs DNS, the notice says so.

### 9.6 Dashboard
`dashboard/page.tsx`: "Total Tenants" and "Active Tenants" cards show real values from `getTenantSummary()` (same failure state as §9.2); the other two cards stay as they are.

## 10. Tests (vitest, run inside the app container: `make test`)
Unit: every rule in §4, generators (format, uniqueness across many draws), secret crypto round trip + tamper/wrong-key failure, SCRAM verifier format, image sniffing, query parsing, host resolution parsing.
Integration (scratch control DB + the dev PostgreSQL server): create auto/manual, required fields, duplicates (username, email, subdomain, custom domain, DB name, DB user, existing `pg_database`), provisioning creates a dedicated DB + non-superuser role, tenant role cannot connect to another tenant's DB or to the control plane, Prisma `migrate status` agrees, admin password stored as Argon2id, injected step failure → `failed` (never `active`), retry converges without duplicate DB/role/run rows, concurrent runners → one runs, existing mode (empty DB accepted, wrong password rejected with a clear message, superuser rejected, foreign non-empty DB rejected), suspend requires reason, gate denies suspended, reactivation keeps history, search/filter/pagination/summary, DTO JSON and captured console output never contain the test passwords, unauthorized HTTP access to every tenant route → redirect to login / 404.
Test resources: tenant names start with `Test ` so DB/role names start with `t_test_`; a teardown drops exactly the DBs/roles the run created (guarded by the `t_test_` prefix **and** the `md-tenant:` marker of a tenant in the scratch control DB). Never drop anything else.

---

## 11. Implementation notes (as built)

Deviations from the sections above, each deliberate:
- **Migration bookkeeping** (§6.3): the `_prisma_migrations` row is written inside each migration's own transaction, so a crash can never leave a "failed, not rolled back" row that blocks every retry; a failure is recorded with `rolled_back_at` set.
- **`verify`** (§6.2): the schema version is confirmed through the administrative login, because the tenant role deliberately has no access to `_prisma_migrations`. The tenant role still proves it can connect and that the admin exists as an active owner.
- **Existing-database checks** (§6.4): checks 2, 4 and 5 run as the administrative login and all five run concurrently, so the owner sees every finding at once even with a wrong password, and an unreachable server costs one timeout.
- **Host rules** (§7.3): `src/proxy.ts` also treats `localhost` as the platform host; `resolveHost` treats only IPs and the base domain as the platform.
- **List and details layout** (§9.2, §9.4): the table is shown from `xl` (cards, two per row from `md`, below it); detail cards go two-up from `xl`.
- **Not found**: an unknown tenant id renders "Tenant not found" with HTTP 200 + `noindex`, because `loading.tsx` makes Next stream the page before `notFound()`.
- **Create rate limit** (§8.1): counted before validation, so invalid submissions count too (client-side validation catches most of them first).
- `src/app/platform/(console)/tenants/labels.ts` (plain data) is imported by `src/lib/tenants/service` and `src/lib/domains/resolve.ts`.

Follow-ups, not built:
- A dedicated provisioning login (CREATEDB/CREATEROLE, not a superuser) instead of `POSTGRES_USER`.
- Backups of tenant databases and of the `app_storage` volume (`make backup` covers the control plane only).
- The tenant-facing application itself (tenant login, RBAC, customers): every route must go through `getTenantAccess`.
- Defence in depth on suspension: `ALTER ROLE … NOLOGIN` for platform-created roles (and back on reactivation).
- Trigram indexes for tenant search once the tenant count makes `ILIKE` scans slow; a rate limit on profile edits.
