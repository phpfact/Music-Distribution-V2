# Shared UI Components

## Overview and requested change

Migrate the existing SaaS interfaces to source-owned shadcn/ui components while
preserving native Server Actions, form validation, authentication and tenant
workflows. The application uses Next.js 16, React 19 and Tailwind CSS 4; retain
those versions and the existing CSS-first Tailwind configuration.

## Architecture and decisions

- Use one Radix-based shadcn component set under `src/components/ui`, with the
  official registry configuration in `components.json` and the shared `cn`
  utility in `src/lib/utils.ts`. Avoid an additional form or table state library.
- Keep server-rendered forms and tables where they already exist. NativeSelect
  preserves browser submission, URL filters, and operation without JavaScript.
- Existing app wrappers provide real application semantics (field error IDs,
  status messages, confirmation validation), composed from the shared primitives.
- Appearance remains the only theme authority. Semantic component tokens map to
  its existing surface, text, border, light/dark brand and width settings.
- Place portalled dialogs, sheets and menus within the existing theme ancestor.
  This preserves account accents and system mode without another theme provider.
- Preserve reduced motion, visible focus, accessible names, error announcements,
  pending-state duplicate guards and keyboard/focus behavior.

## Console wrappers added for the tenant layout refresh (2026-10-15)

Composed from the shared primitives in `src/app/platform/(console)/_components/`
(details and rationale in `tenant-management.md`):

- `RevealToggle`: the one eye button ("Show <noun>" / "Hide <noun>",
  `aria-pressed`, `aria-controls`). `PasswordInput` now uses it (same markup
  and names as before, e.g. "Show password").
- `SensitiveInput`: `type="text"` input masked with `-webkit-text-security`
  until revealed; for usernames and database identifiers (never a password
  field, so password managers ignore it).
- `SensitiveValue`: read-only fixed-length mask with reveal and optional Copy.
- `ModeSwitch`: segmented "Auto-Generate | Manual" Radix radio group.
- `FormSection`: now `icon` (tinted tile) instead of a number badge, plus an
  `action` slot in the header. Only the tenant forms use it.
- `FormActions` + `RequiredLegend`: sticky bottom action bar for long forms.
- `PageHeader`: back link, eyebrow, h1, description and actions.

## Current status and verification

2026-10-15: Migrated authentication, dashboard, all tenant screens, Appearance,
navigation, confirmation/account/row overlays, feedback, empty and loading states.
The old custom control class module was removed; wrappers compose shared
primitives. Hidden native file pickers remain behind upload buttons and previews.
Registration, recovery and customer dashboards are not implemented and remain
outside this migration. No business services, actions, schemas or permissions
were changed.

The original combined suite passed all 1,062 tests, with one existing skip.
After review fixes, all 11 UI contract tests passed (including the new password
spacing regression), and lint, TypeScript and the production build passed.
HTTP coverage verifies native login/logout, protected routes, persistence, all
content widths and account-bound Appearance feedback. The Docker lockfile also
passes a clean-install dry run. Review fixes protect password-toggle padding,
long-domain wrapping and focus restoration after modal closure. Reduced motion
is supported by primitives and CSS.

Actual browser verification was not performed. Browser Use denied localhost:3100
through its saved-permission/managed-policy gate. The user explicitly instructed
"skip browser verification" on 2026-10-15, replacing the earlier requirement to
hold integration for rendered checks. No alternate browser or automation surface
was used. Implementation and automated verification are complete; Git integration
follows the mandatory task-branch/worktree workflow. Browser-only visual,
responsive and interactive results are not claimed.

The isolated preview used disposable accounts and tenant fixtures in
music_distribution_shadcn_preview_test. Cleanup removes only this task's preview
container and scratch database, preserving existing account and tenant data.

## Sources

Official installation: https://ui.shadcn.com/docs/installation/next
Official tokens: https://ui.shadcn.com/docs/theming
Official registry source: https://github.com/shadcn-ui/ui

## Component maintenance

The official new-york Radix registry supplies source-owned components. New
components should use the existing `cn` utility, semantic tokens and
ThemePortalProvider; do not introduce a separate theme selector or storage.
`primary` is the configured brand and `accent` is the neutral interaction surface.
Legacy surface/text aliases continue to reference the same palette. Status colors
are centralized semantic tokens. Miniature Appearance artwork intentionally
illustrates multiple draft palettes rather than inheriting the active mode.

## Change history

- 2026-10-15: Added official shadcn source/config, semantic tokens and themed portals.
- 2026-10-15: Migrated existing interfaces and retained native form/ARIA contracts.
- 2026-10-15: Removed obsolete custom control styling and repaired integration
  review findings. Automated verification passed; browser access was blocked.

