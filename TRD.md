# Technical Requirements Document (TRD)

## Multi-Tenant Music Distribution SaaS

_Status:_ Initial technical baseline\
_Version:_ 1.0\
_Purpose:_ Define a practical implementation approach for the approved
MVP without requiring Kubernetes or Docker Swarm.

---

## 1. Technology Stack

---

Area Technology Requirement

---

Web application Next.js Use a supported Next.js
App Router setup.

Language TypeScript Use TypeScript for
application code.

Database PostgreSQL Separate database and
separate database user
for every tenant.

ORM / Migrations Prisma Use Prisma for table
migration and ORM.

Cache / coordination Redis Use for appropriate
caching, rate limiting,
queue coordination, or
temporary state.

Authentication Auth.js (formerly Use a compatible,
commonly called maintained Auth.js
NextAuth.js) setup; confirm the
exact provider/version
before implementation.

Runtime / backend logic Node.js Implement tenant
provisioning and
server-side business
logic in
Node.js/TypeScript.

Local and deployment Docker Use Docker for
environment reproducible
environments.

Production Standard Docker-based Do not require
orchestration hosting / managed Kubernetes or Docker
hosting Swarm. The exact
hosting provider
remains an open
decision.

---

_Important terminology:_ Auth.js is the likely intended authentication
library when referring to "OAuth.js." OAuth is an authorization
protocol, not itself a complete authentication application. Confirm the
exact package and provider configuration during implementation.

## 2. Recommended Application Structure

Keep the initial system modular. A monorepo is reasonable but not
mandatory.

Suggested logical modules: - `web`: Next.js user interface and
server-side routes/actions. - `auth`: authentication configuration and
session handling. - `tenants`: tenant registration, lookup, status, and
lifecycle. - `provisioning`: creation and validation of tenant databases
and database users. - `domains`: subdomain normalization and tenant
resolution. - `authorization`: roles, permissions, and policy checks. -
`customers`: customer and sub-customer management. - `storage`:
tenant-scoped file handling. - `audit`: security-sensitive and
administrative event records. - `shared`: common types, schemas,
validation, and utilities.

Use clear module boundaries. Do not duplicate authorization or
tenant-resolution logic across pages.

## 3. Tenant Isolation Architecture

### 3.1 Control plane and tenant data plane

Use a central _control-plane database_ for platform-wide records, such
as: - Tenant ID. - Tenant name and slug. - Tenant status. - Subdomain. -
Tenant database name. - Tenant database username or credential
reference. - Provisioning state and timestamps. - Plan identifier. -
Audit and operational metadata.

Do not store tenant passwords or database secrets as plain text in this
database. Store secrets in environment-backed or dedicated secret
storage and keep only a safe reference where possible.

Each tenant has a separate _tenant PostgreSQL database_ containing
that tenant's application data, such as: - Tenant users and tenant-level
roles. - Customers and sub-customers. - Artists and labels. -
Audio/video releases and metadata. - Tenant-specific settings. -
Tenant-specific operational records.

The control-plane database must not become a place where tenant business
records are mixed together.

### 3.2 Database users and privileges

For each tenant: - Create a dedicated database. - Create a dedicated
database login/user. - Grant that user access only to its own
database. - Apply least-privilege permissions. - Do not use the
PostgreSQL superuser for normal application queries. - Keep
administrative provisioning credentials separate from runtime tenant
credentials. - Never expose database connection strings to the browser.

A separate database and database user provide a strong boundary, but the
application must still correctly resolve the tenant and protect files,
caches, jobs, and logs.

### 3.3 Tenant context

For every request: 1. Normalize and validate the host. 2. Resolve the
host/subdomain to a tenant record in the control plane. 3. Verify the
tenant is active and provisioning is complete. 4. Establish a trusted
tenant context on the server. 5. Select the correct tenant database
connection. 6. Perform authentication and authorization checks. 7.
Execute the operation only against that tenant's database. 8. Ensure
tenant context is not taken from an untrusted request body or query
parameter.

