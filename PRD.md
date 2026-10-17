# Product Requirements Document (PRD)

## Multi-Tenant Music Distribution SaaS

| Field         | Value                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Status        | MVP requirements, including object storage and database backups (MinIO AIStor)                                                        |
| Version       | 1.1 (2026-10-17). Supersedes 1.0.                                                                                                     |
| Product type  | Multi-tenant SaaS                                                                                                                     |
| Primary goal  | Core platform for tenant registration, tenant isolation, access control, tenant-isolated storage and music-distribution foundations |
| Technical doc | [TRD.md](TRD.md)                                                                                                                      |

**Must** = mandatory. **Should** = expected unless a documented reason exists. Open decisions (§10) and conflicts (§11) must never be resolved silently.

---

## 1. Product Overview

- A SaaS music-distribution application. A person or organization registers as a **tenant** and receives an independent platform space on a SaaS-provided subdomain.
- Each tenant administers its own platform: it creates Sub-Tenants and customers and manages role-based permissions.
- Customers may be artists, labels or white-label customers. These are customer **categories**, not separate permission systems; roles and privileges control access.
- Later phases: customers upload audio releases, video releases, artist and label information and release metadata; tenant administrators review and process submissions.
- Every tenant's files live in its own MinIO AIStor bucket. The Platform Owner has a separate bucket. Database backups are stored securely and kept recoverable.

## 2. Terminology

| Term                  | Meaning                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Platform Owner        | Owner/operator of the SaaS (v1.0: "SaaS Owner / Super Admin"). Manages the global platform and all tenants.                     |
| Sub-Platform Owner    | Platform staff user. Accesses only the Platform Owner modules and data its role permits.                                        |
| Tenant (Tenant Admin) | A registered organization or account with its own isolated platform. The tenant owner administers it.                          |
| Sub-Tenant            | Staff user a tenant creates to help administer its platform, with permissions from its role (v1.0: "Sub-Admin").                |
| Customer              | User or organization managed by a tenant: an artist, label or white-label customer.                                             |
| Sub-Customer          | A customer created under another customer, subject to the tenant's permission rules.                                            |
| Role                  | Named set of permissions. Each user has exactly one role (§5.4).                                                                |
| Privilege/Permission  | A specific action a user is allowed to perform.                                                                                 |
| Tenant subdomain      | SaaS-provided address of a tenant platform, e.g. `tenant-slug.example.com`. The real production domain is configured later.     |
| Tenant bucket         | The one MinIO AIStor bucket that stores one tenant's assets.                                                                    |
| Platform Owner bucket | Dedicated bucket for Platform Owner data, separate from every tenant bucket.                                                    |
| Backup storage        | Storage for database backups, separate from application assets (§4.10).                                                        |
| Provisioning          | Creating and verifying a tenant's mandatory resources: database, database user, bucket, storage access, schema, initial admin and domain. |

## 3. Goals

1. Let a user register a tenant through the SaaS website, and let the Platform Owner create tenants from its panel.
2. Provision a separate PostgreSQL database and a separate database user for each tenant.
3. Provision a separate MinIO AIStor bucket for each tenant, plus a dedicated Platform Owner bucket.
4. Give each tenant a unique SaaS subdomain.
5. Isolate every tenant's data, files, bucket, settings, users and credentials from every other tenant.
6. Let tenant administrators create Sub-Tenants and manage role-based access.
7. Establish the customer and sub-customer hierarchy.
8. Keep database backups secure, verified and recoverable.
9. Work in local Docker development and in production without the product owner operating Kubernetes or Docker Swarm.
10. Build a clean foundation for audio/video release submission, review and processing.

## 4. Functional Requirements

### 4.1 Platform Owner administration

The Platform Owner can:

- View the tenant list, each tenant's status and basic registration details.
- Create, activate, suspend or otherwise manage a tenant.
- View provisioning status (pending, in progress, successful, failed), including the database and storage steps.
- Safely retry or recover a failed provisioning operation.
- Manually assign a bucket to a tenant, when authorized (§4.9.2).
- Manage all tenants and their authorized data from its own panel, without logging in to tenant accounts, and act on behalf of a selected tenant where its privileges allow (§5.3).

