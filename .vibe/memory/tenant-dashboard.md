# Tenant Dashboard (tenant staff area, `/tenant/...`)

## Overview

- **Name:** Tenant dashboard — the signed-in tenant administrator's area.
- **Purpose:** a professional music-distribution workspace for the tenant's
  own staff, separate from the Platform Owner console and from customers.
- **Status:** implemented 2026-10-15 (first version; business modules are
  static placeholders).

## Decisions confirmed with the owner (2026-10-15)

- Built from scratch on shadcn/ui using the official **dashboard-01** block
  as the exact layout reference (inset sidebar, site header with sidebar
  trigger, four section cards, chart card, table card). Nothing from the
  Platform Owner console shell is reused.
- No fake data: cards show real figures (with details popups) or honest
  "not available yet" states; the chart card shows an empty state until real
  analytics exist; the table shows real recent registrations.
- All URLs under `/tenant/...`.

## Navigation

- Main: Dashboard, Releases, Artists, Labels, Customers, Distribution,
  Analytics, Royalties (placeholders except Dashboard), Registrations
  (owner only, real).
- Secondary: Appearance (`/tenant/settings/appearance`).
- Footer: account menu (name, masked username/email with eye toggle,
  Appearance, Log out).
- Header: sidebar trigger, page title, theme quick switch (Light / Dark /
  System, saves the personal preference) and a link to Appearance.
- Mobile: the shadcn sidebar becomes a Sheet (off-canvas) below 768px.

## Dashboard page

- Welcome heading with the tenant name.
- Cards: Pending approvals (count → popup with the exact pending requests),
  Active customers (count → popup with the exact accounts), Releases and
  Royalties ("Not available yet" — modules not built).
- Chart card "Distribution activity": empty state (no data source yet).
- Table card "Recent registrations": latest 5 real registrations with status,
  link to the Registrations page; empty state when there are none.
- Top secondary menu (Overview, Activity, Recent registrations) with
  scroll-spy (shared SectionedLayout).

## Security

- `src/app/tenant/layout.tsx` and every page/action call `requireTenantUser()`
  (tenant gate + `md_tenant_session` + area `tenant` + active staff user).
- Owner-only pages/actions additionally check the `owner` role on the server.
- Customers can never reach `/tenant/**`: their cookie is path-scoped to
  `/customer` and their session area is `customer`.

## Dependencies

- `workspace-auth.md` (guards/sessions), `customer-registration.md`
  (registrations), `workspace-appearance.md` (theme), `ui-components.md`
  (shadcn sidebar, dashboard block components).

## Change history

- 2026-10-15: Module created — owner decisions recorded before implementation.

- 2026-10-16: Implemented as recorded above. Verified: TypeScript, ESLint (0 warnings), full Vitest suite 40 files / 1174 tests passed (new: workspace-rules, workspace-portal with two real provisioned tenants, workspace-http). Browser-verified on a test tenant created in the Platform Owner panel: welcome, login (errors, wrong password, admin by username/email), tenant dashboard, dark theme switch persisting after reload, customer sign-up (validation, pending login blocked), tenant-admin approval, logout + Back, customer dashboard, customer blocked from /tenant, Platform Owner registrations page (count popup, reject with reason), rejected login -> status page -> review request, Platform Owner suspension ending the active session. Not browser-verified yet: "Apply to everyone" appearance, phone/tablet layouts.