- 2026-10-15: User explicitly waived browser verification and requested completion
  using the passing automated checks; no rendered-browser results are claimed.
- 2026-10-15: Added RevealToggle, SensitiveInput, SensitiveValue, ModeSwitch,
  FormActions/RequiredLegend and PageHeader; FormSection takes an icon and an
  action slot; PasswordInput reuses RevealToggle (no behaviour change). Lint,
  types and the full suite pass; rendered in the in-app browser.

## Shared components for the CLAUDE.md compliance pass (requested 2026-10-15)

- `SectionedLayout` + `SecondaryMenu` (`_components/secondary-menu.tsx`): the one
  secondary-menu implementation. Props: the page's sections (`id`, `label`,
  optional icon) and `variant` ("sidebar": sticky vertical menu beside the
  content from lg, horizontal above it below lg; "top": sticky horizontal menu
  at every width, for wide tables). It finds the scroll container (the console's
  `<main>`), highlights the last section whose heading passed the top offset
  (the last one once scrolled to the bottom), scrolls smoothly on click (instant
  with reduced motion) and keeps the clicked item active until the scroll ends.
  A MutationObserver hides items whose section is not in the DOM, so sections
  can be added, removed, expanded or collapsed. Sections use
  `SECTION_SCROLL_MARGIN` so their headings land below the sticky menu.
- `CountDetails` (`_components/count-details.tsx`): turns a figure into a button
  that opens a dialog with the calculation and the supporting records
  (rendered only while open, so lists load on demand).
- `EmptyState` (`_components/empty-state.tsx`): illustration (icon tile with
  decorative rings), heading, description and optional action.
- `SensitiveValue` gains `monospace` (default true) so emails and phones can
  use the regular font.
- `StatCard` gains an optional `details` slot: the figure opens it.

### Change history

- 2026-10-15: Recorded the shared secondary menu, count details and empty
  state components required by CLAUDE.md.
- 2026-10-15: Implemented SectionedLayout/SecondaryMenu, CountDetails,
  EmptyState, StatCard details, SensitiveValue `monospace` (now inline-flex so
  it fits inside sentences), FormSection `id`, AuthPageGuard, masked
  ProfileMenu. Shared helpers added to remove duplicated logic:
  `src/lib/with-timeout.ts` (Redis limiters, DNS checks and the readiness
  route used three copies) and `src/lib/uuid.ts` (`UUID_PATTERN`, `isUuid`,
  previously copied into nine files). UI contract tests added in
  tests/console-ui.test.ts.
