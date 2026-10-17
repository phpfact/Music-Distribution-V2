# Technical Requirements Document (TRD)

## Multi-Tenant Music Distribution SaaS

| Field       | Value                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| Status      | Technical baseline, including MinIO AIStor object storage and database backups                           |
| Version     | 1.1 (2026-10-17). Supersedes 1.0.                                                                         |
| Purpose     | Practical implementation approach for the approved MVP, without Kubernetes or Docker Swarm               |
| Product doc | [PRD.md](PRD.md). Its Strict Rules (PRD §5) apply to every section below.                                 |

**Must** = mandatory. **Should** = expected unless a documented reason exists. Names marked _proposed_ follow existing project conventions and are confirmed at implementation. Open items are in §19 and must not be decided silently.

---

## 1. Technology Stack

| Area                     | Technology                                 | Requirement                                                                                          |
| ------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Web application          | Next.js (App Router)                       | Supported App Router setup.                                                                          |
| Language                 | TypeScript                                 | All application code.                                                                                |
| Database                 | PostgreSQL                                 | Separate database and separate database user for every tenant.                                      |
| ORM / migrations         | Prisma                                     | Table migrations and ORM.                                                                            |
| Cache / coordination     | Redis                                      | Caching, rate limiting, queue coordination, temporary state (§10).                                   |
| Authentication           | Auth.js (formerly NextAuth.js)             | Compatible, maintained setup; confirm exact provider and version before implementation (TC-3).      |
| Runtime / backend logic  | Node.js                                    | Provisioning and server-side business logic in Node.js/TypeScript.                                   |
| Object storage           | MinIO AIStor (S3-compatible)               | Tenant assets and database backups (§9, §11). Commercial license required (PRD D-12).               |
| Storage admin client     | AIStor `mc`                                | Makefile and admin operations only (§14); never reachable from the browser.                          |
| Environments             | Docker / Docker Compose                    | Reproducible local and deployment environments.                                                      |
| Production orchestration | Standard Docker-based or managed hosting   | No Kubernetes or Docker Swarm. Hosting provider is open (§19).                                       |

"OAuth.js" in early requirements most likely meant Auth.js. OAuth is an authorization protocol, not a complete authentication solution; confirm the exact package and provider configuration.

### 1.1 Verified MinIO AIStor facts (checked 2026-10-17)

| Item                     | Verified value                                                                                                                                                       | Source                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Server image             | `quay.io/minio/aistor/minio`                                                                                                                                         | AIStor container docs     |
| Latest stable release    | `RELEASE.2026-09-19T17-05-25Z` (tagged `latest` on 2026-09-20), digest `sha256:107cf2014a9583c74c11e3cdbd6903d89c2244355886b89ce532f4ecae9c23f3`                     | quay.io tag API           |
| Client                   | `mc` RELEASE.2026-09-19T15-24-59Z is bundled in the server image (with `curl`, `bash`; no `grep`/`sed`/`awk`), so no separate client image is needed. Standalone image: `quay.io/minio/aistor/mc`, digest `sha256:23511e340cbabf07e6a8b53f9c434975708f22f3c047d6beeddc17bf1a5aed88`. | image inspection, quay.io |
| Release channels         | `RELEASE.*` = stable. `EDGE.*`, `edge`, `edge-daily` = pre-release, not for production. `*.hotfix.*` = hotfix builds. `.fips` / `.rdma` = variants.                | quay.io tags              |
| License                  | Required to run; passed as a file (`--license <path>`). Free tier: one node (one or more drives), no support, redistribution prohibited. Active license required for production. | AIStor docs, pricing page |
| Ports                    | 9000 S3 API, 9001 Console                                                                                                                                            | AIStor container docs     |
| Health probes            | `/minio/health/live`, `/minio/health/ready`, `/minio/health/cluster` (unauthenticated)                                                                               | AIStor healthcheck docs   |
| Root credentials         | `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`. The `minioadmin` default must never be used.                                                                               | AIStor root settings docs |
| Community MinIO (AGPLv3) | No longer maintained; not to be used                                                                                                                                 | MinIO pricing FAQ         |

- Pin the image by tag **and** digest, as `docker/compose.yaml` already does for every image. Never use `latest` or `EDGE` tags.
- At implementation time, re-check the newest stable release, its digest (`docker buildx imagetools inspect`) and its release notes (behaviour changes) before pinning or upgrading.
- Feature availability (versioning, replication, encryption, metrics) depends on the version, license tier and topology. Verify each one before relying on it.

## 2. Application Modules

A monorepo is reasonable but not mandatory. Keep clear module boundaries; never duplicate authorization, tenant-resolution or bucket-resolution logic across pages.

| Module          | Responsibility                                                                         |
| --------------- | -------------------------------------------------------------------------------------- |
| `web`           | Next.js UI, server routes and server actions                                           |
| `auth`          | Authentication configuration and sessions                                              |
| `tenants`       | Registration, lookup, status, lifecycle                                                |
| `provisioning`  | Create and validate tenant databases, database users, buckets and storage identities   |
| `domains`       | Subdomain normalization and tenant resolution                                          |
| `authorization` | Roles, permissions, policy checks                                                      |
| `customers`     | Customer and sub-customer management                                                   |
| `storage`       | AIStor client, tenant-scoped object access, pre-signed URLs                            |
| `backups`       | Database backup, verification, restore                                                 |
| `audit`         | Security-sensitive and administrative event records                                    |
| `shared`        | Common types, schemas, validation, utilities                                           |

## 3. Tenant Isolation Architecture

### 3.1 Control plane and tenant data plane

The **control-plane database** holds platform-wide records only: tenant ID, name, slug, status, subdomain, database name, database user or credential reference, bucket name and storage status, storage credential reference, provisioning state and timestamps, plan, backup records, audit and operational metadata.

- Never store tenant passwords or secrets as plain text. Keep secrets in environment-backed or dedicated secret storage and store only a safe reference.
- Never mix tenant business records into the control plane.

