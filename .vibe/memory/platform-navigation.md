# Platform navigation

## Overview

The authenticated platform console shares a responsive navigation shell, account menu, and interactive confirmation and field controls. The sidebar and topbar read the existing navigation registry; authentication, account settings, tenant actions, and the sidebar preference cookie remain owned by their existing modules.

## Requested change — 2026-10-15

Migrate these shared interfaces to the project's source-owned shadcn/ui primitives. Use Sheet for the mobile navigation, DropdownMenu for the account menu, Dialog for the existing confirmation wrapper, and Button, Input, Textarea, Avatar, Tooltip, Separator, and Breadcrumb where appropriate. Keep the saved Appearance provider authoritative and let the shared portal container preserve the active theme and accent in overlays.

## Implemented UI

- The mobile drawer now uses the shared Sheet and closes on route changes, close button, Escape/outside interaction, and the desktop breakpoint. Controlled drawer focus returns to its mobile trigger when that trigger is visible. Desktop collapse still writes the existing cookie.
- Sidebar links use Button composition, current-page markers, and portalled Tooltip content for the collapsed layout. Breadcrumb and Separator compose the topbar. The root Appearance provider supplies the shared tooltip timing.
- The account menu uses DropdownMenu's keyboard/focus behavior. Its native logout form stays open during item selection to show the pending button. A `noscript` native form preserves server-rendered sign-out access without JavaScript.
- ConfirmDialog preserves its caller API, uses Dialog for focus trapping and dismissal, and restores the opening control explicitly because callers do not render a DialogTrigger. A caller may supply a stable return-focus ref when the opening menu item is removed; restoration happens only after Radix releases its focus scope. Cancel is initially focused unless a reason field is present. Pending actions block all user dismissal and resubmission; failures retain drafts.
- PasswordInput forwards all native input props and refs to Input. Its icon Button toggles visibility without changing the field value or account setting. CopyButton shows pending clipboard feedback, synchronously guards repeat clicks, and announces only actual success/failure.
- Avatar uses authenticated/local image URLs with decorative initials fallback, preserving existing display sizes and handling failed image loads.

## Business rules and user flow

- Desktop sidebar collapse is a layout preference stored by the existing `md_platform_sidebar` cookie helper. The server reads it before first paint.
- Mobile navigation closes on link selection, route changes, Escape, outside interaction, and switching to the desktop breakpoint. Opening and closing preserve keyboard focus.
- Account settings navigate to the existing Settings route. Signing out continues to use `logoutAction`, including its session revocation and cookie deletion. A server-rendered progressive form must remain available without JavaScript.
- Appearance access opens the existing saved settings flow; the header does not introduce a separate theme state or persistence mechanism.
- Confirmation callers own the action, error, pending, and open state. Pending confirmations cannot be dismissed or submitted again. Closing and reopening resets the optional reason draft.
- Required reasons reject whitespace-only input, enforce the supplied maximum length, focus the invalid textarea, and pass the trimmed reason to existing caller validation.
- Password visibility changes only the input type; it must preserve values, names, refs, autocomplete, disabled state, and validation descriptions.
- Clipboard feedback reflects the actual write result without rendering or logging the copied secret.

## Design decisions

Use Radix-backed shadcn primitives for focus trapping, keyboard menus, dismissal, and focus restoration rather than maintaining duplicate custom keyboard implementations. Retain the existing app wrappers to centralize business-specific reason validation, pending cancellation guards, and server action submission. Decorative avatars use initials when an authenticated image or local preview fails to load.

## Dependencies and security

The shell receives only the owner username from the protected layout. Navigation and dialog migration does not change authorization, database tables, Server Actions, or tenant lifecycle behavior. All floating content uses the central themed portal layer. Native server-action forms retain named inputs and progressive submission behavior.

## Verification

The isolated navigation branch passes `npm run typecheck`, `npm run lint`, and `git diff --check` against the official shared foundation and task dependency volume. Root task owns browser verification and the combined HTTP/database suite; no independent database suite runs concurrently. Integrated QA must check keyboard sign-out, no-JavaScript native form submission, confirmation focus and pending dismissal guards, reason validation/draft retention, password ref/value forwarding, responsive drawer closure, and theme inheritance in all portals.

## Change history

- 2026-10-15: Documented the requested shadcn migration and preserved navigation, confirmation, progressive sign-out, and field behavior before implementation.
- 2026-10-15: Migrated the scoped shared navigation and interactive wrappers to the official Radix-backed shadcn foundation; kept Server Actions, preference persistence, and caller-facing confirmation contracts intact.

- 2026-10-15: Integration review protects the visibility-toggle padding after
  application class overrides and accepts an explicit stable confirmation trigger.
  The integrated native login/logout HTTP regressions and UI contracts passed.
  Lint, TypeScript and production build pass; actual browser checks were blocked
  by the localhost:3100 permission gate. On 2026-10-15 the user explicitly waived
  browser verification; no rendered interaction results are claimed.

## CLAUDE.md compliance audit (requested 2026-10-15)

- The account menu trigger showed the owner's username in plain text and used
  it for the avatar initials. It now shows "Platform Owner" with generic
  initials; the menu label shows the username masked, and a "Show username" /
  "Hide username" menu item (eye icon) reveals it without closing the menu.
- `AuthPageGuard` (console layout) reloads a page restored from the browser
  back/forward cache so a signed-out visitor never sees cached console content.
- Navigation helpers (`navigation.ts`, `sidebar-preference.ts`) get full doc blocks.

### Change history

- 2026-10-15: Recorded masked account menu and back/forward-cache guard.
- 2026-10-15: Implemented the masked account menu and AuthPageGuard.
- 2026-10-15: Code-quality pass (CLAUDE.md): every function in this module's
  frontend and backend files now has the full doc block (Description, Input,
  Output, Use case, Author, Created, Last modified; "Created: X. Last modified:
  Y." one-liners split into two lines); consecutive single-line const/let
  declarations have their "=" vertically aligned (typed and untyped
  declarations are aligned in separate groups).
- 2026-10-15: Verification of the compliance pass: TypeScript (including tests)
  and ESLint (zero warnings) pass; the full Vitest suite passes in the app
  container: 37 files, 1136 tests, 1 pre-existing localhost-only skip.
