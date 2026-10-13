# Product Requirements Document (PRD)

## Multi-Tenant Music Distribution SaaS

_Status:_ Initial MVP requirements\
_Version:_ 1.0\
_Product type:_ Multi-tenant SaaS\
_Primary goal:_ Build the core platform for tenant registration,
tenant isolation, access control, and music-distribution content
management foundations.

---

## 1. Product Overview

The product is a Software-as-a-Service (SaaS) music distribution
application. A person or organization can register as a tenant and
receive an independent platform space accessible through a SaaS-provided
subdomain.

Each tenant is the administrator of its own platform. Tenant
administrators can create sub-admins, customers, and manage role-based
permissions. Customers may be artists, labels, or white-label customers;
these are customer categories, not necessarily separate permission
systems. Access is controlled by roles and privileges.

The platform will later support customers uploading audio releases,
video releases, artist information, label information, and related
release metadata. Tenant administrators will review and process
submitted content.

## 2. Terminology

- _SaaS Owner / Super Admin:_ The owner/operator of the overall SaaS
  product. Manages the global platform and all tenants.
- _Tenant / Tenant Admin:_ A registered organization or account with
  its own isolated platform. The tenant owner is the administrator of
  that tenant.
- _Sub-Admin:_ A user created by a tenant to help administer its
  platform, with permissions assigned through roles.
- _Customer:_ A user or organization managed by a tenant. A customer
  may be an artist, label, or white-label customer.
- _Sub-Customer:_ A customer created under another customer, subject
  to the tenant's permission rules.
- _Role:_ A named set of access permissions.
- _Privilege / Permission:_ A specific action a user is allowed to
  perform.
- _Tenant subdomain:_ A SaaS-provided address used to access a
  tenant's platform, such as `tenant-slug.example.com`. The real
  production domain is to be configured later.

## 3. Goals

1.  Allow a user to register a tenant through the SaaS website.
2.  Provision a separate PostgreSQL database and a separate database
    user for each tenant.
3.  Assign each tenant a unique SaaS subdomain.
4.  Ensure tenant data, files, settings, users, and database credentials
    are isolated from every other tenant.
5.  Let a tenant administrator create sub-admins and manage role-based
    access.
6.  Establish the customer and sub-customer hierarchy.
7.  Keep the architecture compatible with local Docker development and
    production deployment without requiring the product owner to operate
    Kubernetes or Docker Swarm.
8.  Build a clean foundation for future audio/video release submission,
    review, and processing workflows.

## 4. MVP Scope

### 4.1 Global SaaS administration

The SaaS Owner / Super Admin can: - View the list of registered
tenants. - View tenant status and basic registration details. -
Activate, suspend, or otherwise manage a tenant. - View provisioning
status, including pending, in-progress, successful, or failed setup. -
Retry or recover a failed provisioning operation safely.

Global administration must not provide unrestricted browsing of tenant
content by default. Any exceptional support access must be deliberate,
authorized, and auditable.

### 4.2 Tenant registration and onboarding

A new tenant can: - Register with the required account and organization
details. - Verify the required contact method before the platform
becomes active, if verification is enabled. - Receive a unique tenant
slug and SaaS subdomain. - Have a dedicated PostgreSQL database and
dedicated database user provisioned automatically. - Access the tenant
platform after provisioning succeeds. - See a clear status or error
message if provisioning is still running or fails.

Registration must not report success or allow normal tenant access until
required provisioning steps have succeeded. Provisioning must be safe to
retry and must not create duplicate databases or conflicting subdomains.

### 4.3 Tenant platform and administration

Each tenant administrator can: - Access only their own tenant
platform. - Manage tenant-level settings and users. - Create, update,
disable, and manage sub-admin accounts. - Assign roles and permissions
according to the tenant's allowed permission boundaries. - Manage
customers and sub-customers. - View only the data belonging to their
tenant.

A tenant must not be able to create or assign SaaS Owner / Super Admin
privileges.

### 4.4 Role-based access control (RBAC)

- Permissions are enforced by the backend, not only by hiding
  navigation items.
- Roles group permissions, and users receive permissions through their
  assigned role or roles.
- Tenant administrators can manage tenant-level roles and permissions
  within predefined boundaries.
- Sensitive actions require explicit permissions.
- The system must deny access by default when a permission is missing.
- A user must not be able to grant permissions above the user's own
  authority or cross tenant boundaries.
- UI navigation should show only modules the user can access, while
  server-side checks remain authoritative.

### 4.5 Customer and sub-customer management

Within a tenant: - Tenant-authorized users can create and manage
customers. - A customer may be categorized as an artist, label, or
white-label customer. - Authorized customers can create sub-customers
where the assigned permissions allow it. - Customer categories do not
automatically grant privileges; role and permission rules determine
access. - A customer and its sub-customers must remain within the same
tenant boundary. - Users must not be able to access another customer's
records unless their permissions and relationship allow it.

### 4.6 Domain rules

- Every tenant receives a unique SaaS subdomain.
- Free-tier tenants use the SaaS-provided subdomain.
- Custom domains are out of scope for the initial free-tier MVP and
  may be supported after a paid-plan upgrade in a future phase.
