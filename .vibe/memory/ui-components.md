# Shared UI Components

## Overview and requested change

Migrate the existing SaaS interfaces to source-owned shadcn/ui components while
preserving native Server Actions, form validation, authentication and tenant
workflows. The application uses Next.js 16, React 19 and Tailwind CSS 4; retain
those versions and the existing CSS-first Tailwind configuration.

## Architecture and decisions

- Use one Radix-based shadcn component set under `src/components/ui`, with the
  official registry configuration in `components.json` and the shared `cn`
  utility in `src/lib/utils.ts`. Avoid an additional form or table state library.
- Keep server-rendered forms and tables where they already exist. NativeSelect
  preserves browser submission, URL filters, and operation without JavaScript.
- Existing app wrappers provide real application semantics (field error IDs,
  status messages, confirmation validation), composed from the shared primitives.
- Appearance remains the only theme authority. Semantic component tokens map to
  its existing surface, text, border, light/dark brand and width settings.
- Place portalled dialogs, sheets and menus within the existing theme ancestor.
  This preserves account accents and system mode without another theme provider.
- Preserve reduced motion, visible focus, accessible names, error announcements,
  pending-state duplicate guards and keyboard/focus behavior.

## Current status and verification

2026-10-15: Migrated authentication, dashboard, all tenant screens, Appearance,
navigation, confirmation/account/row overlays, feedback, empty and loading states.
The old custom control class module was removed; wrappers compose shared
primitives. Hidden native file pickers remain behind upload buttons and previews.
Registration, recovery and customer dashboards are not implemented and remain
outside this migration. No business services, actions, schemas or permissions
were changed.

The original combined suite passed all 1,062 tests, with one existing skip.
After review fixes, all 11 UI contract tests passed (including the new password
spacing regression), and lint, TypeScript and the production build passed.
HTTP coverage verifies native login/logout, protected routes, persistence, all
content widths and account-bound Appearance feedback. The Docker lockfile also
passes a clean-install dry run. Review fixes protect password-toggle padding,
long-domain wrapping and focus restoration after modal closure. Reduced motion
is supported by primitives and CSS.

Actual browser theme, accent, responsive and interactive verification remains
pending. Browser Use rejected localhost:3100 because a saved user preference
blocks the origin. The user has been asked to allow that origin; no alternative
browser or automation surface was used. A separate disposable preview database,
accounts and fixtures prevent changes to the user's account or existing tenants.
The task is not complete and must not be merged until rendered verification is
completed or the user changes this requirement.

## Sources

Official installation: https://ui.shadcn.com/docs/installation/next
Official tokens: https://ui.shadcn.com/docs/theming
Official registry source: https://github.com/shadcn-ui/ui

## Component maintenance

The official new-york Radix registry supplies source-owned components. New
components should use the existing `cn` utility, semantic tokens and
ThemePortalProvider; do not introduce a separate theme selector or storage.
`primary` is the configured brand and `accent` is the neutral interaction surface.
Legacy surface/text aliases continue to reference the same palette. Status colors
are centralized semantic tokens. Miniature Appearance artwork intentionally
illustrates multiple draft palettes rather than inheriting the active mode.

## Change history

- 2026-10-15: Added official shadcn source/config, semantic tokens and themed portals.
- 2026-10-15: Migrated existing interfaces and retained native form/ARIA contracts.
- 2026-10-15: Removed obsolete custom control styling and repaired integration
  review findings. Automated verification passed; browser access is pending.
