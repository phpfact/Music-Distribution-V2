# Workspace Appearance (tenant and customer theme)

## Overview

- **Name:** Workspace appearance — theme, accent colour and content width for
  everything served on a tenant's domain.
- **Purpose:** each user saves a personal appearance; the tenant
  administrator sets the workspace default for all of the tenant's own users
  (sub-admins, customers, sub-customers) and for the public pages.
- **Status:** implemented 2026-10-15 (first version).

## Decisions confirmed with the owner (2026-10-15)

- Built from scratch for tenants (no reuse of the Platform Owner appearance
  code); same capability as the platform: personal override → workspace
  default → application default (Light / Neutral / Default width).
- The workspace default applies to all public pages (welcome, login, sign-up,
  registration status and any future forgot-password / 2FA page).
- The tenant administrator can change the workspace default only for their
  own tenant; nothing here can touch another tenant or the Platform Owner.

## Business rules

- Options: Theme Light / Dark / System; Accent Neutral, Emerald, Indigo,
  Violet, Blue, Rose, Amber; Width Default (96rem), Full, Focused (72rem).
- Tenant owner: Apply to me, Apply to all (saves the workspace default and
  updates the owner's existing personal override, other users' overrides
  stay), Reset me (remove my override), Reset all (workspace default back to
  the application default; overrides stay).
- Customers and non-owner staff: Apply to me / Reset to workspace default.
- Header quick switch: Light / Dark / System saves the personal theme while
  keeping the current accent and width.
- Draft choices do not change the page until saved; Discard asks for
  confirmation; a save refreshes the server-rendered theme (no full reload).
- Invalid stored values fall back to the next level (never a broken theme).

## Database (tenant database, migration `*_tenant_portal`)

- Enums `appearance_theme`, `appearance_accent`, `appearance_width`.
- `workspace_appearance`: singleton (id 'workspace', CHECK), theme, accent,
  width, updated_at.
- `user_appearances`: user_id (PK, → users ON DELETE CASCADE), theme, accent,
  width, updated_at.

## UI behavior

- Server-rendered theme class on the area's root element (no theme flash);
  System follows the OS via CSS before hydration.
- Dialogs, menus and sheets portal into the themed root
  (`ThemePortalProvider`), so overlays match.
- Settings page (`/tenant/settings/appearance`, `/customer/settings/appearance`):
  sections Currently saved, Accent color, Interface theme, Content width,
  Preview with the shared secondary menu.

## Security

- Writes require the area's session (checked in the action and again inside
  the transaction); workspace-wide changes require the tenant `owner` role.
- Inputs are validated against the exact option lists; no arbitrary CSS.
- Audit: `workspace_appearance.applied` / `.reset` in the control plane.

## Change history

- 2026-10-15: Module created — owner decisions recorded before implementation.

- 2026-10-16: Implemented as recorded above. Verified: TypeScript, ESLint (0 warnings), full Vitest suite 40 files / 1174 tests passed (new: workspace-rules, workspace-portal with two real provisioned tenants, workspace-http). Browser-verified on a test tenant created in the Platform Owner panel: welcome, login (errors, wrong password, admin by username/email), tenant dashboard, dark theme switch persisting after reload, customer sign-up (validation, pending login blocked), tenant-admin approval, logout + Back, customer dashboard, customer blocked from /tenant, Platform Owner registrations page (count popup, reject with reason), rejected login -> status page -> review request, Platform Owner suspension ending the active session. Not browser-verified yet: "Apply to everyone" appearance, phone/tablet layouts.
- 2026-10-16: Browser follow-up checks. "Apply selection to everyone" saved the workspace default (Dark + Emerald) and the public /login page of that tenant switched to it at once, while another tenant (mr-arun) stayed Light / Neutral. Phone (375x812) and tablet (768x1024): welcome, sign-up, login, tenant dashboard, mobile sidebar Sheet (closes on navigation), registrations and appearance pages show no horizontal page overflow. Fixes from these checks: the registrations list shows cards below xl (the table hid Status/Actions behind horizontal scroll next to the sidebar on tablets); the reviewer note reads "Approved by …" so a later suspension is not attributed to the approver.

## RBAC enforcement (2026-10-16)

- `AppearanceViewer.isOwner` → `canManageWorkspace`, computed from
  `area.authz.can("tenant.appearance.manage_workspace")` (always false for
  customers). The tenant layout and Appearance page use it.
- `saveTenantAppearanceAction` with scope `workspace` first calls
  `authorizeTenantAction("tenant.appearance.manage_workspace")` (audited
  refusal); `saveViewerAppearance` still refuses the scope without the flag
  ("You do not have permission to change the appearance for everyone.").
  Personal appearance stays available to every signed-in user.
- Change history: 2026-10-16 — owner flag replaced by the privilege.

## Audit remediation requested 2026-10-17 (AUD-012 / AUD-017)

Refreshed authoritative appearance state must replace the saved baseline while
preserving individually edited draft fields. Untouched fields follow the newest
server state; overlapping external/draft edits are explicitly shown to the user
before a save can overwrite them. Header and settings continue using the same
server state and no full reload. Appearance audit actor kind comes from the
verified, active user row locked by the save transaction (`customer_id`), never
from submitted preferences or an untrusted actor flag.

## Completion and verification — 2026-10-18

AUD-012 and AUD-017 implemented. Untouched draft fields follow refreshed saved state, intentional edits survive, and overlapping conflicts block apply until explicitly resolved; repeated identical refreshes preserve unresolved conflicts. Customer/staff appearance audit kinds derive from the active locked database user. Pure reconciliation tests and real-database audit actor assertions passed; TypeScript, ESLint and production build passed.