Global administration must not offer unrestricted browsing of tenant content by default. Cross-tenant access, including access to tenant buckets, happens only through specific authorized operations scoped to the selected tenant, and is audited. Exceptional support access must be deliberate, authorized and auditable (see C-3).

### 4.2 Tenant registration and onboarding

Both entry points must run the same provisioning workflow and rules:

1. **Platform Owner panel:** an authorized Platform Owner creates the tenant.
2. **Public website:** the tenant signs up directly.

A new tenant:

- Registers with the required account and organization details.
- Verifies the required contact method before activation, if verification is enabled (D-3).
- Receives a unique tenant slug and SaaS subdomain.
- Gets a dedicated PostgreSQL database, a dedicated database user and a dedicated bucket, provisioned automatically. An authorized Platform Owner may assign the bucket manually instead (§4.9.2).
- Can use its platform only after provisioning succeeds.
- Sees a clear status or error message while provisioning runs or after it fails.

**Provisioning sequence:**

1. Validate the registration.
2. Reserve a unique tenant identity (slug, subdomain) and allocate the database resources.
3. Create or validate the tenant's dedicated database and database user.
4. Create the tenant's bucket, or assign one in an authorized manner.
5. Apply and validate the bucket permissions and tenant isolation.
6. Apply the database migrations and complete the initial tenant setup.
7. Register the domain mapping and verify every mandatory resource.
8. Activate the tenant, only after every mandatory step has succeeded.

**Rules:**

- Never report success or allow normal tenant access before all mandatory steps succeed. A partially configured tenant is never shown as active.
- Every step's status is tracked. A failure records the failed step with a safe message and supports safe retry and recovery.
- Retries are idempotent: no duplicate databases, database users or buckets, and no conflicting subdomains or bucket assignments.
- Concurrent registrations for the same slug or bucket cannot both succeed.

### 4.3 Tenant administration

Each tenant administrator can:

- Access only its own tenant platform and view only its own tenant's data.
- Manage tenant-level settings and users.
- Create, update, disable and manage Sub-Tenants.
- Assign roles and permissions within the tenant's allowed boundaries.
- Manage customers and sub-customers.

A tenant can never create or assign Platform Owner privileges.

### 4.4 Role-based access control (RBAC)

- Roles group permissions. Each user receives permissions through exactly one assigned role (see C-1).
- Tenant administrators manage tenant-level roles and permissions within predefined boundaries.
- Sensitive actions require explicit permissions.
- Deny by default: a missing permission means access is denied.
- No user can grant permissions above its own authority or across tenant boundaries.
- Navigation shows only the modules a user can access. The backend stays authoritative (§5.5).

### 4.5 Customers and sub-customers

Within a tenant:

- Tenant-authorized users create and manage customers.
- A customer is categorized as artist, label or white-label. The category grants no privileges; roles and permissions decide access.
- Authorized customers create sub-customers where their permissions allow.
- A customer and its sub-customers stay inside the same tenant boundary.
- No user accesses another customer's records unless its permissions and relationship allow it (customer-to-customer rules: §5.2).

### 4.6 Domains

- Every tenant gets a unique SaaS subdomain. Free-tier tenants use it.
- Custom domains are out of scope for the free-tier MVP and may be offered after a paid-plan upgrade in a future phase (see C-5).
- Subdomain names are normalized and validated; reserved names are blocked; duplicates are rejected.
- A request host resolves to exactly one active tenant.
- Unknown, suspended or unprovisioned tenant domains expose no tenant data.

### 4.7 Subscriptions

- Initially every tenant uses the same free tier and plan structure.
- Complex billing, payment collection, usage-based billing and plan-specific feature limits are out of scope for the initial core.
- The data model must not prevent adding plans later.

### 4.8 Music distribution foundation

- Intended scope: audio releases, video releases, artist records, label records, release metadata and files, customer submissions, and tenant review and processing.
- The initial core establishes the architecture and access boundaries only.
- Distribution-channel (DSP) integrations, royalty calculations, revenue sharing, payouts and external delivery are not yet specified and must not be invented as finalized requirements.

### 4.9 Object storage (MinIO AIStor)

#### 4.9.1 Bucket model