Each **tenant database** holds that tenant's data: users and tenant roles, customers and sub-customers, artists, labels, audio/video releases and metadata, asset metadata (object keys), settings and operational records.

### 3.2 Database users and privileges

For each tenant:

- Create a dedicated database and a dedicated database login.
- Grant that login access only to its own database, with least-privilege permissions.
- Never use the PostgreSQL superuser for normal application queries.
- Keep administrative provisioning credentials separate from runtime tenant credentials.
- Never expose database connection strings to the browser.

A separate database and user are a strong boundary, but the application must still resolve the tenant correctly and protect files, buckets, caches, jobs and logs.

### 3.3 Tenant context (every request)

1. Normalize and validate the host.
2. Resolve the host/subdomain to a tenant record in the control plane.
3. Verify the tenant is active and provisioning is complete.
4. Establish a trusted tenant context on the server.
5. Select the tenant's database connection and its bucket and storage credential.
6. Authenticate and authorize.
7. Execute the operation only against that tenant's database and bucket.
8. Never take tenant context from an untrusted request body or query parameter.

A client-provided `tenantId`, bucket name or object key is never the authority for selecting a database or bucket. The validated host and authenticated server-side context are the source of truth, with cross-checks added for custom domains later.

## 4. Tenant Registration and Provisioning

### 4.1 Entry points

- The Platform Owner panel and the public signup both call the **same** server-side provisioning service, with the same validation, idempotency and audit.
- Public signup can never choose or assign a bucket. Manual bucket assignment is available only in the Platform Owner panel, behind a dedicated privilege (catalogue key chosen at implementation).

### 4.2 Provisioning steps

1. Validate registration input on the server.
2. Normalize the requested slug; reject reserved or invalid names.
3. Check slug uniqueness in the control plane.
4. Create the tenant record with status `provisioning`.
5. Allocate a unique database name, database username, bucket name and storage identity name using safe, deterministic, server-generated naming rules.
6. Using a restricted provisioning connection, create the tenant database and database user (existing-database mode: validate them instead).
7. Grant only the required database privileges.
8. Create the tenant bucket with its ownership tag, or validate the manually assigned bucket (§9.7).
9. Create the tenant storage identity, store its secret encrypted, and attach a policy limited to the tenant bucket (§9.2, §9.3).
10. Verify storage isolation: the tenant identity can write, read and delete a probe object in its bucket; it is denied on the Platform Owner bucket and backup storage; anonymous access is off; the applied policy, read back, matches the template.
11. Apply the current schema/migrations to the tenant database.
12. Create the initial tenant administrator in the tenant database, or run a bootstrap step that completes before activation.
13. Register the tenant subdomain mapping in the control plane.
14. Verify the database connection, required schema, storage access and domain mapping.
15. Mark the tenant `active` only after every mandatory step passes.
16. Notify the user that the tenant platform is ready.

The code already implements the database and domain steps (`src/lib/provisioning/steps.ts`). The storage steps are new entries in the `ProvisioningStep` enum (_proposed_: `create_bucket` / `check_bucket` for manual assignment, `create_storage_identity`, `apply_bucket_policy`), placed after `grant_privileges` and before `apply_migrations` to match PRD §4.2. `verify` gains the storage checks.

### 4.3 Status model

- **Tenant:** `pending`, `provisioning`, `active`, `failed`, `suspended`, `deprovisioning`.
- **Tenant bucket** (_proposed_): `pending`, `provisioning`, `ready`, `failed`, `retired`.
- Store a display-safe error code and message, plus detailed internal logs for diagnostics. Logs never contain passwords, access keys, connection strings, signed URLs or other secrets.

### 4.4 Safe retries, partial failures and concurrency

- Every step is idempotent or explicitly detects existing resources. A retry never creates duplicate tenant records, database users, databases, buckets, storage identities or assignments.
- **Ownership markers:** database objects carry `md-tenant:<tenantId>` (existing); buckets carry an ownership tag (_proposed_: `md-owner=tenant:<tenantId>`). A resource with the expected name but without our marker is a conflict: never adopted, never changed.
- If the database is created but migrations or storage fail, keep the tenant inactive and record the failed step.
- Retry only failed or safely repeatable steps; completed steps are skipped.
- Use a lock or equivalent coordination so two requests cannot provision the same slug, tenant or bucket at once. Back it with database UNIQUE constraints on slug, database name, database user, bucket name and storage access key, and on one non-retired bucket per tenant.
- Rate-limit registration and add abuse protection, especially for public signup.
- Never mark a tenant active while its database, schema, initial admin, bucket, storage permissions or domain mapping is incomplete.
- Tenants that were active before storage existed get a storage-only provisioning run (backfill) with tracked status. Whether they stay active meanwhile is PRD D-15.

## 5. Subdomain and DNS

### 5.1 Local development

- Use a predictable local domain strategy (current default: `PLATFORM_BASE_DOMAIN=localhost`, so `*.localhost` needs no DNS).
- Route tenant hostnames to the Next.js app through host routing or an optional local reverse proxy.
- Docker Compose runs the app and its services. Tenant databases live in the PostgreSQL service or a configured server and stay logically separate even on a shared server.

### 5.2 Production

- A wildcard DNS record (e.g. `*.example.com`) points to the application entry point, so no per-tenant DNS record is needed if the provider supports wildcards.
- Configure TLS for the base domain and wildcard tenant subdomains with a compatible certificate and hosting setup.
- Resolve the incoming hostname in the application and map it to the tenant in the control plane; validate tenant status before serving tenant content.
- Reserve system subdomains such as `www`, `api`, `admin` and other operational names. If a public storage hostname is used for pre-signed URLs (§9.5), its label must be reserved too.
- Wildcard DNS and TLS depend on the chosen providers: verify before deployment. Application code alone cannot configure DNS or TLS.

## 6. Docker and Deployment

### 6.1 Local environment

