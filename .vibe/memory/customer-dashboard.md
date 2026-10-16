# Customer Dashboard (customer area, `/customer/...`)

## Overview

- **Name:** Customer dashboard — the signed-in customer's own area (artist,
  label or white-label account approved by the tenant).
- **Purpose:** give approved customers a professional home in the tenant's
  portal, completely separate from the tenant staff area.
- **Status:** implemented 2026-10-15 (first version; modules are static
  placeholders).

## Decisions confirmed with the owner (2026-10-15)

- Separate area under `/customer/...` with its own layout, navigation,
  cookie (`md_customer_session`, path `/customer`) and guard.
- Same shadcn dashboard-01 layout as the tenant area, no fake data.
- Public customer pages: `/customer/signup` (sign-up) and
  `/customer/registration` (rejected applicant status + review request).

## Navigation

- Main: Dashboard, My Releases, Artists, Labels, Royalties, Payouts
  (placeholders except Dashboard).
- Secondary: Appearance (`/customer/settings/appearance`, personal only).
- Footer account menu with masked username/email, Appearance and Log out.

## Dashboard page

- Welcome heading with the customer's name and the tenant's name.
- Cards (no counts, so no popups): Account status, Account type, Member
  since, Workspace.
- Chart card "Streams overview": empty state. Table card "My releases":
  empty state (release module not built).

## Security

- Every page and action calls `requireCustomer()` (tenant gate +
  `md_customer_session` + area `customer` + active user + active customer).
- Customers cannot reach `/tenant/**` or the registration approval actions.

## Change history

- 2026-10-15: Module created — owner decisions recorded before implementation.

- 2026-10-16: Implemented as recorded above. Verified: TypeScript, ESLint (0 warnings), full Vitest suite 40 files / 1174 tests passed (new: workspace-rules, workspace-portal with two real provisioned tenants, workspace-http). Browser-verified on a test tenant created in the Platform Owner panel: welcome, login (errors, wrong password, admin by username/email), tenant dashboard, dark theme switch persisting after reload, customer sign-up (validation, pending login blocked), tenant-admin approval, logout + Back, customer dashboard, customer blocked from /tenant, Platform Owner registrations page (count popup, reject with reason), rejected login -> status page -> review request, Platform Owner suspension ending the active session. Not browser-verified yet: "Apply to everyone" appearance, phone/tablet layouts.