- Every tenant has exactly one dedicated tenant bucket.
- The Platform Owner has one dedicated bucket, separate from all tenant buckets.
- Database backups are kept apart from application assets (§4.10).
- A bucket belongs to at most one tenant, ever. It is never shared, reused or reassigned to another tenant, including after its tenant is offboarded.
- The status of bucket creation, assignment and permissions is tracked and visible to the Platform Owner.

#### 4.9.2 Provisioning and manual assignment

- The bucket is created automatically during provisioning, or assigned manually by an authorized Platform Owner from its panel. Public signup can never choose or assign a bucket.
- Both paths validate bucket ownership and access permissions before the step succeeds.
- A manual assignment is rejected if the bucket is or was assigned to another tenant, is the Platform Owner or backup bucket, or fails validation.
- If storage provisioning fails, the tenant stays inactive with a failure status, safe retry and recovery (§4.2).

#### 4.9.3 Access rules (strict)

| Actor                               | Tenant buckets                                                                                              | Platform Owner bucket | Backup storage                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------- |
| Tenant, Sub-Tenant                  | Own tenant's bucket only, through the application, per role                                                 | Denied                | Denied                                          |
| Customer, Sub-Customer              | Own tenant's bucket only, through the application, limited to objects its permissions and ownership allow   | Denied                | Denied                                          |
| Platform Owner, Sub-Platform Owner  | Any tenant's bucket, only through authorized, audited operations scoped to the selected tenant, per role    | Per role              | Authorized backup operations only, per role     |
| Anyone else (incl. anonymous)       | Denied                                                                                                      | Denied                | Denied                                          |

- These rules are enforced on the backend through authorization, tenant-scoped storage credentials, bucket policies and server-side tenant context. Hidden navigation or UI controls are never enough.
- Client-supplied tenant IDs, bucket names, object paths and URLs are never trusted. Direct API requests, manipulated IDs, guessed object keys and unauthorized or tampered pre-signed URLs must fail.
- Customers and Sub-Customers never receive storage credentials.

#### 4.9.4 Assets

- Audio/video files, cover images and other supported assets are stored in, and served from, the correct tenant bucket only.
- Every upload is validated for file type, size and authorization before it is accepted.
- Private media stays private: downloads only through authorized endpoints or short-lived signed URLs.
- Supported asset types, size and upload limits, and quotas: D-11.

### 4.10 Database backups and recovery

- **Scope:** every tenant database and the Platform Owner (control-plane) database.
- Backups are stored apart from application assets with their own access permissions. Tenants, customers and other unauthorized users can never access backup files.
- Each backup's status (running, succeeded, failed, verified) is recorded. Failures are visible to the Platform Owner and retryable; one tenant's failure does not block the others.
- Backup integrity is verified, and restores are regularly tested in a disposable database.
- A restore is a confirmed, audited operation that never restores one tenant's data into another tenant.
- Retention, schedule, recovery objectives and an off-host disaster-recovery copy must be defined before production (D-13). A backup on the same host or disk as the database is not disaster recovery.
- Backup and restore procedures are documented and covered by verification tests.
- Credentials, access keys and connection details never appear in browser responses, logs or public configuration.
- Bucket versioning, lifecycle policies, encryption and replication become mandatory only after compatibility is verified and the requirement is approved. They are not assumed to be configured.

## 5. Strict Rules: Multi-Tenant Isolation, Hierarchy and Authorization

### 5.1 Absolute tenant isolation

- Every tenant is **100% isolated** from every other tenant. Tenant ABC never accesses tenant XYZ's data, and vice versa.
- A tenant accesses only its own data, Sub-Tenants, Customers and their Sub-Customers.
- No Tenant or Sub-Tenant may view, modify, delete or access another tenant's data (database, files, bucket, settings, users, customers, releases) under any circumstances.
- Never trust a client-supplied tenant ID. The backend enforces tenant ownership and isolation on every request and database operation.

### 5.2 Strict user hierarchy

Hierarchy: **Platform Owner → Tenant → Sub-Tenant / Customer → Sub-Customer**. Sub-Tenants and Customers are separate branches under their owning tenant.