- Docker Compose runs the Next.js app, PostgreSQL, Redis, MinIO AIStor, optional GUIs and an optional reverse proxy for subdomain testing.
- Named volumes hold all persistent data.
- Secrets live in the uncommitted env file in the project root (`.env`, selectable with `ENV_FILE`). `.env.example` contains placeholders only; `make init` generates every `change-me…` secret.

### 6.2 Production environment

- Kubernetes and Docker Swarm are not required.
- The hosting provider must support the Node.js/Next.js runtime, persistent or managed PostgreSQL, Redis if needed, persistent disk for AIStor, wildcard domain/TLS, environment secrets, logs and backups.
- Deploy as a standard container or through a provider-managed Node.js workflow.
- Production must include: HTTPS; secure environment/secret configuration; managed or properly maintained PostgreSQL; a licensed AIStor deployment with persistent storage; database backup and restore procedures; a migration procedure; health checks and structured logs; resource and connection limits; a documented deployment and rollback process.
- Local Docker Compose is not itself the production hosting solution. Docker gives consistent packaging; the production host still runs and manages the services.

### 6.3 MinIO AIStor service

| Area                 | Requirement                                                                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service              | `aistor` (_proposed_) in `docker/compose.yaml`, with dev/prod differences in `compose.dev.yaml` / `compose.prod.yaml`, the same pattern as `postgres` and `redis`. Project name `mdnext` unchanged. |
| Image                | `quay.io/minio/aistor/minio:<RELEASE tag>@sha256:<digest>` (§1.1).                                                                                                                                  |
| Command              | `minio server <data path> --license <license path>`, plus the Console address flag. Confirm the exact flags against the pinned version.                                                            |
| License              | Compose secret read from the host path in `AISTOR_LICENSE_FILE`. The file is git-ignored, mode 600, never baked into an image, never committed, never printed.                                      |
| Root credentials     | `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` from the env file, required with the `${VAR:?…}` guard. Given only to `aistor` and the admin `mc` jobs, never to `app`.                                   |
| Persistence          | Named volume `aistor_data` (_proposed_) on the data path. It survives `down`, `restart` and container recreation and is deleted only by `make destroy-data`.                                         |
| Networking           | Internal network only (`aistor:9000`). Development: API and Console published on `127.0.0.1` only. Production: no published API port by default; Console only on `127.0.0.1`, like pgAdmin and Redis Insight. A public S3 endpoint, if chosen (§9.5), goes through the HTTPS reverse proxy. |
| Health check         | Probe `/minio/health/live` and `/minio/health/ready` with a command verified to exist in the pinned image (for example a bundled `mc ready` or `curl`); do not assume one. Same interval/timeout/retries/start-period style as the other services. |
| Startup dependencies | `app` and the one-off `mc` jobs use `depends_on: aistor: condition: service_healthy`.                                                                                                              |
| Restart              | `restart: unless-stopped`, with a `stop_grace_period` long enough for a clean shutdown.                                                                                                              |
| Hardening (prod)     | `no-new-privileges`, `cap_drop: ALL`, read-only root filesystem with `tmpfs /tmp`; CPU/memory limits through optional `AISTOR_CPU_LIMIT` / `AISTOR_MEMORY_LIMIT` (defaults 1.0 / 1g). Verified: the image runs as root, and works with these settings; running as non-root needs volume-ownership handling and is not done. On Linux the license file must be readable by root without capabilities (root-owned or mode 644). |
| Logging              | The shared `x-logging` json-file rotation (10 MB × 5).                                                                                                                                              |
| Admin client         | One-off `aistor-admin` service (profile `aistor-admin`, like `migrate`) using the server image and its bundled `mc`, on the internal network. It alone receives the platform and backup identities' secrets. |
| Readiness            | `/api/health/ready` reports AIStor reachability; `make health` lists `aistor` as a required service.                                                                                                |

### 6.4 Environment variables

Following `.env.example` conventions. Implemented in phase 1: `AISTOR_LICENSE_FILE`, `MINIO_ROOT_*`, `AISTOR_PLATFORM_*`, `AISTOR_BACKUP_*`, `AISTOR_HOST_PORT`, `AISTOR_CONSOLE_PORT`, `AISTOR_*_LIMIT`; the rest stay _proposed_ for phase 2. None may carry a `NEXT_PUBLIC_` prefix. `src/lib/env.ts` validates the app's variables (problems name the variable, never the value; placeholders and short secrets are rejected in production).

