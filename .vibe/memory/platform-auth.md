# Platform Authentication

## Overview and requested change

The platform login page authenticates existing Platform Owners. The 2026-10-15
UI migration replaces its controls, feedback and form surface with the shared
shadcn/ui Button, Input, Label, Alert and Card components. The existing persisted
Appearance provider supplies the signed-out platform default and all semantic
tokens. No registration or recovery module exists; this change does not invent
those flows. The migration is implemented on codex/shadcn-pages-appearance;
bounded TypeScript, lint and Git diff checks passed. Combined authentication
tests and rendered verification remain with the parent integration task.

## User flow, validation and security

A signed-in owner visiting login is redirected to the dashboard. The form posts
the existing loginAction through useActionState, including native Server Action
markup for progressive enhancement. Username and password names, autocomplete,
server-derived length limits, field refs, username preservation and first-error
focus remain intact. Password values never enter returned state. A visibility
toggle changes only the input type and never its value. Pending submission blocks
duplicates and displays signing-in feedback.

The action derives client IP, delegates validation, rate limiting, authentication
and password checks to the existing platform-auth helpers, revokes a preceding
browser session where possible, sets the cookie with existing security options
and redirects to a fixed dashboard path. Errors remain friendly and are shown
next to their field or through an accessible form-level alert. No authentication,
cookie, permission, password, database or action logic is changed by migration.

## Dependencies and edge cases

The server login page reads maximum lengths from existing server-only helpers.
The client form receives only those numeric limits. Layout fallback permits
sign-in during a global-appearance read outage. Native field refs must continue
to reference the actual input element when using the shared components.
The client form now reuses the shared PasswordInput wrapper rather than keeping
a second implementation of visibility controls. Its ref, ID, validation and
autocomplete props still reach the native input.

## Change history

- 2026-10-15: Recorded the bounded shadcn/ui login migration and preservation
  requirements before implementation.
- 2026-10-15: Completed the login Card, Input, Label, Alert and Button migration;
  preserved native Server Action posting, pending feedback and error focus.

## Integrated verification

The combined regression suite passed 1,062 tests with one existing skip,
including protected HTTP/Server Action behavior. All 11 final shared UI contract
tests passed after review fixes; lint, TypeScript and production build passed.
On 2026-10-15 the user explicitly waived browser verification after the browser
permission gate prevented access. No rendered-browser results are claimed.

## CLAUDE.md compliance audit (requested 2026-10-15)

### Requirement

The owner asked that login (frontend and backend) follow every CLAUDE.md rule.
The audit found: no client-side validation before the Server Action ran, the
username shown in plain text, no protection against a back/forward-cache restore
of a protected page after logout, and functions without the mandatory doc block
(description, input, output, use case, author, created and modified dates).

### Decisions and behaviour after this change

- Frontend validation (pure helper `src/app/platform/login/login-model.ts`):
  username is required, trimmed (on blur and before submit) and must be
  3–64 characters; whitespace-only input is rejected. Password is required and
  whitespace-only input is rejected; a password is never trimmed or altered.
  Fields validate on blur and again while typing once they show an error. On
  submit with errors the request is not sent; the first invalid field is
  scrolled into view and focused. The server still validates everything.
- The username character pattern is deliberately NOT checked on the client:
  the existing security design never reveals the format rules on the login
  page (a malformed name is reported like any wrong credential).
- Backend: a whitespace-only password now returns the "Enter your password."
  field error instead of running a password verification.
- Masking: the username input is a `SensitiveInput` (masked with CSS until the
  eye button reveals it; `autoComplete="username"` keeps password managers working).
- Back button after logout: protected console pages are dynamic (no-store), the
  logout Server Action deletes the cookie (which clears the Next.js router
  cache) and redirects to login. A new `AuthPageGuard` in the console layout
  reloads any page restored from the browser back/forward cache, so the server
  re-checks the session and redirects a signed-out visitor to login.
- Every function in the login page/form/actions, `src/app/platform/actions.ts`,
  the platform layout and `src/lib/platform-auth/*` has the full doc block.

### Change history

- 2026-10-15: Recorded the CLAUDE.md compliance requirements for login
  (client validation, masked username, back/forward-cache guard, doc blocks).
- 2026-10-15: Implemented: `login-model.ts` (pure client validation), masked
  username (`SensitiveInput` with autoComplete="username"), blur/typing/submit
  validation with scroll-and-focus on the first invalid field, server rejects a
  whitespace-only password as "Enter your password." (no attempt counted),
  logout logs "[platform-auth] logout succeeded", `AuthPageGuard` in the
  console layout. Protected pages answer `Cache-Control: no-store` and a
  signed-out request redirects (307) to /platform/login (checked with curl).
- 2026-10-15: Code-quality pass (CLAUDE.md): every function in this module's
  frontend and backend files now has the full doc block (Description, Input,
  Output, Use case, Author, Created, Last modified; "Created: X. Last modified:
  Y." one-liners split into two lines); consecutive single-line const/let
  declarations have their "=" vertically aligned (typed and untyped
  declarations are aligned in separate groups).

### Edge cases

- An owner whose password consists only of spaces (the seed allows 12+ of any
  characters) can no longer sign in; rotate it with `make db-rotate-owner-password`.
- 2026-10-15: Verification of the compliance pass: TypeScript (including tests)
  and ESLint (zero warnings) pass; the full Vitest suite passes in the app
  container: 37 files, 1136 tests, 1 pre-existing localhost-only skip.

## RBAC foundation (2026-10-16)

- Every platform owner holds exactly one role (`platform_owners.role_id`, NOT
  NULL, RESTRICT). The seed bootstrap creates the first owner as the primary
  account (`is_primary`) with the Master Platform role (found by system key);
  `--rotate-password` is unchanged and never touches role or primary flag.
- `requirePlatformOwner()` stays the session-only guard. New guards in
  `src/lib/authz/platform.ts`: `getPlatformAccess()`, `requirePlatformAccess()`,
  `authorizePlatformAction(permission, { ipAddress })` (privileges read fresh
  per request; refusals audited as `authz.denied`). Later tasks move the
  console pages and actions to them (role-privilege-management.md).

### Change history

- 2026-10-16: Seed bootstrap assigns Master Platform + primary; the rbac
  migration mapped existing owners (oldest active → primary master, others →
  legacy custom roles with only their previous capabilities).

## Audit remediation requested 2026-10-17 (AUD-014)

Platform sign-in/out must use the shared structured authentication writer with UTC, generated request correlation, trusted last-hop IP, platform scope, outcome, verified actor IDs or a domain-separated HMAC pseudonymous submitted identifier. Credentials, tokens and raw submitted names are excluded. Logging is best effort and cannot prevent authentication/logout.

## Completion and verification — 2026-10-18

AUD-014 implemented through shared UTC JSON auth events and current request context. Failed and successful attempts share a domain-separated tenant-scoped HMAC pseudonym, stable across replicas using the same tenantSecretsKey; only verified database actor IDs appear. Platform logout attributes before revocation without allowing attribution errors to skip revocation. Targeted login regressions, TypeScript, ESLint and production build passed.