- Each tenant manages only its own Sub-Tenants, Customers and Sub-Customers.
- Each Customer accesses only its own data and its own Sub-Customers' data, never another Customer's data or Sub-Customers.
- A Sub-Customer never accesses another Sub-Customer's or Customer's data, or any restricted Tenant or Platform Owner data.
- A Sub-Tenant accesses only its own authorized data and the permissions its parent tenant explicitly granted.
- Sub-Platform Owners access only the Platform Owner modules and data their roles permit.

### 5.3 Platform Owner administrative access

- The Platform Owner can view and manage all tenants and their authorized data from the Platform Owner panel, without logging in to tenant accounts.
- It can act on behalf of a selected tenant, including creating and managing that tenant's Customers and Sub-Customers, wherever its authorized capabilities permit.
- Cross-tenant access is explicitly authorized, securely scoped to the selected tenant, and audited.
- Platform Owner access never lets tenants reach one another's data and never bypasses Customer or Sub-Customer isolation.

### 5.4 Strict role and privilege isolation

- Platform Owner, Sub-Platform Owner, Tenant, Sub-Tenant, Customer and Sub-Customer access each follows its own authorization boundary.
- Each user has **exactly one assigned role**. Multiple roles and permission merging are prohibited.
- A role contains only permissions belonging to its panel and delegation scope.
- Master Platform, Master Tenant and Master Customer roles stay strictly isolated: each grants only its own panel's capabilities, never another panel's permissions.
- Administrators assign only privileges they may delegate. Privilege escalation through role creation, role editing, user creation or manipulated requests is never allowed.

### 5.5 Backend enforcement and immediate revocation

- Authentication, current permissions, account status, resource ownership and hierarchy are enforced on **every protected backend operation**. Hiding menus or buttons is never sufficient.
- When a privilege is removed, disabled or revoked, access stops immediately after the change is committed, without relying on logout, browser refresh or session expiry (see C-4 for pre-signed URLs).
- Permission changes, role changes, account suspension and disabled modules invalidate or update every relevant authorization cache and active-session permission state.
- Never trust stale session permissions, client-side checks, or user-supplied roles and ownership identifiers.

### 5.6 Security, data integrity and testing

- Apply tenant and customer ownership filters to every relevant database query, API, server action, file and object-storage access, export, download, backup and background operation.
- Prevent cross-tenant and cross-customer IDOR, data leakage, privilege escalation, and access through direct URLs or manually constructed requests.
- Preserve existing functionality while migrating all dynamic modules and actions into the centralized authorization system.
- Log sensitive administrative actions and role/permission changes without exposing passwords, secrets or credentials.
- Add automated negative tests proving that cross-tenant access, cross-customer access, unauthorized role assignment and revoked permissions are rejected.

### 5.7 Storage isolation

- The bucket access rules in §4.9.3 are strict rules.
- Tenant storage credentials reach that tenant's bucket only, never the Platform Owner bucket or backup storage.

**NON-NEGOTIABLE: No Tenant, Sub-Tenant, Customer or Sub-Customer may access data (including stored files and backups) outside its explicitly authorized hierarchy. Only the Platform Owner may perform authorized cross-tenant administrative operations. Every rule is enforced on the backend; the frontend is never assumed to provide security.**

## 6. Non-Functional Requirements

### 6.1 Security and isolation

- Each tenant has its own PostgreSQL database and database user. That user reaches only its own database, with only the privileges the application needs.
- Each tenant has its own bucket and tenant-scoped storage credentials, following least privilege.
- Tenant database and storage credentials are stored securely and never exposed to browser code or logs.
- Tenant context is resolved and validated on every request; isolation and server-side authorization follow §5.
- Secrets come from environment variables or a secret-management mechanism, are never committed to source control, and can be rotated.
- Administrative, provisioning, bucket-assignment and cross-tenant actions are auditable.

### 6.2 Reliability

- Provisioning (database and storage) is idempotent or has safe recovery logic.
- Partial failures are recorded and recoverable.
- A tenant is never marked active while mandatory provisioning is incomplete.
- Errors are actionable without revealing secrets or sensitive infrastructure details.
- Stored assets and backups stay available after Docker restarts and container recreation.
- Storage health is monitored and storage errors are actionable.

### 6.3 Performance and scale

