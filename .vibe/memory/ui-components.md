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

2026-10-15: Inspection and migration started on isolated shadcn task branches.
Authentication, dashboard, tenant interfaces, Appearance and navigation are the
existing major interfaces. Registration, recovery and customer dashboards are
not implemented and are outside this migration. Verification is pending.

## Sources

Official installation: https://ui.shadcn.com/docs/installation/next
Official tokens: https://ui.shadcn.com/docs/theming
Official registry source: https://github.com/shadcn-ui/ui