Do not trust a client-provided `tenantId` as the authority for selecting
a database. The validated host and authenticated server-side context
should be the source of truth, with any cross-checks needed for
custom-domain support later.

## 4. Tenant Registration and Provisioning Flow

Recommended flow:

1.  Validate registration input on the server.
2.  Normalize the requested tenant slug and reject reserved or invalid
    names.
3.  Check slug uniqueness in the control-plane database.
4.  Create a tenant record with a `provisioning` status.
5.  Allocate a unique database name and database username using safe,
    deterministic naming rules.
6.  Use a restricted provisioning connection to create the tenant
    database and tenant database user.
7.  Grant only the required privileges.
8.  Apply the current database schema/migrations to the new tenant
    database.
9.  Create the initial tenant administrator in the tenant database, or
    use a carefully designed bootstrap step that is completed before
    activation.
10. Register the tenant subdomain mapping in the control plane.
11. Verify that the database connection, required schema, and domain
    mapping work.
12. Mark the tenant `active` only after all mandatory steps pass.
13. Notify the user that the tenant platform is ready.

### 4.1 Provisioning status model

Suggested statuses: - `pending` - `provisioning` - `active` - `failed` -
`suspended` - `deprovisioning`

Use a separate error code/message safe for display and detailed internal
logs for diagnostics. Do not include passwords, connection strings, or
secrets in logs.

### 4.2 Safe retries and partial failures

Provisioning must be idempotent or explicitly detect existing
resources: - A retry must not create duplicate tenant records, users, or
databases. - If database creation succeeds but migrations fail, keep the
tenant inactive and record the failed step. - Retry only the failed or
safely repeatable steps. - Use a lock or equivalent coordination so two
registration requests cannot provision the same slug simultaneously. -
Add rate limiting and abuse protection to registration. - Never mark a
tenant active if the database, schema, initial admin, or domain mapping
is incomplete.

## 5. Subdomain and DNS Design

### 5.1 Local development

Use a predictable local domain strategy supported by the development
environment. Configure the local reverse proxy or development host
routing so a tenant hostname can reach the Next.js application.

Docker Compose can run the app and its supporting services locally.
Tenant databases may be created inside the PostgreSQL service or on a
configured PostgreSQL server. Keep tenant databases logically separate
even when they share the same PostgreSQL server.

### 5.2 Production

A tenant subdomain does not normally require creating a new DNS record
for every tenant if the DNS provider supports a wildcard record.

Recommended pattern: - Configure a wildcard DNS record such as
`*.example.com` to point to the application entry point. - Configure
TLS/HTTPS for the base domain and wildcard tenant subdomains using a
compatible certificate and hosting setup. - Resolve the incoming
hostname in the application and map it to the tenant in the control
plane. - Reserve system subdomains such as `www`, `api`, `admin`, and
other operational names. - Validate tenant status before serving tenant
content.

Wildcard DNS and TLS support depend on the chosen DNS, certificate, and
hosting providers. Verify these capabilities before deployment. Do not
promise that application code alone can configure DNS or TLS.

## 6. Docker and Deployment

### 6.1 Local environment

Use Docker Compose for a repeatable local setup, for example: - Next.js
application. - PostgreSQL service. - Redis service. - Optional local
reverse proxy if needed for tenant subdomain testing.

Use named volumes for local database persistence. Keep secrets in an
uncommitted `.env` file for local development and provide a safe
`.env.example` containing placeholders only.

### 6.2 Production environment

Kubernetes and Docker Swarm are not required.

Choose a production hosting provider that supports the required
Node.js/Next.js runtime, persistent or managed PostgreSQL, Redis if
needed, wildcard domain/TLS configuration, environment secrets, logs,
and backups. The app may be deployed as a standard container or through
a provider-managed Node.js deployment workflow.

Production deployment should include: - HTTPS. - Secure
environment/secret configuration. - Managed or properly maintained
PostgreSQL. - Database backup and restore procedures. - Migration
execution procedure. - Health checks and structured logs. - Resource and
connection limits. - A documented deployment and rollback process.