- Onboarding more tenants needs no per-tenant application code changes.
- Database connections are managed so PostgreSQL connections are not exhausted as the tenant count grows.
- Redis may be used for caching, rate limiting, queues and temporary coordination. Cache keys for tenant-specific data are tenant-scoped.
- Large media transfers and backups must not exhaust application memory or block other users.
- Performance and reliability claims are backed by measurable health checks, load tests and resource monitoring. No unsupported performance guarantees.

### 6.4 Usability

- Registration, setup status and sign-in flows are straightforward.
- Permission-denied, provisioning-error and storage-error messages are clear.
- Forms and tables provide validation and useful error states.

## 7. Out of Scope for the Initial MVP

- Custom domains for free-tier tenants.
- Paid subscription checkout and automated billing.
- Kubernetes or Docker Swarm operations.
- Detailed music-store or DSP integrations.
- Royalty/revenue-sharing calculations and payouts.
- Automated content delivery to third-party music platforms.
- Advanced analytics and reporting, unless separately specified.
- Any promise of physical file isolation, durability or availability beyond the approved and implemented storage design. A bucket per tenant on a shared AIStor deployment is logical isolation; multi-node storage, replication and versioning are not assumed.

## 8. Acceptance Criteria

| ID    | Criterion                                                                                                                                                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1  | A new user can register a tenant with a valid, unique slug.                                                                                                 |
| AC-2  | The system provisions a dedicated PostgreSQL database and a dedicated database user for that tenant.                                                        |
| AC-3  | The tenant receives a unique SaaS subdomain that resolves to the correct tenant.                                                                            |
| AC-4  | A second tenant receives a different database, database user, bucket and subdomain.                                                                         |
| AC-5  | Tenant A cannot read or modify Tenant B's data, even by manipulating request parameters or URLs.                                                            |
| AC-6  | Tenant database and storage credentials are never sent to the browser.                                                                                      |
| AC-7  | A tenant administrator can create a Sub-Tenant and assign permitted roles.                                                                                  |
| AC-8  | A Sub-Tenant cannot perform actions outside its permissions.                                                                                                |
| AC-9  | Tenant users manage customers and sub-customers only within the allowed tenant and customer hierarchy.                                                      |
| AC-10 | Customer category (artist, label or white-label) does not bypass RBAC.                                                                                      |
| AC-11 | Failed provisioning is visible to the Platform Owner and can be safely retried.                                                                             |
| AC-12 | The same codebase works in local Docker development and in the selected production hosting environment.                                                     |
| AC-13 | Deployment does not require Kubernetes or Docker Swarm.                                                                                                     |
| AC-14 | A tenant created from the Platform Owner panel receives its own separate bucket.                                                                            |
| AC-15 | A tenant created through public signup receives its own separate bucket.                                                                                    |
| AC-16 | Manual bucket assignment works only for an authorized Platform Owner and passes validation; an assigned, Platform Owner, backup or foreign bucket is rejected. |
| AC-17 | A dedicated Platform Owner bucket exists, separate from all tenant buckets.                                                                                 |
| AC-18 | Tenant A can access its own bucket but not Tenant B's: not through the application, the storage API with A's credentials, manipulated IDs or keys, or pre-signed URLs. |
| AC-19 | Tenant customers and sub-customers perform only authorized operations, and only in their own tenant's bucket.                                               |
| AC-20 | The Platform Owner reaches tenant buckets through authorized operations, each audited; unauthorized users (including Sub-Platform Owners without the privilege) are denied. |
| AC-21 | Failed provisioning at any database or storage step recovers through safe retry without duplicate databases, users, buckets or assignments; the tenant stays inactive until every step passes. |
| AC-22 | After a Docker restart or container recreation, persisted assets and backup data remain available and intact (checksums match).                           |
| AC-23 | Database backup, integrity verification and restore procedures are verified by tests.                                                                       |
| AC-24 | The AIStor Makefile commands are documented, functional and failure-safe; destructive commands require explicit confirmation; no command prints secrets.    |
| AC-25 | Performance and reliability claims are supported by recorded, measurable test results.                                                                      |

## 9. Product Principles

- Isolation and authorization are mandatory, not optional enhancements.
- The backend is the source of truth for permissions.
- Tenant provisioning (database, storage, domain) is observable, repeatable and recoverable.
- Build the core tenant lifecycle first; add detailed music-distribution workflows once the foundation is reliable.
- Never silently change agreed requirements. Record and approve changes explicitly.

