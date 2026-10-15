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
