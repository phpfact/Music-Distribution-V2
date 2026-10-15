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