- 2026-10-15: Code-quality pass (CLAUDE.md): every function in this module's
  frontend and backend files now has the full doc block (Description, Input,
  Output, Use case, Author, Created, Last modified; "Created: X. Last modified:
  Y." one-liners split into two lines); consecutive single-line const/let
  declarations have their "=" vertically aligned (typed and untyped
  declarations are aligned in separate groups).
- 2026-10-15: Verification of the compliance pass: TypeScript (including tests)
  and ESLint (zero warnings) pass; the full Vitest suite passes in the app
  container: 37 files, 1136 tests, 1 pre-existing localhost-only skip.

## Tenant portal additions (requested 2026-10-15)

- `src/components/ui/sidebar.tsx`: the official shadcn (new-york-v4) Sidebar
  primitive, adapted to this project (doc blocks, `@/lib/utils`, configurable
  state-cookie name/path so each area keeps its own sidebar preference,
  deterministic skeleton width for the React-compiler lint).
- `src/hooks/use-mobile.ts`: `useIsMobile()` on `useSyncExternalStore`.
- Sidebar tokens (`--sidebar`, `--sidebar-foreground`, `--sidebar-primary`,
  `--sidebar-accent`, `--sidebar-border`, `--sidebar-ring`, …) mapped to the
  existing semantic palette in light and dark; `.workspace-theme` gets the
  same base tokens as `.platform-theme`.
- `src/components/dashboard/*`: the dashboard-01 block (AppSidebar, NavMain,
  NavSecondary, NavUser, SiteHeader, section card, chart/table card shells)
  as data-driven presentational components. Each role area passes its own
  navigation, user, sign-out action and links; no auth or data access lives
  in these components.
- `src/components/shared/index.ts`: the explicit list of existing
  presentational wrappers the tenant/customer areas reuse (SectionedLayout,
  CountDetails, EmptyState, SensitiveValue/Input, PasswordInput,
  ConfirmDialog, Field, Notice, AuthPageGuard). CLAUDE.md requires a single
  implementation of each; they hold no auth, session or data logic.

### Change history

- 2026-10-15: Recorded the shadcn Sidebar, use-mobile hook, sidebar tokens,
  dashboard block components and the shared-wrapper barrel before implementation.

- 2026-10-16: Implemented as recorded above. Verified: TypeScript, ESLint (0 warnings), full Vitest suite 40 files / 1174 tests passed (new: workspace-rules, workspace-portal with two real provisioned tenants, workspace-http). Browser-verified on a test tenant created in the Platform Owner panel: welcome, login (errors, wrong password, admin by username/email), tenant dashboard, dark theme switch persisting after reload, customer sign-up (validation, pending login blocked), tenant-admin approval, logout + Back, customer dashboard, customer blocked from /tenant, Platform Owner registrations page (count popup, reject with reason), rejected login -> status page -> review request, Platform Owner suspension ending the active session. Not browser-verified yet: "Apply to everyone" appearance, phone/tablet layouts.

## RBAC shared UI (requested 2026-10-16)

Purely presentational building blocks for the role/sub-user screens of all
three panels (`role-privilege-management.md`, "UI specs (approved
2026-10-16)"). Pages pass serializable data and bound Server Actions as props;
nothing here reads a session, a database or `server-only` code.

- **Primitives** (`src/components/ui/`, official new-york sources adapted):
  `checkbox.tsx` (Radix Checkbox, `checked="indeterminate"` shows a minus),
  `collapsible.tsx` (Radix Collapsible root/trigger/content), `popover.tsx`
  (Radix Popover; the portal renders inside the theme ancestor from
  `useThemePortal()`, like dialog/dropdown, so accents and dark mode apply).
- **`SearchableSelect`** (`src/components/shared/searchable-select.tsx`,
  exported from `@/components/shared`): single-value combobox. A button
  trigger (`role="combobox"`, `aria-expanded`, `aria-controls`) opens a Popover
  with a search input and a `role="listbox"` of `role="option"` rows
  (`aria-selected`, `aria-disabled`, active row via `aria-activedescendant`).
  Keyboard: ArrowUp/Down, Home/End, Enter, Escape, typing filters; focus goes
  back to the trigger on close. A hidden input (`name`) submits exactly ONE
  value. `loading` shows "Loading…" and keeps it disabled; `invalid` and
  `aria-describedby` wire it to `Field` errors. Options carry `label`,
  `description`, `meta` (right-aligned text) and `badge`.
- **Client-safe rules**: `src/lib/authz/role-rules.ts` (role name,
  description and status rules, `isReservedRoleName` over the catalog's
  `MASTER_ROLE_NAMES`, `dependentsOf`, `clearDependents`, `toggleSelection`
  which adds the catalog's `dependencyClosure` limited to assignable keys —
  nothing of the catalog is duplicated) and
  `src/lib/authz/sub-user-rules.ts` (sub-user fields composed from the
  existing tenant/workspace rules). Server code reuses both.
- **`src/components/rbac/`** (one implementation for Platform, Tenant and
  Customer): `types.ts` (view + form-state types), `role-badges.tsx`
  (RoleStatusBadge, SystemRoleBadge, MasterBadge, AboveAuthorityBadge,
  UserStatusBadge, PrimaryBadge, SelfBadge), `privilege-list.tsx` (read-only,
  grouped; marks module-disabled privileges), `role-picker.tsx` (exactly one
  role, `name="roleId"`), `role-editor.tsx` (create/edit), `role-dialogs.tsx`
  (disable/enable with affected users; delete with required replacement),
  `rbac-toolbar.tsx` (search + status + optional role filter in the URL),
  `list-href.ts` (`parseRbacListQuery`, `rbacListHref`, `hasRbacFilters`,
  page size 20), `roles-directory.tsx`, `sub-users-directory.tsx` (table
  from xl, cards below, masked username/email, clickable counts, built-in row
  actions with a per-row override slot `rowActions`, paging, empty states),
  `row-actions.tsx` (RoleRowActions, SubUserRowActions; status buttons call
  `toggleStatusAction(id, next)` with the INTENDED change computed from the
  row's shown status — roles `"disabled"` / `"active"` (via
  `RoleStatusDialog`, whose `onConfirm(roleId, next)` computes it), users
  `"suspend"` / `"reactivate"` (`UserStatusChange` in `types.ts`); the
  services refuse a stale change, so no client wrappers or bound intent maps
  are needed),
  `assigned-users.tsx` (AssignedUsersTable, AffectedUsersPreview),
  `rbac-records.tsx` (paged count-popup records loaded through bound Server
  Actions), `directory-parts.tsx` (paging), `rbac-summary.tsx` (RolesSummary,
  SubUsersSummary: StatCards with CountDetails) and `sub-user-form.tsx`
  (variants platform/tenant/customer, modes create/edit).
