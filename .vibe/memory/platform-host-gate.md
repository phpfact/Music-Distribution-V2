# Platform Host Gate

## Overview and requested change

The root route resolves the request Host header to the platform or a known
tenant. The 2026-10-15 migration replaces its presentation with shared shadcn/ui
Card, Badge and Button components and semantic theme tokens. The migration is
implemented on codex/shadcn-pages-appearance; TypeScript, lint and Git diff checks
passed. The parent task owns combined host-gate tests and rendered verification.

## Flow and constraints

The platform host shows the infrastructure start page and ordinary anchor links
to the liveness and readiness JSON APIs. The tenant host goes through the existing
domain resolver and displays an allowed, suspended or provisioning notice. The
tenant portal is not implemented yet. Unknown domains remain not found. Host
resolution and tenant business logic remain untouched; this route does not
invent a customer dashboard or add authentication or persistence behavior.

## UI and dependencies

The start-page health links remain native anchors because they are JSON APIs,
with the shared Button's asChild composition. The tenant notice uses Card and
accessible status semantics, with the existing message preserved. Platform
Appearance is scoped to /platform; the root gate consumes the shared default
semantic tokens and does not fetch or duplicate account theme state.

## Change history

- 2026-10-15: Recorded the bounded host-gate shadcn/ui presentation migration
  before implementation.
- 2026-10-15: Completed the shared Card, Badge and Button migration, including
  stacked health links on narrow screens and unchanged tenant access messages.

## Integrated verification

The combined regression suite passed 1,062 tests with one existing skip,
including protected HTTP/Server Action behavior. All 11 final shared UI contract
tests passed after review fixes; lint, TypeScript and production build passed.
On 2026-10-15 the user explicitly waived browser verification after the browser
permission gate prevented access. No rendered-browser results are claimed.

## Tenant welcome page and portal routing (requested 2026-10-15)

### Requirement

Every tenant subdomain / verified custom domain shows a welcome page for that
tenant (its real name, a professional welcome message, "Log in" → `/login`,
"Sign up" → `/customer/signup`), instead of the old "portal isn't available
yet" notice. Unknown hosts get a friendly not-found page; suspended or
unfinished tenants keep a friendly unavailable notice. The owner chose one
shared login form for tenant staff and customers (`workspace-auth.md`).

### Decisions

- The root route keeps resolving the Host header with `resolveHost` /
  `tenantAccessOf`; only an `allowed` tenant gets the welcome page, rendered
  in the tenant's workspace default appearance (`workspace-appearance.md`).
- A new root `not-found.tsx` replaces Next's default 404 text with a friendly
  page (status stays 404). Its wording is generic, so it is correct for every
  missing route and never names or hints at another tenant.
- The proxy now also matches `/login`, `/tenant/**` and `/customer/**` and
  answers 404 for them on the platform host (mirror of `/platform/**` on
  tenant hosts). Pure Host-header logic as before.

### Change history

- 2026-10-15: Recorded the tenant welcome page, friendly not-found page and
  the proxy rules for the tenant portal routes before implementation.

- 2026-10-16: Implemented as recorded above. Verified: TypeScript, ESLint (0 warnings), full Vitest suite 40 files / 1174 tests passed (new: workspace-rules, workspace-portal with two real provisioned tenants, workspace-http). Browser-verified on a test tenant created in the Platform Owner panel: welcome, login (errors, wrong password, admin by username/email), tenant dashboard, dark theme switch persisting after reload, customer sign-up (validation, pending login blocked), tenant-admin approval, logout + Back, customer dashboard, customer blocked from /tenant, Platform Owner registrations page (count popup, reject with reason), rejected login -> status page -> review request, Platform Owner suspension ending the active session. Not browser-verified yet: "Apply to everyone" appearance, phone/tablet layouts.
