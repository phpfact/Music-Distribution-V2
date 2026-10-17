# Tenant management

## Overview and current architecture

The platform owner creates and manages tenants in `/platform/tenants`. The directory, summary counts, detail view, creation form and edit form are protected server pages. Existing tenant actions and services remain authoritative for validation, authentication, permissions, database writes, provisioning and auditing.

The directory searches and filters at the database level; pagination, query and status live in the URL. Desktop uses a table and smaller screens use equivalent cards. Detail cards show profile, login, database, domains, provisioning progress and status history. Setup progress refreshes server data without a full document reload. Tenant credentials are displayed only where the existing business flow permits it.

Creation supports generated credentials and manual entry, including attaching an existing database. Client form models use the shared domain, image, password and tenant rules, build the existing Server Action payload and preserve input after errors. Preview, connection checks and image selection use sequence guards to ignore stale results. Submit refs prevent immediate duplicate submissions. Edit preserves saved values, protects provisioning tenants and returns to the detail view after a successful save.

Lifecycle changes, password changes and retries require confirmation. Confirmation failures remain visible and drafts stay available. DNS failures update only their result and recorded check information. Tenant avatars use the protected avatar route. The UI migration did not change schema, APIs or permissions. The later audit adds the narrow identity-recovery columns documented below.

## Shared UI migration (2026-10-15)

The existing tenant screens now use the application's shared, source-owned shadcn/ui primitives: Button and Input in forms and actions; NativeSelect for directory filters; RadioGroup for creation and password-reset modes; Card for directory, detail, creation, success and connection views; Table for desktop results; Pagination for URL destinations; DropdownMenu for row actions; Dialog for the transient password result; Alert for connection-check summaries; Empty for directory recovery states; and Skeleton for each loading route. Shared console wrappers provide the migrated field labels, password input, confirmation, avatar, notifications, badges and summary cards.

The shared Appearance provider continues to supply theme, accent and width. Portaled menus and dialogs use the shared theme portal and semantic tokens. Strong brand classes use `primary`; status colors use success, warning or destructive tokens. No additional theme state or preferences are introduced. Root owns the shared component foundation and application wrappers; this module consumes it.

All field names and values, error-focus refs, accessible labels and descriptions, validation constraints, action results, pending states, responsive table/card behavior, SQL pagination and credential secrecy are preserved. Input and NativeSelect retain native form semantics. The two intentionally hidden file-picker inputs remain native behind the existing upload buttons and previews. Directory/detail titles retain heading semantics, and cards retain their region or article roles.

Radix manages keyboard navigation, positioning, dismissal and focus in the row menu. Its close autofocus is prevented while a lifecycle confirmation opens; closing the confirmation returns to the row trigger. The generated-password result focuses Done, retains its outside-click protection, closes on Done or Escape, clears its secret through the existing state callback, and restores focus to the reset trigger. DNS controls now use a real disabled pending button in addition to their existing action guard.

## Per-section credential modes, masking and layout refresh (2026-10-15)

### Business requirement

The owner asked for a more professional layout on every tenant screen, for the
global "Auto generate / Manual entry" control at the top of the create form to
be removed, for each section that has generated values to carry its own
Auto-Generate / Manual switch, for generated fields to be hidden instead of
shown read-only, and for sensitive values (username, passwords, database
name/user) to be masked behind an eye button.

### Decisions confirmed with the owner

- **Scope:** all tenant screens (directory, detail, create, edit) get the
  refreshed layout.
- **Masking scope ("credential areas"):** username, database name, database
  user and passwords are masked by default, with an eye button to reveal them,
  in the create/edit form inputs, the post-create success panel, the reset
  master-password result and the detail page's Admin login and Database cards.
  The `@username` line under the tenant name in the directory (table and card)
  and in the detail header is removed so it does not reveal what the cards
  mask. Searching by username keeps working (database-level search unchanged).
- **Auto view:** in a section set to Auto-Generate the generated fields are
  hidden completely. A short note says what will be generated. Inputs that
  always need the owner (Email, Custom domain, Full name, Phone, image) stay
  visible. After creation the success panel shows the values that were
  generated (username, subdomain, database name/user; masked, with eye and
  copy) and the generated master password once (masked, with eye and copy).

### Sections and their modes

