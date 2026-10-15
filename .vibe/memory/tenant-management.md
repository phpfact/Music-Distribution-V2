# Tenant management

## Overview and current architecture

The platform owner creates and manages tenants in `/platform/tenants`. The directory, summary counts, detail view, creation form and edit form are protected server pages. Existing tenant actions and services remain authoritative for validation, authentication, permissions, database writes, provisioning and auditing.

The directory searches and filters at the database level; pagination, query and status live in the URL. Desktop uses a table and smaller screens use equivalent cards. Detail cards show profile, login, database, domains, provisioning progress and status history. Setup progress refreshes server data without a full document reload. Tenant credentials are displayed only where the existing business flow permits it.

Creation supports generated credentials and manual entry, including attaching an existing database. Client form models use the shared domain, image, password and tenant rules, build the existing Server Action payload and preserve input after errors. Preview, connection checks and image selection use sequence guards to ignore stale results. Submit refs prevent immediate duplicate submissions. Edit preserves saved values, protects provisioning tenants and returns to the detail view after a successful save.

Lifecycle changes, password changes and retries require confirmation. Confirmation failures remain visible and drafts stay available. DNS failures update only their result and recorded check information. Tenant avatars use the protected avatar route. No schema, API or permissions changes are requested.

## Shared UI migration (2026-10-15)

The existing tenant screens now use the application's shared, source-owned shadcn/ui primitives: Button and Input in forms and actions; NativeSelect for directory filters; RadioGroup for creation and password-reset modes; Card for directory, detail, creation, success and connection views; Table for desktop results; Pagination for URL destinations; DropdownMenu for row actions; Dialog for the transient password result; Alert for connection-check summaries; Empty for directory recovery states; and Skeleton for each loading route. Shared console wrappers provide the migrated field labels, password input, confirmation, avatar, notifications, badges and summary cards.

The shared Appearance provider continues to supply theme, accent and width. Portaled menus and dialogs use the shared theme portal and semantic tokens. Strong brand classes use `primary`; status colors use success, warning or destructive tokens. No additional theme state or preferences are introduced. Root owns the shared component foundation and application wrappers; this module consumes it.

All field names and values, error-focus refs, accessible labels and descriptions, validation constraints, action results, pending states, responsive table/card behavior, SQL pagination and credential secrecy are preserved. Input and NativeSelect retain native form semantics. The two intentionally hidden file-picker inputs remain native behind the existing upload buttons and previews. Directory/detail titles retain heading semantics, and cards retain their region or article roles.

Radix manages keyboard navigation, positioning, dismissal and focus in the row menu. Its close autofocus is prevented while a lifecycle confirmation opens; closing the confirmation returns to the row trigger. The generated-password result focuses Done, retains its outside-click protection, closes on Done or Escape, clears its secret through the existing state callback, and restores focus to the reset trigger. DNS controls now use a real disabled pending button in addition to their existing action guard.

## Dependencies and validation

The module depends on shared console wrappers (Field, FormSection, Notice, Avatar, PasswordInput, ConfirmDialog), `@/components/ui`, tenant services/actions, domain DNS checks and storage image validation. Tests cover tenant services and actions, shared form models, SSR pages and protected HTTP routes. Verification will include lint/types and the root-owned integrated suite; root owns database suite scheduling and rendered browser checks.

## Change history

- 2026-10-15: Documented the existing module contracts and requested full shadcn/ui migration before implementation.
- 2026-10-15: Migrated all existing tenant UI surfaces to shared shadcn primitives while preserving actions, models, payloads, permissions and stored data. Prisma client generation, TypeScript verification, ESLint with zero warnings and whitespace checks pass. Root owns final integrated tests and rendered verification.

- 2026-10-15: Integration review restores wrapping for long table-cell domains
  and returns row-dialog focus through the shared close-autofocus callback after
  the modal trap exits. The integrated tenant business/HTTP tests passed; lint,
  TypeScript and production build pass. Browser checks remain pending the saved
  localhost:3100 permission block.
