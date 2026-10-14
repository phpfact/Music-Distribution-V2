# Platform Appearance

## Overview and current change

The Platform Panel uses the control-plane database for independent Platform Owner
appearance preferences. This follow-up fixes Apply to All for the initiating
account and adds responsive content width preferences. Implementation and checks
are complete on the isolated codex/fix-appearance-global-width branch.

## Business rules and flow

- Resolve a valid personal override, then the platform default, then the
  application default. The default is Light / Emerald / Default Width.
- Apply to Me writes only the authenticated owner's complete selected appearance.
- Apply to All atomically saves the platform default and updates the initiating
  owner's existing personal override to the same selected appearance. When that
  owner has no override, they inherit the new default. Other owners' overrides
  remain intact. The confirmation must explicitly describe this impact.
- Default Theme to Me removes only that owner's override. Default Theme to All
  resets only the global setting; all personal overrides remain intact.
- Width options: Default Width keeps the existing 96rem console cap; Full Width
  fills the available content area; Focused Width caps it at 72rem. All options
  retain mobile gutters and responsive navigation. Form-specific readability
  limits remain where appropriate, while Appearance supports a full-width view.
- Draft controls and previews do not change the active workspace until saved.
- Validate before saving, prevent duplicate submissions, and preserve selections
  and error feedback on failure. Reload once, only after a confirmed save.
- Carry a whitelisted, account-bound success notice across the successful reload.

## Architecture, persistence and authorization

Appearance values are centralized in src/lib/appearance/preferences.ts. Prisma
stores a unique personal record in platform_owner_appearances and a singleton
platform default in platform_appearance. Width is added by an additive migration
with a default that preserves existing records. The server derives the owner from
the cookie-backed authenticated session. Global changes require the persisted
can_manage_appearance permission. Input validation, origin checks, session expiry,
account-switch guards, transaction rollback and audit logging remain enforced.
Every appearance write locks the initiating owner for update and its session for
share before modifying preferences. This serializes personal/global writes for
the same owner, including an override created concurrently with Apply to All.

ThemeRoot renders database preferences on the server and broadcasts only a refresh
signal between tabs. Background refresh does not extend the session idle timeout.
ConsoleShell consumes the resolved width for the available main content area.
No shared browser setting is an authoritative appearance preference.

The save controller in settings/appearance/save-and-reload.ts validates both the
returned state and the confirmed operation, so an unchanged personal override or
unexpected response cannot trigger a successful reload. It holds its duplicate
submission guard through navigation. A native beforeunload handler protects dirty
drafts and bypasses the warning once a commit is confirmed. The server-rendered
success notice uses whitelisted notice codes and noticeOwner matched to the
authenticated session; the client consumes only those query parameters without
another request. Preference or session data is never stored in that notice.

## Resolved-bug history and decisions

- 2026-10-14: Initial appearance module introduced personal/global separation,
  Light/Dark/System, six accents, safe resets, session guards and server rendering.
- 2026-10-14: Investigation confirmed Apply to All updated the global record but
  returned the initiating owner's higher-priority, unchanged personal override.
  The follow-up updates only that owner's existing override in the same
  transaction, preserving all other owners' customization and global isolation.
- 2026-10-14: The user's explicit successful-save reload requirement takes
  precedence over the repository's general guideline against full-page reloads.

## Verification and limitations

The combined suite passed: 1,062 tests passed and one existing test was skipped.
Coverage includes persistence/permission/concurrency and rollback regressions,
strict width parsing and migration compatibility, server-rendered widths across
pages and refreshes, owner-bound feedback, and 33 save/reload helper cases.
TypeScript, lint, production build and Git diff checks passed. The additive width
migration was applied to the local development database. Browser visual preview
access was declined earlier in this chat; visual automation was not attempted
again and no alternative UI automation surface was used.