| Section            | Mode field (FormData / server) | Generated in Auto                                   |
| ------------------ | ------------------------------ | --------------------------------------------------- |
| Tenant admin login | `loginMode`                    | username (preview), master password (server)        |
| Database           | `databaseCredentialMode`       | database name + user (preview), password and port (server) |
| Domain             | `subdomainMode`                | SaaS subdomain (preview)                            |

Each is `auto` or `manual`; all start in `auto`. The old single
`credentialMode` field is replaced by these three (the create form is its only
client). Tenant profile has nothing to generate and has no switch.

- Attaching an existing database requires the Database section in Manual. In
  Auto the section only states that a new database, user and password are
  created on the configured server; the "new vs existing" choice, the fields,
  the port and Test connection appear in Manual.
- Switching one section to Manual for the first time fills that section's
  still-empty identifiers from the latest preview (never passwords). Typed
  values survive switching back and forth. Errors of that section's
  mode-dependent fields are cleared on a switch; other sections' errors stay.
- The preview (`previewTenantValuesAction`) is requested only while at least
  one section is in Auto; it still returns all four identifiers and each Auto
  section submits its own.
- A hidden generated field can still fail on the server (e.g. "<value> is no
  longer available — regenerate"). Its error is shown inside that section's
  Auto note with a Regenerate button; the error summary link focuses the
  section's mode switch when the field itself is hidden. While a preview is
  loading the Auto note shows a small spinner; a preview failure shows a
  warning with Regenerate.
- Server (`createTenant`): login Manual → master password from input, else
  generated and returned once; database Manual → database password and port
  from input, else generated password and the configured port. "Regenerate"
  wording on conflicts applies per field according to its own section's mode.
  A port-reachability failure is reported on `databasePort` only when the
  Database section is Manual. Audit metadata records the three modes (never
  values) instead of `credentialMode`.

### Masking behaviour

- `SensitiveInput` (shared console wrapper): a normal `type="text"` input whose
  characters are visually masked with CSS `-webkit-text-security` until the eye
  button reveals them. Not `type="password"`, so password managers never treat
  a username or database name as a password. Value, validation, focus and
  ARIA are unchanged by toggling.
- `SensitiveValue` (shared console wrapper): read-only display that renders a
  fixed-length dot mask (length never leaks) until revealed, with an optional
  copy button. This is shoulder-surfing protection, not an access boundary:
  the value is already authorised for the platform owner and is present in the
  page payload.
- `PasswordInput` keeps its behaviour and now shares the same reveal button.

### Layout refresh

- Shared console wrappers added for this: `PageHeader` (back link, eyebrow,
  h1, description, actions), `FormSection` now takes an `icon` (tinted tile)
  instead of a number and has an `action` slot for the switch, `FormActions`
  (sticky action bar at the bottom of the scroll area with the required-field
  legend), `ModeSwitch`, `RevealToggle`, `SensitiveInput`, `SensitiveValue`.
- Create: centred `max-w-4xl`; profile section shows the image picker on the
  left and name/phone beside it (stacked on phones); each switchable section
  has its switch in the header (it wraps under the title on phones); the Auto
  note shows a live status (waiting for the full name / preparing values /
  ready); actions in the sticky bar ("Cancel", "Create tenant").
- Edit: same page header, section look, image-beside-fields profile layout,
  masked username input and sticky action bar.
- Detail: header shows avatar, name, status and created date (no username);
  card headers share a minimum height so side-by-side cards line up; username
  and database name/user are `SensitiveValue`s.
- Directory: `PageHeader`; the separate Created column was folded into the
  Tenant cell ("Created <date>" under the name, where `@username` used to be),
  which leaves the Domain column room for a host on one line; hosts wrap with
  `overflow-wrap:anywhere` instead of `break-all` (natural break points first).
  The table now has six columns and fits at `xl` next to the expanded sidebar.
  Filters, search, pagination, cards below `xl` and empty states unchanged.

### Technical notes (this change)

- `-webkit-text-security` masks `SensitiveInput`; a browser without support
  shows the text unmasked (the field still works). No `type="password"` on
  identifiers, by design.
- The React compiler lint (`react-hooks/refs`) rejects building the switch's
  change handler inside a render-time helper, because `changeSectionMode`
  touches a ref (connection sequence); the three `ModeSwitch`es are therefore
  written inline in JSX, with `switchDescribedBy()` computing only ARIA ids.
- Error-summary links: `focusField` focuses the field, or, when an Auto
  section hides it, the checked option of that section's switch.
- The success panel's "Generated values" come from `generatedSummary()`
  captured at submit (client state), not from the server response; the server
  stores exactly the submitted preview values.

### Verification (2026-10-15)

- TypeScript, ESLint (zero warnings) and the full Vitest suite pass in the app
  container: 36 files, 1072 tests (1 pre-existing localhost-only skip).
- Rendered in the in-app browser at 1280×900 and 375×812: create (Auto notes,
  preview "Ready", Database and Login/Domain switched to Manual with prefill
  and masking, eye reveal, error summary), directory (fits without horizontal
  scroll, actions visible), detail (masked values, reveal), edit (layout,
  masked username). No horizontal overflow on phones.
- Not exercised in the browser: an actual create submission (it would create
  a real tenant database), hence the success panel and the reset-password
  result dialog were not seen rendered.

## Dependencies and validation

The module depends on shared console wrappers (Field, FormSection, Notice, Avatar, PasswordInput, ConfirmDialog), `@/components/ui`, tenant services/actions, domain DNS checks and storage image validation. Tests cover tenant services and actions, shared form models, SSR pages and protected HTTP routes. Verification will include lint/types and the root-owned integrated suite; root owns database suite scheduling and rendered browser checks.

## Change history

- 2026-10-17: Resolved AUD-20261017-001/002. A provisioned tenant's master
  password reset locks the account selected by its stored admin username,
  requires that account to be the primary staff user, then updates its hash and
  deletes all of its sessions by immutable user ID in one tenant transaction.
  A revocation failure rolls back the hash. Stale usernames that now identify a
  nonprimary/customer account fail safely as a missing admin; profile edits and
  their compensation keep their existing username contract and preserve
  sessions. Workspace issuance uses a matching user lock and verified hash, so
  an in-flight old-password login cannot survive reset. Pending setup continues
  to replace only the pending hash; generated-password/audit behavior is retained.
- 2026-10-15: Documented the existing module contracts and requested full shadcn/ui migration before implementation.
- 2026-10-15: Migrated all existing tenant UI surfaces to shared shadcn primitives while preserving actions, models, payloads, permissions and stored data. Prisma client generation, TypeScript verification, ESLint with zero warnings and whitespace checks pass. Root owns final integrated tests and rendered verification.

- 2026-10-15: Integration review restores wrapping for long table-cell domains
  and returns row-dialog focus through the shared close-autofocus callback after
  the modal trap exits. The integrated tenant business/HTTP tests passed; lint,
  TypeScript and production build pass. Browser checks were blocked by the saved
  localhost:3100 permission gate; on 2026-10-15 the user explicitly waived those
  checks. No rendered-browser results are claimed.
- 2026-10-15: Requested and documented per-section Auto-Generate / Manual
  switches (replacing the global credential mode), hidden generated fields,
  masked sensitive values with eye buttons, removal of `@username` from the
  directory and detail header, and a professional layout refresh across all
  tenant screens.
- 2026-10-15: Implemented the above. Server `createTenant` takes `loginMode`,
  `databaseCredentialMode` and `subdomainMode` (replacing `credentialMode`);
  form model, form, success panel, edit form, detail and directory updated;
  spec (docs/tenant-management.md §8.1, §9.2–9.4) updated; tests extended for
  mixed modes. Directory Created column folded into the Tenant cell.

## CLAUDE.md compliance audit and secondary menu (requested 2026-10-15)

### Requirement

The owner asked that all tenant management code (frontend and backend) follow
CLAUDE.md, and explicitly asked for a secondary menu in Tenant Management.

### Decisions confirmed with the owner (2026-10-15)

- **Full name:** letters only (any script, e.g. Hindi), spaces and the
  characters `. ' - &`. No digits, no other symbols. 2–200 characters after
  trimming and collapsing whitespace. Applies to create and edit, client and
  server (`validateFullName` in `src/lib/tenants/rules.ts`). Existing tenants
  whose names contain digits must rename on their next edit (none exist today).
- **Phone:** optional; when given, an Indian mobile number of exactly 10 digits
  starting with 6, 7, 8 or 9. Stored as those 10 digits. While typing, every
  non-digit is removed (`sanitizeIndianMobileInput`); a pasted "+91 98765 43210"
  or "098765 43210" keeps the 10-digit number. The database CHECK
  (`^\+?[0-9]{7,15}$`) is unchanged: 10 digits satisfy it, and existing rows
  are not rewritten. Two stored phones do not match the new rule; the edit form
  shows their value and asks for a valid number before saving.

### Decisions taken from the CLAUDE.md rules

- **Secondary menu** (shared `SectionedLayout` / `SecondaryMenu`):
  - Create: Personal Information, Login Information, Database Information,
    Domain Information.
  - Edit: Personal Information, Login Information, Domain Information.
  - Details: Setup Progress (only while shown), Personal Information, Login
    Information, Database Information, Domain Information, Status History.
  - Directory: Summary, Tenant Directory (top variant, so the wide table keeps
    its width).
  Desktop (lg+) shows a sticky vertical menu beside the content; smaller screens
  show a sticky horizontal menu above it. Click scrolls smoothly to the section
  heading; scrolling highlights the visible section; missing sections (success
  panel, hidden setup card) disappear from the menu automatically.
- **Category names:** sections are renamed to "Personal Information" (image,
  full name, phone), "Login Information" (username, email, master password,
  2FA), "Database Information" and "Domain Information". Email stays under
  Login Information because it is the tenant admin account's email.
- **Masking:** email and phone are sensitive. Directory rows/cards, the details
  Personal and Login cards, and the create/edit inputs mask them with an eye
  button (`SensitiveValue` / `SensitiveInput`). The database server host is
  masked too (connection information). Status-history actors and the
  suspension notice mask platform-owner usernames ("System" is not masked).
  History entries carry `actorIsUsername`; the suspension carries `byIsUsername`.
- **Counts:** summary cards (Total, Active, Suspended, Pending setup, "N
  failed"), the directory total badge and the "Showing a–b of n" line open the
  shared count-details dialog with the calculation and the exact tenants
  (server-side pagination through `listTenantCountRecords`). The setup line
  "x of y steps done" opens a dialog listing every step with its state. Error
  summaries list the invalid field names (each a link) instead of "n fields
  need attention".
- **Risky actions:** Cancel on a create/edit form with unsaved changes asks for
  confirmation; leaving the success panel while a generated master password is
  still the only copy ("Create another tenant", "View tenant") asks for
  confirmation.
- **Dependent fields:** the section Auto-Generate / Manual switches are disabled
  while the generated values are loading (the note shows "Preparing values…").
- **Whitespace:** email, custom domain and identifiers are trimmed on blur.
- **Empty states:** directory, status history and count-details lists use the
  shared `EmptyState` (illustration, heading, description, optional action).
- **Status filter:** the directory status select has five fixed options and is
  exempt from the searchable-select rule (search would add nothing).

### Change history

- 2026-10-15: Recorded the CLAUDE.md compliance requirements (name and phone
  rules confirmed by the owner, secondary menu on create/edit/details/directory,
  category names, masking, clickable counts, risky-action confirmations).
- 2026-10-15: Implemented the compliance pass:
  - Rules: `validateFullName` (letters/spaces/. ' - & only), `validatePhone`
    (Indian 10-digit), `sanitizeIndianMobileInput`, `parseTenantCountSource`,
    `parseTenantCountPage` in `src/lib/tenants/rules.ts`; tests updated.
  - Backend: `listTenants` and the new `listTenantCountRecords` share
    `queryTenantPage` (database pagination); `COUNT_CATEGORY_CONDITIONS` mirror
    `getTenantSummary`; history entries carry `actorIsUsername`, the suspension
    `byIsUsername`; `suspensionSentence` replaced by `suspensionLead` (the page
    renders the masked actor and the reason).
  - Server Action `loadTenantCountRecordsAction` (actions.ts): owner-only,
    validated arguments, returns id/name/status/created date only, friendly
    error with server-side log.
  - UI: secondary menus (create, edit, details: sidebar variant; directory:
    top variant), sections renamed to "... Information", masked email/phone/
    host/actor, count dialogs (`TenantCountRecords`, `tenantSummaryDetails`,
    `tenantListDetails`, setup steps dialog), error summary lists field names,
    Cancel confirmation on dirty forms (`hasUnsavedInput`, `hasUnsavedEdits`),
    success-panel confirmation while a generated password is shown, mode
    switches disabled while a preview loads, trim-on-blur for email/custom
    domain, real-time re-validation of fields that show an error.
  - Shared: ConfirmDialog's inner form stops submit propagation (a dialog
    opened from inside another form can never submit that form); the Cancel
    dialogs are rendered outside the forms anyway.
  - Test data: tenant names in tests use letters only (`randomLetters`,
    `testTenantName`); the LIKE-escaping test uses `%`/`_` in emails now.
  - Details grid switches to two columns at 2xl (the menu takes width at xl).
- 2026-10-15: Code-quality pass (CLAUDE.md): every function in this module's
  frontend and backend files now has the full doc block (Description, Input,
  Output, Use case, Author, Created, Last modified; "Created: X. Last modified:
  Y." one-liners split into two lines); consecutive single-line const/let
  declarations have their "=" vertically aligned (typed and untyped
  declarations are aligned in separate groups).

### Known limitations (2026-10-15)

- Rendered-browser verification of the new menus/dialogs was not completed in
  this pass: creating a verification session needed a token the tool policy
  would not reveal; the owner can sign in in the in-app browser to check.
- `next build` was not run (it would overwrite the running dev server's .next).
- 2026-10-15: Verification of the compliance pass: TypeScript (including tests)
  and ESLint (zero warnings) pass; the full Vitest suite passes in the app
  container: 37 files, 1136 tests, 1 pre-existing localhost-only skip.

## Customer registrations for a tenant (requested 2026-10-15)

- The tenant detail page gets a "Registrations" header action (for tenants
  whose setup has completed: active or suspended) that opens
  `/platform/tenants/<id>/registrations`, where the Platform Owner reviews the
  tenant's customer registrations (approve / reject with reason / suspend /
  reactivate). Business rules, data and security are documented in
  `customer-registration.md`; this module only adds the entry point.

### Change history

- 2026-10-15: Recorded the Registrations entry point on the tenant detail page.

- 2026-10-16: Implemented as recorded above. Verified: TypeScript, ESLint (0 warnings), full Vitest suite 40 files / 1174 tests passed (new: workspace-rules, workspace-portal with two real provisioned tenants, workspace-http). Browser-verified on a test tenant created in the Platform Owner panel: welcome, login (errors, wrong password, admin by username/email), tenant dashboard, dark theme switch persisting after reload, customer sign-up (validation, pending login blocked), tenant-admin approval, logout + Back, customer dashboard, customer blocked from /tenant, Platform Owner registrations page (count popup, reject with reason), rejected login -> status page -> review request, Platform Owner suspension ending the active session. Not browser-verified yet: "Apply to everyone" appearance, phone/tablet layouts.

## RBAC foundation (2026-10-16)

- Provisioning (`create_initial_admin`) upserts the role with key `owner` as
  **Master Tenant** (name "Master Tenant", domain `tenant`, system key
  `master_tenant`, status active, never back to "Owner"), marks the admin the
  primary staff account (unless another one already is) and assigns exactly
  that role (`user_roles` is keyed by user_id; upsert). `verify` checks the
  admin holds the active role with `system_key = 'master_tenant'`.
- New tenant databases get both master roles and the catalog mirror from the
  rbac tenant migration (role-privilege-management.md). Per-tenant module
  switches live in the control plane (`tenant_module_settings`, cascades with
  the tenant row).

### Change history

- 2026-10-16: Provisioning writes Master Tenant + primary admin; verify by
  system key; verify failure message now says the admin "does not hold the
  Master Tenant role".

## RBAC enforcement (2026-10-16)

- Pages: directory + details (+ metadata) `platform.tenants.view`; `/new`
  `platform.tenants.create`; `/[id]/edit` `platform.tenants.edit`;
  `/[id]/registrations` `platform.tenant_registrations.view`. Without the
  privilege the page renders the shared `AccessDenied` state (HTTP 200)
  before reading any tenant data; the avatar route answers 404.
- Buttons follow the privileges: Create tenant (create), Edit + DNS checks
  (edit), Suspend/Reactivate (suspend), Retry setup (provision), Reset master
  password + database password (credentials), Registrations link
  (tenant_registrations.view). The row menu (`TenantRowActions`, new `can`
  prop) is omitted when it would be empty.
- Server Actions authorize with `authorizePlatformAction(key, { ipAddress })`
  before anything else: create/preview/test-connection → create;
  suspend/reactivate → suspend; retry → provision; count records → view;
  update/verify custom domain/recheck subdomain → edit; reset master
  password/rotate/update DB password → credentials; registrations load →
  tenant_registrations.view, approve/reject → review, suspend/reactivate
  customer → suspend. Refusals (audited `authz.denied`) use the action's
  normal shape: `ForbiddenFailure` `{ ok: false, reason: "forbidden", message }`,
  connection test `{ kind: "error", reason: "forbidden" }`, forms a
  form-level error, count/registration loaders their `message`/`error`.
- Change history: 2026-10-16 — every page, action and route of the module is
  privilege-checked (tests: rbac-enforcement*.test.ts).

## Module access section (2026-10-16)

- The details page has a new **"Module access"** section (secondary menu item
  `tenant-module-access`, between Domain Information and Status History),
  visible to everyone who can open the page (`platform.tenants.view`).
- Two groups, "Tenant panel" (`tenant.*` modules) and "Customer panel"
  (`customer.*` modules), each row: module label, description and its
  privileges (small muted list). With `platform.tenant_modules.manage` a
  non-core row has a Switch; otherwise a read-only "On"/"Off" badge. Core
  modules (roles, sub-users / sub-customers) show a locked "Core · always on"
  badge and can never be switched.
- Turning a module off asks for confirmation ("Every tenant role, including
  Master Tenant, loses these privileges immediately" / the customer wording
  with Master Customer); turning it on applies directly. Server Action
  `setTenantModuleAction(tenantId, moduleKey, enabled)` in
  `tenants/[id]/module-actions.ts` → `setTenantModuleEnabled` (module service,
  role-privilege-management.md "Module switches"); settings live in the
  control plane (`tenant_module_settings`, absent row = enabled) and apply to
  that tenant's users on their next request.
- Change history: 2026-10-16 — section added.

## Audit integrity fixes (2026-10-17)

- AUD-20261017-003: every provisioning attempt must run the idempotent
  `apply_migrations` reconciliation against the deployed migration set, even
  when an earlier attempt completed that step. Other completed steps retain
  their resume behavior.
- AUD-20261017-004: identity edits must hold the tenant's shared identity lock,
  target a validated primary staff user's immutable UUID, and reject a stale
  control-plane snapshot. The control-plane tenant stores that UUID, a
  monotonically increasing identity version and a durable synchronization flag.
  The profile/audit transaction commits the desired identity and recovery flag
  before the tenant transaction commits. A failed or interrupted tenant commit
  therefore leaves explicit recoverable work, rather than an untraceable split.
  Subsequent edits and master-password resets reconcile the saved desired
  identity under the same tenant lock before proceeding. Clearing the flag is
  version-conditional, so an older request cannot clear newer work. Failures
  after the control-plane commit must preserve the referenced profile image.
- AUD-20261017-005: administrator identity writes also respect pending and
  rejected customer-registration reservations. The runtime SQL path will share
  the identity lock and conflict policy with registration/account creation;
  field errors explain the particular reservation before either identity changes.
- AUD-20261017-021: directory and count-record readiness must inspect schema
  state as well as tenant lifecycle. A failed schema is failed, a pending schema
  is pending, and only an otherwise provisioned current schema is ready.
- Existing AUD-20261017-001/002 behavior remains: password reset validates the
  primary staff account and revokes its sessions in the same tenant transaction.

### Audit verification and related storage fix

- TypeScript and targeted ESLint pass. Five real-database regression files
  pass: 130 tests, with one existing localhost-only DNS skip. Coverage includes
  a migration appended between failed setup/retry, actual overlapping identity
  edits, a tenant-write failure after the durable profile commit, recovery via
  a no-change edit/password reset, open-registration reservations, schema
  readiness in directory/count records, and prior session-reset containment.
- AUD-20261017-020 image decoding/re-encoding belongs to the storage module; see
  `profile-images.md` for the coordinated audit change.
- Follow-up reservation/account regressions also pass: four files, 50 tests
  (identity integrity, RBAC sub-users, tenant customers and workspace portal).
  The earlier username-based profile compensation contract in the AUD-001/002
  historical entry is superseded by the durable immutable-ID flow above; its
  password/session guarantees remain intact.