## 10. Open Decisions

To be decided before implementation, or before the relevant feature is built. Technical decisions are in TRD §19.

| ID   | Decision                                                                                                                         | Status                                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| D-1  | Production hosting provider and its domain/DNS capabilities                                                                      | Open                                                                                                     |
| D-2  | Actual SaaS base domain and reserved subdomain list                                                                              | Open                                                                                                     |
| D-3  | Whether tenant registration requires email verification or manual approval                                                      | Open                                                                                                     |
| D-4  | File-storage design: tenant directories or buckets, storage credentials, quotas, backup policy                                   | **Decided in v1.1:** one AIStor bucket and one storage credential per tenant, a Platform Owner bucket, separate backup storage. Quotas: D-11. Backup policy: D-13. |
| D-5  | Whether the Platform Owner can access tenant data for support, and the exact approval/audit process                              | Access defined by §5.3; approval workflow open (C-3)                                                     |
| D-6  | Authentication provider and supported login methods                                                                              | Open (TRD TC-3)                                                                                          |
| D-7  | Exact role templates and permission catalogue                                                                                    | Open                                                                                                     |
| D-8  | Tenant database migration and schema-version strategy                                                                            | Open                                                                                                     |
| D-9  | Background-job/queue strategy for provisioning, media processing and scheduled backups                                           | Open                                                                                                     |
| D-10 | Backup, restore, deletion and tenant offboarding policies, including what happens to an offboarded tenant's bucket and backups    | Open                                                                                                     |
| D-11 | Audio/video file validation, supported asset types, storage limits, upload limits and per-tenant quotas                          | Open                                                                                                     |
| D-12 | AIStor license tier for production. The Free tier is single-node only, without support; MinIO states production needs an active license. | Open                                                                                               |
| D-13 | Backup schedule, retention, recovery objectives (RPO/RTO), restore-test frequency and off-host disaster-recovery copy             | Open                                                                                                     |
| D-14 | Backup and disaster-recovery method for stored assets (objects)                                                                  | Open                                                                                                     |
| D-15 | Tenants that were active before v1.1 and have no bucket: backfill timing, and whether they stay active meanwhile                 | Open (C-6)                                                                                               |
| D-16 | Pre-signed URLs vs application-proxied transfers, URL expiry, and how revocation stays immediate                                  | Open (C-4)                                                                                               |
| D-17 | Where tenant profile images (uploaded by the Platform Owner at tenant creation) are stored: tenant bucket or Platform Owner bucket | Open                                                                                                    |
| D-18 | Whether manual assignment may adopt a non-empty bucket that has no ownership marker                                               | Open                                                                                                     |

## 11. Conflicts Pending Approval

| ID  | Conflict                                                                                                                                                                                                  | Handling in this version                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| C-1 | v1.0 §4.4 said users get permissions through "role or roles"; the Strict Rules (§5.4) allow exactly one role, which the code implements.                                                                  | Strict Rule applied. Confirm that the v1.0 wording is retired.                                                               |
| C-2 | v1.0 used "SaaS Owner / Super Admin" and "Sub-Admin"; the Strict Rules and code use "Platform Owner" and "Sub-Tenant".                                                                                    | Terms unified (§2), meaning unchanged.                                                                                       |
| C-3 | v1.0 §4.1 forbids unrestricted browsing of tenant content and treats support access as exceptional; §5.3 and the new storage rule let the Platform Owner access any tenant's data and bucket through authorized operations. | Both kept: access only through specific, scoped, audited operations. Confirm that tenant-bucket access is a normal privileged operation, not an exceptional support flow. |
| C-4 | A pre-signed URL stays valid until it expires, but §5.5 requires access to stop immediately after revocation.                                                                                             | Open (D-16). Options: application-proxied downloads, very short expiry, or revoking the signing key on suspension.          |
| C-5 | Custom domains are out of scope for the MVP, but the current code already supports custom-domain verification.                                                                                           | Requirement unchanged; confirm the scope.                                                                                    |
| C-6 | The new rule "active only after storage setup" makes existing active tenants without a bucket non-compliant.                                                                                              | Open (D-15). Existing access must not be removed without approval.                                                          |
