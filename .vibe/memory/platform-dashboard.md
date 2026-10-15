# Platform Dashboard

## Overview and requested change

The authenticated platform dashboard greets the owner, shows real tenant totals
and active counts, links to existing navigation modules, and clearly marks
unimplemented subscriptions, support and activity tracking. The 2026-10-15
shadcn/ui migration replaces page cards, badges, navigation actions, error
boundaries and loading surfaces with shared primitives. The migration is
implemented on codex/shadcn-pages-appearance; TypeScript, lint and Git diff checks
passed. The parent task owns combined business tests and rendered verification.

## User flow, business rules and data

Every dashboard request requires a valid Platform Owner on the server. It then
loads the existing database-backed tenant summary. An unavailable summary shows
an explanatory no-data state rather than fabricated zero values. Navigation and
descriptions come from the single existing navigation registry. Planned modules
remain placeholders; the migration does not add invented product functionality.

## UI, dependencies and edge cases

Cards, badges and buttons inherit semantic tokens supplied by the existing
Appearance system. Shared StatCard and ComingSoon wrappers are migrated by the
central component task. Login, shell navigation and tenant pages remain separate
modules. Error boundaries keep raw errors and digests in server logs, offer only
a safe retry action and retain console navigation where possible. Skeletons
announce loading and respect reduced-motion preferences.

## Change history

- 2026-10-15: Recorded shared-component migration requirements and existing
  dashboard and error/loading behavior before implementation.
- 2026-10-15: Migrated quick access and planned activity to Card, Badge and
  Button, with shared Alert/Button error boundaries and Skeleton loading states.
