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