Do not assume that local Docker Compose is itself the production hosting
solution. Docker provides a consistent packaging and runtime approach;
the production host still needs to run and manage the application and
services.

## 7. PostgreSQL Connection Management

A separate database per tenant can result in many database connections
if each request creates a new connection or pool.

Requirements: - Reuse database connections where the runtime permits. -
Avoid creating a new connection pool on every request. - Define
connection timeouts and pool limits. - Calculate the total possible
connections across active tenants. - Consider a compatible connection
pooler or managed database features when tenant count grows. - Ensure
database selection is server-side and cannot be manipulated by a user. -
Do not keep a separate permanently open pool for every tenant without
measuring the connection impact.

The exact pool strategy depends on the production runtime, hosting
model, and expected tenant count.

## 8. Authentication and Authorization

### 8.1 Authentication

- Configure Auth.js with the selected sign-in provider(s).
- Keep secrets server-side.
- Use secure cookies and production HTTPS.
- Define session expiry and account recovery requirements.
- Confirm how a user signing in at a tenant subdomain is associated
  with that tenant.
- Do not assume OAuth alone implements tenant authorization or RBAC.

### 8.2 Authorization / RBAC

Create a centralized authorization service with checks such as: -
`can(user, permission, resource, tenantContext)`

Enforce authorization in server routes, server actions, and service
methods. UI visibility is for usability only and must not be the
security boundary.

Minimum principles: - Deny by default. - Do not allow tenant users to
assign global Super Admin permissions. - Prevent privilege escalation. -
Check customer/sub-customer ownership and hierarchy where applicable. -
Audit sensitive role and permission changes. - Test both allowed and
denied access.

## 9. File Storage Isolation

The product requires tenant files to be isolated, but the exact storage
provider has not yet been selected.

Implementation requirements: - All file operations must use trusted
tenant context. - Store files under tenant-specific
namespaces/directories or tenant-specific buckets, according to the
selected storage design. - Do not use a client-supplied path as a
storage path. - Validate file type, size, and upload authorization. -
Prevent path traversal and cross-tenant file access. - Keep private
media private; use authorized download endpoints or short-lived signed
URLs where supported. - Keep storage credentials server-side. - Define
backup, retention, and deletion behavior before production.

A separate database does not automatically isolate files. Storage
isolation must be implemented separately.

## 10. Redis and Background Jobs

Use Redis only where it provides a clear purpose, such as: - Rate
limiting. - Cache for non-sensitive or tenant-scoped data. - Queue
coordination for longer operations. - Short-lived provisioning locks, if
implemented with correct expiry and failure handling.

Requirements: - Tenant-specific cache keys must include a stable tenant
identifier. - Never reuse a cache entry across tenants. - Do not use
cached tenant permissions indefinitely; invalidate or expire them
appropriately. - Do not rely on Redis as the only durable record of
provisioning status. - If a queue is used for provisioning, persist job
status in the control plane and make jobs retry-safe.

The exact queue library and worker deployment model remain to be
selected.

## 11. Database Schema and Migrations

Use Prisma for table migration and ORM.

Maintain: 1. A control-plane schema for global tenant metadata. 2. A
tenant schema template/migration set applied independently to each
tenant database.

Requirements: - Version tenant migrations. - Apply migrations to new
tenant databases before activation. - Define how existing tenants
receive later schema changes. - Track migration status per tenant. -
Handle failed migrations without marking a tenant healthy. - Test
migrations on a disposable tenant database before broad rollout. - Never
run tenant migrations with a normal low-privilege application login if
elevated migration permissions are required.

## 12. Suggested Core Entities

### Control plane

- `tenants`
- `tenant_domains`
- `tenant_provisioning_runs` or equivalent status records
- `plans` (even if there is only one free plan initially)
- `audit_events`

### Per-tenant database