- Subdomain names must be normalized and validated, reserved names
  must be blocked, and duplicate names must be rejected.
- Domain resolution must map a request to exactly one active tenant.
- Unknown, suspended, or unprovisioned tenant domains must not expose
  tenant data.

### 4.7 Subscription rules

- Initially, all tenants use the same free tier and the same
  subscription-plan structure.
- Complex billing, payment collection, usage-based billing, and
  plan-specific feature limits are out of scope for the initial core.
- The data model should not prevent subscription plans from being
  added later.

### 4.8 Music distribution foundation

The product is intended to support: - Audio releases. - Video
releases. - Artist records. - Label records. - Release metadata and
associated files. - Customer submission of content. - Tenant
administrator review and processing.

For the initial core, establish the relevant architecture and access
boundaries. Detailed distribution-channel integrations, royalty
calculations, revenue sharing, payouts, and external delivery workflows
are not yet specified and must not be invented as finalized
requirements.

## 5. Non-Functional Requirements

### Security and isolation

- Each tenant has its own PostgreSQL database and its own database
  user.
- Tenant database credentials must be stored securely and never
  exposed to browser code or logs.
- A tenant database user must have access only to that tenant's
  database and only the privileges needed by the application.
- Tenant context must be resolved and validated on every request.
- No tenant may access another tenant's database, files, settings,
  users, customers, or releases.
- Authorization must be enforced server-side on every protected
  operation.
- Secrets must be supplied through environment variables or an
  appropriate secret-management mechanism, not committed to source
  control.
- Important administrative and provisioning actions should be
  auditable.

### Reliability

- Provisioning operations must be idempotent or have safe recovery
  logic.
- Partial failures must be recorded and recoverable.
- The application must not mark a tenant active while required
  provisioning is incomplete.
- Errors must be actionable without revealing secrets or sensitive
  infrastructure details.

### Performance and scale

- The architecture should support onboarding additional tenants
  without changing application code for each tenant.
- Database connections must be managed carefully to avoid exhausting
  PostgreSQL connections as tenant count grows.
- Redis may be used for caching, rate limiting, queues, and temporary
  coordination where appropriate. Cache keys must be tenant-scoped
  when the cached data is tenant-specific.

### Usability

- Registration, setup status, and sign-in flows should be
  straightforward.
- Permission-denied and provisioning-error messages should be clear.
- Forms and tables should provide validation and useful error states.

## 6. Out of Scope for Initial MVP

- Custom domains for free-tier tenants.
- Paid subscription checkout and automated billing.
- Kubernetes or Docker Swarm operations.
- Detailed music-store or DSP integrations.
- Royalty/revenue-sharing calculations and payouts.
- Automated content delivery to third-party music platforms.
- Advanced analytics and reporting, unless separately specified.
- A promise of physical file isolation beyond what is selected and
  implemented in the approved storage design.

## 7. Acceptance Criteria

1.  A new user can register a tenant with a valid unique slug.
2.  The system provisions a dedicated PostgreSQL database and a
    dedicated database user for that tenant.
3.  The tenant receives a unique SaaS subdomain that resolves to the
    correct tenant.
4.  A second tenant receives a different database, database user, and
    subdomain.
5.  Tenant A cannot read or modify Tenant B's data, even by manipulating
    request parameters or URLs.
6.  Tenant database credentials are never sent to the browser.
7.  A tenant administrator can create a sub-admin and assign permitted
    roles.
8.  A sub-admin cannot perform actions outside their permissions.
9.  Tenant users can manage customers and sub-customers only within the
    allowed tenant and customer hierarchy.
10. Customer category (artist, label, or white-label) does not bypass
    RBAC.
11. Failed provisioning is visible to the global administrator and can
    be safely retried.
12. The same application codebase works in local Docker development and
    in the selected production hosting environment.
13. The application does not require Kubernetes or Docker Swarm for
    deployment.

## 8. Open Decisions

The following should be decided before implementation or before the
relevant feature is built: - Production hosting provider and its
domain/DNS capabilities. - The actual SaaS base domain and reserved
subdomain list. - Whether tenant registration requires email
verification or manual approval. - The file-storage design:
tenant-specific directories/buckets, storage credentials, quotas, and
backup policy. - Whether the SaaS Owner can access tenant data for
support, and the exact approval/audit process. - The authentication
provider and supported login methods. - Exact role templates and
permission catalogue. - Tenant database migration and schema-version
strategy. - Background-job/queue strategy for provisioning and future
media processing. - Backup, restore, deletion, and tenant offboarding
policies. - Audio/video file validation, storage limits, and upload
limits.

## 9. Product Principles

- Isolation and authorization are mandatory, not optional
  enhancements.
- The backend is the source of truth for permissions.
- Tenant provisioning must be observable, repeatable, and recoverable.
- Build the core tenant lifecycle first; add detailed
  music-distribution workflows after the foundation is reliable.
- Do not silently change agreed requirements. Record and approve
  changes explicitly.