- **`src/components/rbac/screens/`** (the page layer shared by all three
  panels; server components except `role-details-actions.tsx`):
  `roles-screens.tsx` (RolesListScreen, RoleDetailsScreen, RoleEditorScreen),
  `sub-users-screens.tsx` (SubUsersListScreen, SubUserFormScreen),
  `screen-parts.tsx` (ScreenFrame, DeniedScreen, ActorFallback, LoadFailed,
  DetailRow), `role-details-actions.tsx`, `notices.ts` (fixed `?notice=`
  codes), `skeletons.tsx` (RbacListSkeleton, RbacFormSkeleton; take the
  panel's `gutterClassName`) and `types.ts` (panel bindings: paths, texts,
  gutters, the server page guard `pageActor`, bound Server Actions). They
  never import a panel guard, session or action; each panel's
  `rbac-bindings.ts` supplies them (details: `role-privilege-management.md`,
  "RBAC pages (all panels)").
- Panels pass only serializable data and bound Server Actions; record popups
  take `(filter, page)` / `(roleId, page)` loaders (never closures built on
  the server). Success messages of row actions show above the list and only
  `router.refresh()` runs (no full reload).
- `@/components/shared` now also re-exports FormSection, FormActions,
  RequiredLegend, Icon, PageHeader, StatCard (+ StatCardDetails), ToneBadge
  and Spinner (already reviewed presentational console wrappers).

### Change history

- 2026-10-16: Recorded the RBAC shared UI before implementation.
- 2026-10-16: Implemented as recorded. Verified in the rbac container:
  TypeScript (no errors in these files), ESLint 0 warnings on every new file,
  `tests/role-rules.test.ts` (16) and `tests/rbac-ui.test.ts` (12) pass;
  console-ui, workspace-rules and tenant-rules suites still pass. Not
  browser-verified yet (pages are built by later tasks).
- 2026-10-16: Shared screen layer `src/components/rbac/screens/` added (moved
  from the workspace `_rbac/` folder, now used by the Platform panel too);
  row actions / RoleStatusDialog / directories pass the intended status
  (`toggleStatusAction(id, next)`) instead of a bare id.

## RBAC shared components (2026-10-16)

- `AccessDenied` (`src/components/shared/access-denied.tsx`): the shared
  EmptyState with "You don't have access to this page", a short explanation
  and "Go to dashboard" (`homeHref`; optional `title` / `description`).
  Rendered inline by protected pages (HTTP 200). Same file:
  `NoActiveRoleNotice`, `NO_ACTIVE_ROLE_LABEL`, `NO_ACTIVE_ROLE_NOTICE`.
- `PermissionSync` (`src/components/shared/permission-sync.tsx`, client):
  `{ initialFingerprint, check }`; checks every 30 s while visible, on focus /
  visibilitychange and route change, never overlapping, silent on errors;
  `router.refresh()` when signed out or the fingerprint changed.
- Both exported from `src/components/shared/index.ts`; dashboard icon
  `shield-check` added to `src/components/dashboard/icons.tsx`.
- Change history: 2026-10-16 — added for RBAC enforcement.

## Customers module additions (2026-10-17)

- `AccountTypeField` (`src/components/shared/account-type-field.tsx`, exported
  from `@/components/shared`): the required Artist / Label / White Label
  card-style radio choice with asterisk, error text and ARIA wiring. Used by
  the tenant "Add customer" form; the sign-up and Sub-Customer forms still
  have their own inline copies (candidates to adopt it later).
- `PagedRecords` (`src/components/rbac/rbac-records.tsx`) is now exported so
  other popups (customers) reuse the same loading / error / empty / paging shell.
- `CountDetails` fix: the records now sit in a `min-w-0` wrapper. The dialog is
  a CSS grid, so a wide records table used to stretch the grid column past the
  dialog (clipped table and calculation text, the whole dialog scrolling
  sideways — seen in the Sub-Tenants popup too, 714px content in a 670px
  dialog at a 1024px viewport). Now the records' own `overflow-x-auto` box
  scrolls instead. Browser-checked 2026-10-17 on the tenant dashboard
  "Active customers" popup.
- Known (pre-existing, not changed): the top variant of `SectionedLayout`
  (sticky `-mx-4` menu bar) makes tenant list pages 4px wider than the
  viewport at 1024px (Registrations, Sub-Tenants and Customers alike); no
  overflow at 375px or 768px.
- Change history: 2026-10-17 — AccountTypeField, exported PagedRecords,
  CountDetails min-w-0 fix.


## RBAC audit update (2026-10-17)

- `SearchableSelect` accepts an optional `loadOptions(search, page)` callback
  for bounded server searches. It debounces typing, ignores obsolete replies,
  shows loading/retry/illustrated empty states, and pages with Previous/Next.
  Existing static selects retain local matching. Only the selected option is
  retained across remote pages; full datasets are never accumulated in the
  browser. `RolePicker` and the RBAC toolbar use this mode for all three panels.