| Variable                                                       | Given to                    | Purpose                                                              | Secret |
| -------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------- | ------ |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`                       | `aistor`, admin `mc` jobs   | Root identity: bootstrap and break-glass only                        | Yes    |
| `AISTOR_LICENSE_FILE`                                          | Compose (secret source)     | Host path of the license file                                        | License |
| `AISTOR_PROVISIONER_ACCESS_KEY`, `AISTOR_PROVISIONER_SECRET_KEY` | `app` (phase 2)           | Provisioning identity (§9.2)                                         | Yes    |
| `AISTOR_PLATFORM_ACCESS_KEY`, `AISTOR_PLATFORM_SECRET_KEY`     | `aistor-admin`; `app` (phase 2) | Platform Owner bucket access                                     | Yes    |
| `AISTOR_BACKUP_ACCESS_KEY`, `AISTOR_BACKUP_SECRET_KEY`         | `aistor-admin`; backup jobs | Backup storage access                                                | Yes    |
| `AISTOR_HOST`, `AISTOR_PORT`                                   | `app` (set in Compose; phase 2) | Internal endpoint `aistor:9000`, like `POSTGRES_HOST`            | No     |
| `AISTOR_HOST_PORT` (dev), `AISTOR_CONSOLE_PORT`                | Compose                     | Host ports on `127.0.0.1`; checked by `make ports`                   | No     |
| `AISTOR_CPU_LIMIT`, `AISTOR_MEMORY_LIMIT`                      | Compose (prod, optional)    | Resource limits                                                      | No     |

Tenant storage secrets are not environment variables: they are stored encrypted in the control-plane `secrets` table under `TENANT_SECRETS_KEY` (§9.2).

## 7. PostgreSQL Connection Management

A database per tenant can create many connections if each request opens a new connection or pool.

- Reuse connections where the runtime permits; never create a pool per request.
- Define connection timeouts and pool limits (current: `POSTGRES_POOL_MAX`, `POSTGRES_TENANT_POOL_MAX`, `POSTGRES_TENANT_CLIENTS_MAX`).
- Calculate the total possible connections across active tenants.
- Consider a compatible connection pooler or managed database features as the tenant count grows.
- Database selection is server-side and cannot be manipulated by a user.
- Do not keep a permanently open pool for every tenant without measuring the connection impact.

The exact strategy depends on the production runtime, hosting model and expected tenant count.

## 8. Authentication and Authorization

### 8.1 Authentication

- Configure the selected sign-in provider(s) (Auth.js per §1, see TC-3). Keep secrets server-side.
- Use secure cookies and production HTTPS.
- Define session expiry and account recovery requirements.
- Define how a user signing in on a tenant subdomain is associated with that tenant.
- OAuth alone does not implement tenant authorization or RBAC.

### 8.2 Authorization / RBAC

- One centralized authorization service, e.g. `can(user, permission, resource, tenantContext)`, used by server routes, server actions, service methods and storage operations. UI visibility is for usability only, never the security boundary.
- Deny by default.
- Tenant users can never assign Platform Owner (global) permissions.
- Prevent privilege escalation.
- Check customer/sub-customer ownership and hierarchy where applicable, including for objects.
- Platform Owner cross-tenant operations (including storage) require an explicit privilege and are audited.
- Audit sensitive role and permission changes.
- Test both allowed and denied access.

## 9. Object Storage (MinIO AIStor)

A separate database does not isolate files; storage isolation is implemented separately, as below.

### 9.1 Bucket model and naming

- One bucket per tenant, one Platform Owner bucket, and separate backup storage (_proposed_: one dedicated backup bucket, §11.2).
- Bucket names are server-generated, deterministic and valid S3 names (3–63 characters; lower-case letters, digits, hyphens; not IP-like; no reserved prefixes/suffixes). Never derived from client input. Stored in the control plane with a UNIQUE constraint. Immutable: a slug change never renames a bucket.
- _Proposed_ names: `md-t-<tenant UUID without hyphens>`, `md-platform`, `md-backups`.
- Every bucket carries an ownership tag (_proposed_: `md-owner=tenant:<id>` / `platform` / `backups`).
- A bucket is never reassigned or reused. Retired bucket records are kept, and bucket names are unique across active and retired records.

### 9.2 Identities and credentials (least privilege)

| Identity                   | Access                                                                                                  | Used by                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Root                       | Everything                                                                                              | `make aistor-install` bootstrap and break-glass only; never the application                     |
| Provisioner                | Create buckets and tags; create, enable/disable and attach policies to tenant identities               | The server-side provisioning service only; never for object reads/writes                        |
| Platform                   | Platform Owner bucket objects                                                                           | Platform Owner features                                                                         |
| Tenant (one per tenant)    | Read, write, delete, list and multipart on its own bucket only; no bucket admin, policy or bucket deletion | That tenant's server-side operations, including authorized Platform Owner operations on that tenant |
| Backup                     | Backup storage only: write, read, list; deletion only through the retention procedure                  | Backup jobs                                                                                     |

- An identity that can create policies or users can grant itself access: protect the provisioner like root.
- No runtime identity can reach every tenant bucket. A Platform Owner operation on a tenant's files uses that tenant's identity, after authorization and audit.
- Tenant secrets are generated server-side, encrypted in the `secrets` table (AES-256-GCM, purpose-bound, key from `TENANT_SECRETS_KEY`), decrypted only server-side when needed, and never placed in browser responses, logs, audit rows or error messages.
- **Rotation:** tenant identities through `make aistor-rotate-key`; root and platform identities through a documented procedure verified against the pinned AIStor version. Revoking a signing key invalidates the pre-signed URLs it signed. Every rotation is audited.
- **Suspension:** the application denies storage access at once through the tenant gate. The tenant identity should also be disabled (and re-enabled on reactivation) as defence in depth; the final rule follows PRD D-16.

### 9.3 Bucket policies

- No bucket allows anonymous or public access (verified by `make aistor-policy-check`).
- Tenant policies come from one template scoped to `arn:aws:s3:::<bucket>` and `arn:aws:s3:::<bucket>/*`, and are read back and compared after applying.
- The Platform Owner bucket and backup storage never appear in a tenant policy.

### 9.4 Application access path

- Every object operation goes through the server-side `storage` module. The bucket always comes from the trusted tenant context (control plane), never from the request or an asset row alone.
- Object keys are server-generated from allowlisted patterns (e.g. `customers/<customerId>/releases/<releaseId>/<uuid>.<ext>`) and validated before use: no `..`, `\`, NUL or absolute paths. A client filename is metadata only, never a key.
- Before every customer or sub-customer object operation, RBAC and ownership are checked against tenant-database records. Key prefixes organize objects; they are not the security boundary.
- Exports, downloads and background jobs apply the same tenant and ownership filters.
- Private media stays private: serve it only through authorized download endpoints or short-lived pre-signed URLs (§9.5).

### 9.5 Pre-signed URLs

- Generated server-side only, after authorization; one object and one method per URL; shortest practical expiry (value: PRD D-16).
- Download URLs set a safe `Content-Type` and `Content-Disposition`.
- Never logged or stored. Tampered or expired URLs fail by signature.
- A URL stays valid until it expires unless its signing key is revoked (PRD C-4).
- Browsers must reach the S3 endpoint: either a public storage hostname with TLS through the reverse proxy, or transfers proxied through the application (PRD D-16). Restrict CORS to platform and tenant origins (verify AIStor CORS support).

### 9.6 Uploads and large media

- Validate type by content sniffing (as `src/lib/storage/image.ts` does for images), size and authorization; reject a MIME type that does not match the content.
- Never buffer whole large files in application memory (app container limit defaults to 512 MB; server-action bodies are capped at 3 MB). Use multipart uploads and streaming: direct-to-storage multipart through pre-signed part URLs, or streaming route handlers.
- Unvalidated uploads land under a staging prefix and become assets only after server-side validation. Stale staging objects and incomplete multipart uploads are cleaned up (§14).
- Asset types, upload limits and quotas: PRD D-11. Bucket quotas are enforced through AIStor only after verifying support.

### 9.7 Manual bucket assignment

Server-side checks, all required: the caller holds the assignment privilege; the bucket exists and has a valid name; it is not the Platform Owner or backup bucket; it is not mapped (active or retired) to any tenant; it carries no other owner's tag. Then the tenant policy is applied and verified, the ownership tag is set, and the action is audited. A non-empty bucket without an ownership tag: PRD D-18.

### 9.8 Bucket lifecycle and optional features

- Suspension: §9.2. Offboarding and deletion follow PRD D-10; the bucket is retired and never reassigned.
- Backup, retention and deletion behavior for stored objects is defined before production (PRD D-10, D-14).
- Versioning, object lock, lifecycle (ILM), server-side encryption (KMS) and replication become mandatory only after (a) support is verified for the pinned version, license tier and single-node topology, and (b) the requirement is approved. They are not assumed configured.

### 9.9 Migration from local filesystem storage

- Today, uploaded files (tenant profile images, keys `tenants/<id>/profile/<uuid>.<ext>`) are stored on the local filesystem under `STORAGE_ROOT`: `storage/` in development, the `app_storage` volume in production.
- Migration copies every file to its decided bucket (PRD D-17), verifies the checksum, switches reads, and retires local copies only after verification. No data loss; reversible until confirmed.

## 10. Redis and Background Jobs

Use Redis only with a clear purpose: rate limiting; cache for non-sensitive or tenant-scoped data; queue coordination for longer operations; short-lived provisioning locks with correct expiry and failure handling.

- Tenant-specific cache keys include a stable tenant identifier; cache entries are never reused across tenants.
- Never cache tenant permissions indefinitely; invalidate or expire them.
- A cached tenant-to-bucket mapping is invalidated on assignment change, suspension and key rotation; the control plane stays authoritative.
- Never cache storage secrets or pre-signed URLs.
- Redis is never the only durable record of provisioning or backup status. If a queue runs provisioning or backups, persist job status in the control plane and make jobs retry-safe.

The queue library and worker deployment model remain to be selected (§19).

## 11. Database Backups and Recovery

### 11.1 Scope

- The control-plane database (`POSTGRES_DB`) and every tenant database.
- Existing-database-mode tenants are included where the backup login has the privilege; otherwise they are reported as "not covered" (§19).
- Redis is excluded (not a durable source of truth). Object (asset) backup: PRD D-14.
- The existing `make backup` / `make restore` (control plane, local `backups/` folder) keep their current behavior.

### 11.2 Storage and access

- Backup storage is separate from asset buckets (_proposed_ key layout: `postgres/control/<UTC time>.dump`, `postgres/tenants/<tenantId>/<UTC time>.dump`).
- Only the backup identity and authorized Platform Owner backup operations can reach it. No tenant identity can; backups are never pre-signed to tenant users or served through tenant panels.

### 11.3 Backup procedure

1. `pg_dump --format=custom` per database into a private temporary file (`umask 077`).
2. Check the archive with `pg_restore --list` and compute its SHA-256.
3. Upload, then verify the stored object's size and checksum.
4. Record the result and delete the temporary file.

- Each record holds: database kind, tenant ID, object key, size, checksum, schema version, start/end time, status (`running`, `succeeded`, `failed`, `verified`) and a safe error message.
- One database's failure does not stop the others; the run is marked partial or failed, exits non-zero, is visible to the Platform Owner, and can be retried safely.
- Retention is configurable (values: PRD D-13). Pruning never deletes the newest verified backup of any database.

### 11.4 Restore

- **Restore test:** restore into a disposable scratch database, confirm the newest `_prisma_migrations` entry matches the recorded schema version, then drop the scratch database. Never touches live databases.
- **Controlled restore:** typed confirmation; restore into a staging database, then swap names (the pattern of `docker/scripts/pg-restore.sh`); the previous database is kept. A tenant restore re-applies the tenant grants (dumps are restored with `--no-owner --no-privileges`) and re-runs `verify`. The backup's tenant ID must equal the target tenant's. Audited.
- After a control-plane restore, run the mapping check: buckets and identities created after the backup point are reported, never deleted automatically.

### 11.5 Disaster recovery and keys

- AIStor on the same host or disk as PostgreSQL is not disaster recovery. An off-host copy is required before production (method: PRD D-13).
- Back up `TENANT_SECRETS_KEY`, the AIStor root credentials and the license out-of-band, never inside the backup bucket. Without `TENANT_SECRETS_KEY`, the tenant database and storage secrets in a restored backup are unrecoverable.
- Encryption of backup objects at rest is required only once verified and approved (§9.8).

## 12. Database Schema and Migrations

Prisma handles table migrations and the ORM, with two migration sets:

1. A control-plane schema for global tenant metadata (including bucket, storage-credential and backup records).
2. A tenant schema/migration set applied independently to each tenant database.

- Version tenant migrations and apply them to new tenant databases before activation.
- Define how existing tenants receive later schema changes, and track migration status per tenant.
- A failed migration never marks a tenant healthy.
- Test migrations on a disposable tenant database before broad rollout.
- Never run tenant migrations with a low-privilege runtime login when elevated permissions are required.

## 13. Suggested Core Entities

These are logical entities, not a finalized schema. Confirm relationships, required fields, deletion behavior and the release workflow before building the detailed schema.

- **Control plane:** `tenants`, `tenant_domains`, `tenant_provisioning_runs` and steps (or equivalent), `plans` (even with one free plan), `audit_events`, `secrets`, `tenant_buckets` (_proposed_: tenant ID, unique bucket name, mode provisioned/assigned, status, unique access key, secret reference, policy name, verified/retired timestamps, safe error), `backup_runs` / `backup_artifacts` (_proposed_).
- **Per-tenant database:** `users`, `roles`, `permissions`, `role_permissions`, a user-to-role assignment allowing exactly one role per user (PRD C-1), `customers`, a customer relationship or parent reference, `artists`, `labels`, `audio_releases`, `video_releases`, `release_assets` (object key and metadata, never a URL or a client-chosen bucket).

## 14. Makefile: MinIO AIStor Targets

**Status (2026-10-17):** phase 1 is implemented: `aistor-install`, `aistor-config-check`, `aistor-health`, `aistor-mc`, `aistor-buckets`, `aistor-bucket-inspect`, `aistor-smoke`, `aistor-usage`, `aistor-validate`, and the `destroy-data` warning. In phase 1, `aistor-validate` also checks the platform and backup identities' isolation. The other targets below come with phase 2 (tenant buckets, backups).

**Conventions (from the existing Makefile):**

- A `##@ Object storage (AIStor)` help group. Scripts in `docker/scripts/aistor-*.sh` source `lib.sh` and use `$(COMPOSE)`, `ENV_FILE` and `MODE=dev|prod`. Use `MODE=prod` for production; no duplicate `prod-aistor-*` targets.
- `sudo` is never added inside the Makefile. If Docker needs root, prefix the command, e.g. `sudo make aistor-install`. Files created through sudo are handed back with `restore_owner`.
- Existing generic targets cover the service lifecycle, with `aistor` added to their service lists (no aliases): `make up`, `make stop s=aistor`, `make restart s=aistor`, `make ps`, `make logs s=aistor`, `make health`, `make validate`, `make ports`, `make urls` (adds the Console URL).
- Secrets travel through environment variables inside containers or stdin: never as command-line arguments, never echoed, no `set -x`. Output masks keys.
- Every failure exits non-zero, names the failing step and suggests the next command.
- Destructive targets run a dry run by default and require `CONFIRM=<exact phrase>` or an interactive typed phrase. Non-interactive runs without it abort with nothing changed (the pattern of `destroy-data.sh` and `pg-restore.sh`).
- Targets that change tenant state call the application's server-side services (same validation, idempotency and audit as the panel, actor `system`), never raw `mc` commands that bypass the control plane.

| Target                                              | Purpose and expected behavior                                                                                                                                                                                             | Prerequisites                                                  | Failure handling                                                               | Destructive                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `aistor-install`                                    | Idempotent first-time setup: run `aistor-config-check`; start `aistor`; wait until healthy; create or verify the provisioner, platform and backup identities and policies; create or verify the Platform Owner and backup buckets with ownership tags; confirm anonymous access is off; run `aistor-validate`. | `.env` with AIStor values (`make init`), license file, Docker | Stops at the first failing step and names it; safe to re-run; never recreates or overwrites existing buckets or data | No                                                      |
| `aistor-config-check`                               | Validate without starting anything: required variables set; no placeholders or `minioadmin` in production; license file readable (never printed); image pinned by tag and digest; `compose config` valid; ports free. | `.env`                                                         | Lists every problem by variable name                                           | No                                                      |
| `aistor-health`                                     | Liveness, readiness and cluster probes; license status and expiry; drive state and free space.                                                                                                                            | Running stack                                                  | Non-zero exit; names the failing check and `make logs s=aistor`                | No                                                      |
| `aistor-mc`                                         | Authenticated `mc` shell in the one-off client container, for troubleshooting.                                                                                                                                            | Running stack                                                  | n/a                                                                            | Admin shell: can change data, use with care             |
| `aistor-buckets`                                    | List buckets with role (tenant, platform, backup, unmapped), mapped tenant, status and size.                                                                                                                              | Running stack                                                  | Non-zero if AIStor or the control plane is unreachable                         | No                                                      |
| `aistor-bucket-inspect bucket=<name>`               | Show ownership tag, policy summary, anonymous access, versioning state, object count and size, mapped tenant.                                                                                                              | Running stack                                                  | Unknown bucket: non-zero                                                       | No                                                      |
| `aistor-bucket-create tenant=<slug>`                | Run (or resume) the tenant's storage provisioning steps through the app's provisioning service.                                                                                                                           | Tenant exists                                                  | Failed step recorded; idempotent retry                                         | No                                                      |
| `aistor-bucket-assign tenant=<slug> bucket=<name>`  | Manual assignment through the same server-side validation as the panel (§9.7); audited.                                                                                                                                    | Typed confirmation                                             | Rejection states the reason; nothing changed                                   | Changes the mapping; deletes nothing                    |
| `aistor-policy-check`                               | Every tenant identity's policy equals the template for its own bucket only; Platform Owner and backup buckets absent; no anonymous access anywhere.                                                                       | Running stack                                                  | Lists each deviation; no automatic fix                                         | No                                                      |
| `aistor-mapping-check`                              | Reconcile control plane and AIStor: one bucket per tenant that needs one; tags match; no bucket mapped twice; orphan or unmapped buckets and identities reported.                                                          | Running stack                                                  | Report only; no automatic fix                                                  | No                                                      |
| `aistor-smoke [tenant=<slug>]`                      | Upload, download, compare checksums and delete a probe object under `smoke/`, in the Platform Owner bucket or (with `tenant=`) the tenant's bucket using the tenant identity.                                              | Running stack                                                  | Removes only its own probe objects                                             | No                                                      |
| `aistor-isolation-test`                             | Automated suite with disposable, test-tagged tenants, buckets and identities: A↔B denied; Platform Owner allowed through the authorized path; anonymous denied; forged IDs/keys and tampered or expired pre-signed URLs denied. | `MODE=dev` only (production uses the read-only policy and mapping checks) | Non-zero on any failed assertion; cleanup of its own resources always runs | No                                                      |
| `aistor-backup [scope=all\|control\|tenant=<slug>]` | Back up databases to backup storage (§11.3) and record the status.                                                                                                                                                        | Running stack                                                  | Per-database failures isolated; non-zero if any failed                         | No                                                      |
| `aistor-backup-list [tenant=<slug>]`                | List backups: key, database, size, checksum, status, verification and restore-test times.                                                                                                                                 | Running stack                                                  | n/a                                                                            | No                                                      |
| `aistor-backup-verify key=<key>\|latest`            | Download to a private temporary file; verify checksum and `pg_restore --list`; record the result.                                                                                                                          | Running stack                                                  | Mismatch: non-zero, backup marked as failed verification                       | No                                                      |
| `aistor-restore-test key=<key>\|latest`             | Restore into a disposable scratch database, run the checks, drop the scratch database (§11.4).                                                                                                                            | Running stack                                                  | Scratch database always dropped                                                | No                                                      |
| `aistor-restore key=<key> target=control\|tenant:<slug>` | Controlled restore (§11.4).                                                                                                                                                                                           | Verified backup; typed confirmation of the database name       | Live database untouched if the staging restore fails; previous database kept   | **Yes**: replaces live data (previous copy kept)        |
| `aistor-usage`                                      | Per-bucket size and object count; drive capacity; Docker volume and host free space; container CPU/memory and restart count.                                                                                               | Running stack                                                  | n/a                                                                            | No                                                      |
| `aistor-perf`                                       | Run the performance test offered by the pinned `mc` (verify the command) and save results with date and version.                                                                                                          | Typed confirmation in production (generates load)              | n/a                                                                            | No (load only)                                          |
| `aistor-rotate-key tenant=<slug>`                   | Create a new key, store it encrypted, verify, then revoke the old key; audited.                                                                                                                                            | Typed confirmation                                             | Old key kept until the new one is verified                                     | Revokes the old key and its pre-signed URLs             |
| `aistor-cleanup`                                    | Abort stale multipart uploads; delete expired `staging/` and `smoke/` objects; prune backups beyond retention (never the newest verified one per database). Dry run by default.                                             | `APPLY=1` plus typed confirmation to delete                    | Reports per item                                                               | **Yes**, when applied                                   |
| `aistor-validate`                                   | Full validation: config check, health, policy check, mapping check, smoke test (plus the isolation suite in development).                                                                                                 | Running stack                                                  | Summary of failing parts; non-zero                                             | No                                                      |
| `destroy-data` (existing)                           | Also deletes `aistor_data`. Its warning must name AIStor data and remind about off-host backups.                                                                                                                         | Existing typed confirmation                                    | Existing                                                                       | **Yes**                                                 |

## 15. Security and Operational Requirements

- Validate inputs on the server; use parameterized queries or a safe ORM/query builder.
- Apply CSRF protection where the authentication/session approach needs it.
- Rate-limit registration and login.
- Protect against brute force, privilege escalation, insecure direct object references (including object keys), path traversal, and host-header or tenant-resolution abuse.
- Public error messages never reveal whether a private tenant database, user or bucket exists.
- Structured logs never contain credentials, tokens, access keys or private media/pre-signed URLs.
- Audit tenant creation, suspension, role changes, provisioning retries, bucket creation and assignment, storage key rotation, Platform Owner cross-tenant storage access, and backup/restore operations.
- Define backup, restore, tenant deletion and incident-response procedures.
- Keep dependencies (including the AIStor image and `mc`) updated and scanned for known vulnerabilities.

## 16. Performance and Reliability Validation

No performance guarantee is made without measurement. Thresholds are set on the target hardware and approved before production (§19).

| Check                    | Method                                                                                                   | Pass criterion                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Liveness and readiness   | Compose health checks, `make aistor-health`, `/api/health/ready`                                         | Healthy within the start period; probes return 200                          |
| Throughput and latency   | `make aistor-perf`, plus a load test of the app's upload/download paths with representative file sizes and concurrency | Baseline recorded; p95 latency, throughput and error rate within approved thresholds |
| Application memory       | Concurrent transfers of the largest allowed file                                                        | App stays within its memory limit: no OOM kills or restarts                 |
| Resource monitoring      | `make aistor-usage`, `docker stats`, AIStor metrics (verify endpoint and auth)                           | Alert thresholds defined for disk, memory and CPU                           |
| Restart durability       | Seed objects and backups; `make restart s=aistor`; `make down` then `make up`; compare                   | All checksums and the backup list match                                     |
| Backup and restore time  | Time `aistor-backup` and `aistor-restore-test` per database size                                        | Within the approved RPO/RTO (PRD D-13)                                      |

## 17. Testing Requirements

**Tenant isolation (database, files, cache)**

- Tenant A cannot access Tenant B's database, files, bucket or cache entries.
- A forged tenant ID in a request does not switch tenant context.
- A tenant hostname cannot resolve to another tenant's data.

**Storage isolation**

- Through the application, Tenant A cannot read, list, write or delete Tenant B's objects using forged tenant IDs, bucket names, object keys, path traversal (`../`) or manipulated URLs.
- Tenant A's storage credentials are denied on Tenant B's bucket, the Platform Owner bucket and backup storage (direct S3 API).
- A pre-signed URL for one object cannot be altered to reach another; expired URLs are denied.
- Customer X cannot access Customer Y's assets in the same tenant; sub-customer scoping holds.
- An authorized Platform Owner operation succeeds and is audited; a Sub-Platform Owner without the privilege is denied; anonymous access is denied.
- A suspended tenant's storage access is denied immediately through the application.

**RBAC**

- A user without permission is denied by the backend.
- A Sub-Tenant cannot grant permissions above its authority.
- Tenant users cannot grant Platform Owner privileges.
- Customer and sub-customer relationships are enforced.

**Provisioning**

- A valid registration, from either entry point, provisions the database, database user, bucket, storage identity and policy, schema, initial admin and subdomain mapping.
- Duplicate slugs are rejected; concurrent requests cannot provision the same slug or bucket twice.
- Manual assignment rejects assigned, retired, Platform Owner, backup, foreign-tagged and invalid buckets.
- A failure at any step leaves the tenant inactive; a retry recovers without duplicating resources.
- Secrets do not appear in logs, command output or browser responses.

**Backups and persistence**

- Backups are created, verified and restore-tested; a checksum mismatch is detected.
- A tenant backup cannot be restored into another tenant.
- Backup storage is unreachable with tenant credentials.
- Assets and backups survive AIStor restart and container recreation.

**Deployment and operations**

- The Docker-based local setup starts from documented steps, including `make aistor-install`.
- Production supports the chosen wildcard domain/TLS arrangement (and the storage hostname, if used).
- Database backup and restore are tested; health checks and migration procedures are documented.
- Every AIStor Makefile target returns the right exit code; destructive targets abort without confirmation; no target prints secrets.

## 18. Implementation Sequence

1. Confirm production host, DNS provider, base domain, database hosting and the AIStor license tier.
2. Create the Next.js/TypeScript project and the Docker-based local environment.
3. Configure PostgreSQL and Redis locally.
4. Implement the control-plane database and tenant lifecycle statuses.
5. Implement authentication and the Platform Owner boundary.
6. Implement tenant registration and safe database/user provisioning in Node.js.
7. Implement tenant subdomain resolution and local testing.
8. Implement per-tenant database connection selection.
9. Implement centralized RBAC.
10. Implement Sub-Tenant, customer and sub-customer management.
11. Implement tenant-scoped file storage foundations: the AIStor service, Makefile targets, platform identities and buckets (§6.3, §14).
12. Add the storage provisioning steps to both registration flows, plus the backfill for existing tenants (§4).
13. Migrate existing local files to AIStor (§9.9).
14. Implement database backups to AIStor with verification and restore tests (§11).
15. Add observability, audit logs, retries and isolation tests (database, storage, cache).
16. Deploy to the selected production host without Kubernetes or Docker Swarm.
17. Add detailed music release workflows after the core is stable.

## 19. Unresolved Technical Decisions and Conflicts

### 19.1 Decisions (never invent silently)

| Decision                                                                 | Current state                                                                                                  |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Exact Next.js, Node.js, PostgreSQL, Redis and Auth.js versions           | Repo pins Next.js 16.4.0, Node ≥ 24, PostgreSQL 18.6, Redis 8.10.2. Auth.js not adopted (TC-3).                |
| Production hosting provider                                              | Open                                                                                                           |
| PostgreSQL hosting and provisioning permissions                          | Open. Provisioning uses `POSTGRES_USER`; a dedicated provisioning login is a pending follow-up.                |
| DNS provider and wildcard DNS/TLS support                                | Open                                                                                                           |
| File storage provider and tenant isolation mechanism                     | **Decided in v1.1:** MinIO AIStor, one bucket and one storage identity per tenant (§9).                        |
| Queue library and worker runtime (also scheduled backups)                | Open                                                                                                           |
| Email delivery and verification method                                   | Open                                                                                                           |
| Authentication providers and account recovery flow                       | Open                                                                                                           |
| Expected tenant count and database connection strategy                   | Open                                                                                                           |
| Backup retention, restore objectives, tenant deletion policy             | Open (PRD D-10, D-13)                                                                                          |
| Exact database naming and secret-management scheme                       | Implemented (deterministic names; AES-256-GCM `secrets` table); confirm as final.                              |
| AIStor release to pin                                                    | Newest stable on 2026-10-17: `RELEASE.2026-09-19T17-05-25Z`; re-verify at implementation.                      |
| AIStor topology: single node with one or several drives, host disk size  | Open. Decides which features (versioning, replication) are available.                                          |
| Bucket names, backup bucket and key layout                               | _Proposed_ in §9.1 and §11.2                                                                                   |
| Environment variable names and default dev host ports for AIStor         | _Proposed_ in §6.4                                                                                             |
| Health-check command available in the pinned image                       | Verify at implementation                                                                                       |
| Performance and alert thresholds                                         | Set from a measured baseline on target hardware (§16)                                                          |
| Backup encryption at rest; object (asset) backup method                  | Open (PRD D-14)                                                                                                |
| Existing-database-mode tenants in backup scope                           | Open                                                                                                           |

### 19.2 Technical conflicts

| ID   | Conflict                                                                                                                                                       | Handling                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| TC-1 | The request names `Docker/.env`, but the project uses the root `.env` (`ENV_FILE`, default `.env`) with `.env.example`; there is no `docker/.env`.             | This TRD follows the existing root `.env`. Confirm.                                                       |
| TC-2 | `sudo make install-aistor` does not exist in the Makefile, scripts or docs, so there is nothing to preserve.                                                  | New targets follow the existing `<group>-<action>` naming (`aistor-install`); sudo stays a caller prefix. Confirm the name. |
| TC-3 | §1 specifies Auth.js, but the current code uses its own session authentication (Argon2id) with no Auth.js dependency.                                          | Requirement text unchanged; decision needed.                                                              |
| TC-4 | Files are currently stored on the local filesystem (`STORAGE_ROOT`). Tenant profile images are uploaded at creation, before the tenant bucket would exist.    | Migration per §9.9; location per PRD D-17.                                                                 |
| TC-5 | `make backup` covers only the control plane and writes to local `backups/` on the same host; the new requirement covers all databases in AIStor.              | Existing targets kept; new `aistor-backup*` targets added; off-host copy required (§11.5).                 |
| TC-6 | v1.0 listed a `user_roles` entity (several roles per user); the Strict Rules allow one role, implemented as a single `role_id`.                                | Single role applied (PRD C-1).                                                                            |

## 20. Definition of Done for the Core

The core is complete when a tenant, created by the Platform Owner or through public signup, can register; receive a unique SaaS subdomain; have a separate PostgreSQL database, database user and verified AIStor bucket provisioned; sign in securely; create authorized Sub-Tenants; and manage customers and sub-customers with no cross-tenant access to data, files or backups. A dedicated Platform Owner bucket exists, storage isolation tests pass, database backups are verified and restore-tested, and the AIStor Makefile targets work. All of this works in the documented Docker local environment and in the selected production hosting setup, without Kubernetes or Docker Swarm.