- `users`
- `roles`
- `permissions`
- `role_permissions`
- `user_roles` or an equivalent role assignment model
- `customers`
- `customer_relationships` or a clear parent-customer reference
- `artists`
- `labels`
- `audio_releases`
- `video_releases`
- `release_assets` or metadata for stored files

These are suggested logical entities, not a finalized physical schema.
Confirm relationships, required fields, deletion behavior, and release
workflow before implementing the detailed schema.

## 13. Security and Operational Requirements

- Validate inputs on the server.
- Use parameterized database queries or a safe ORM/query builder.
- Apply CSRF protections where relevant to the chosen
  authentication/session approach.
- Add registration and login rate limits.
- Protect against brute force, privilege escalation, insecure direct
  object references, and host-header/tenant-resolution abuse.
- Do not reveal whether a private tenant database or user exists in
  public error messages.
- Keep structured logs free of credentials, tokens, and private media
  URLs.
- Audit tenant creation, suspension, role changes, and provisioning
  retries.
- Define backup, restore, tenant deletion, and incident-response
  procedures.
- Keep dependencies updated and scan for known vulnerabilities.

## 14. Testing Requirements

### Tenant isolation

- Tenant A cannot access Tenant B's database.
- Tenant A cannot access Tenant B's files.
- Tenant A cannot access Tenant B's cache entries.
- A forged tenant ID in a request does not switch tenant context.
- A tenant hostname cannot resolve to another tenant's data.

### RBAC

- A user without permission is denied by the backend.
- A sub-admin cannot grant permissions above their authority.
- Tenant users cannot grant Super Admin privileges.
- Customer and sub-customer relationships are enforced.

### Provisioning

- Valid registration provisions database, database user, schema,
  initial admin, and subdomain mapping.
- Duplicate slugs are rejected.
- Concurrent requests cannot provision the same slug twice.
- Failed steps leave the tenant inactive.
- Retry recovers safely without duplicating resources.
- Secrets do not appear in logs or browser responses.

### Deployment

- Docker-based local setup can start from documented steps.
- Production setup supports the chosen wildcard domain/TLS
  arrangement.
- Database backup and restore are tested.
- Health checks and migration procedures are documented.

## 15. Implementation Sequence

1.  Confirm production host, DNS provider, base domain, and database
    hosting.
2.  Create the Next.js/TypeScript project and Docker-based local
    environment.
3.  Configure PostgreSQL and Redis locally.
4.  Implement the control-plane database and tenant lifecycle statuses.
5.  Implement authentication and the global Super Admin boundary.
6.  Implement tenant registration and safe database/user provisioning in
    Node.js.
7.  Implement tenant subdomain resolution and local testing.
8.  Implement per-tenant database connection selection.
9.  Implement centralized RBAC.
10. Implement sub-admin, customer, and sub-customer management.
11. Implement tenant-scoped file storage foundations.
12. Add observability, audit logs, retries, backup/restore, and
    isolation tests.
13. Deploy to the selected production host without Kubernetes or Docker
    Swarm.
14. Add detailed music release workflows after the core is stable.

## 16. Unresolved Technical Decisions

Do not invent these choices silently: - Exact Next.js, Node.js,
PostgreSQL, Redis, and Auth.js versions. - Production hosting
provider. - PostgreSQL hosting and provisioning permissions. - DNS
provider and wildcard DNS/TLS support. - File storage provider and
tenant isolation mechanism. - Queue library and worker runtime. - Email
delivery and verification method. - Exact authentication providers and
account recovery flow. - Expected tenant count and database connection
strategy. - Backup retention, restore objectives, and tenant deletion
policy. - Exact database naming and secret-management scheme.

## 17. Definition of Done for the Core

The core is complete when a tenant can register, receive a unique SaaS
subdomain, have a separate PostgreSQL database and database user
provisioned, sign in securely, create authorized sub-admins, and manage
customers/sub-customers without any cross-tenant data access. This must
work in the documented Docker local environment and in the selected
production hosting setup without requiring Kubernetes or Docker Swarm.
