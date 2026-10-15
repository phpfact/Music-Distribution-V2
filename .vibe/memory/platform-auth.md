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
