# Platform appearance

Settings → Appearance persists settings in the control-plane PostgreSQL database.
Personal overrides belong to `platform_owner_appearances.owner_id`, the authenticated
Platform Owner identity, with a unique primary key and cascading owner foreign key.
The separate `platform_appearance` table permits only the singleton `platform` row.
The supported themes are Light, Dark, and System; accents are Neutral (shadcn's
black-and-white primary), Emerald, Indigo, Violet, Blue, Rose, and Amber. Width
presets are Default Width (96rem console cap), Full Width (all available content
space), and Focused Width (72rem cap). The designated application default is
Light/Neutral/Default Width (CLAUDE.md: shadcn's official neutral appearance by
default; the base palette follows shadcn's neutral scale in light and dark).
Mobile gutters and navigation remain responsive regardless of the chosen width. Shared presets
live in `WIDTH_OPTIONS`; width is validated and persisted with theme and accent.
No shared browser preference is an authoritative source for an owner's appearance.

## Resolution and reset semantics

1. A valid personal override takes precedence.
2. Otherwise the valid platform global setting applies.
3. Otherwise the application default applies.

Apply to Me writes only the signed-in owner's override. Default Theme to Me removes
only that override and inherits the global setting, or the application default if
none exists. Apply to All atomically changes the singleton platform default and
updates only the initiating owner's existing personal override to the same complete
selection. An initiating owner without an override continues to inherit the global
default; no new personal row is created. Other owners' personal records are never
changed. Default Theme to All writes Light/Neutral/Default Width as the global
default and preserves every personal override, including the initiating owner's. Login uses the
global/application default because no authenticated personal identity exists yet.
System follows the operating system only while the resolved theme is System.
Appearance scope covers the Platform Panel; tenant business users live in separate
databases and their applications do not inherit these Platform Owner preferences.

## Authorization and safety

The existing active Platform Owner session authenticates every appearance action.
The server derives the owner from the cookie-backed session, never a submitted ID.
The optional `expectedOwnerId` is only an account-switch guard: a stale tab's draft
is rejected when its loaded identity differs from the current server session; it
never selects the owner to update. Anonymous refreshes return only global/default
state, with no personal data, so logout clears the previous account's appearance.
An additive migration gives existing administrative Platform Owners the explicit
`can_manage_appearance` permission, defaulting to true to preserve their existing
administrator role. An operator can set it false for an owner who may customize
only their own appearance. Global apply and reset check this persisted permission
inside the write transaction, even for direct manipulated requests. Disabled,
revoked, idle, or expired sessions cannot save. Each write takes an exclusive
initiating-owner row lock and a shared session row lock. Owner disable and session
revocation wait for the write; same-owner personal/global operations also serialize
before reading or changing override existence. This prevents a global apply from
missing a concurrently created personal row and returning a conflicting setting.

Server Actions retain Next.js origin/host protection and saves additionally reject
missing, malformed, or cross-site origins. All request keys, themes, accents,
operations, and scopes are validated before writing. Audit events commit in the
same transaction as each successful write. Errors use safe feedback and do not
report success on a failed write. No private record of another owner is returned.

Writes use atomic upserts/deletes: distinct users cannot overwrite one another;
repeated applies are idempotent in effect. Global apply, the initiating owner's
existing override update, and the audit event share one transaction: any failure
rolls back all three. Concurrent personal and global writes retain complete
appearances; overlapping rows resolve in commit order. Reads are memoized only during one React render/request, so layout and settings
share one lookup while refresh actions observe other tabs/devices without a
persistent cache. Transaction save responses read authoritative state uncached.
Background refresh validates the cookie-backed session without touching its last
activity timestamp, so polling cannot extend the existing session idle timeout. A
successful save invalidates the Platform layout and returns authoritative state.
The server renders the resolved theme before hydration; System uses a CSS media
query on the first paint. Accent values are shared by the interface and previews.
No shared appearance cookie or local storage is read. Broadcast notifications
contain only a refresh signal, and visible tabs refresh at most once a minute.
An owner/version guard rejects delayed mutation responses after an account switch
or newer background state, then refreshes the authoritative server layout. Unsaved
drafts remain local to the page and are discarded when its owner changes. During
an anonymous global-preference read outage, login still renders the application
default; authenticated preference errors remain visible through the error boundary.

## Verification

`npm run db:generate` regenerates the control client after schema changes. Deploy
`prisma/control/migrations/20261014140000_platform_appearance` with the existing
control migration workflow before serving the updated application. The initial
migration adds tables, enums, and one permission column without discarding records.
Then deploy `20261014180000_appearance_content_width`: it adds the `appearance_width`
enum and required width columns with a `default` value, preserving the theme/accent
of every existing personal/global record.

`tests/appearance-preferences.test.ts` covers strict value parsing and precedence.
`tests/appearance-service.test.ts` uses the project's migrated scratch PostgreSQL
database for per-owner persistence, resets, concurrency, permission enforcement,
expiry/revocation/disable, singleton and FK constraints, and transactional failures.
Global-apply regressions cover an initiating owner with an old personal override,
no new override for an inheriting owner, untouched peer overrides, concurrent
personal/global applies with existing and absent initiating overrides (each result
must reflect its selected complete appearance), and rollback of both writes on an
audit or override-write failure. Width coverage includes all supported values,
unsupported/missing request values, persisted per-owner isolation, resets, and
default width for legacy inserts.
`tests/appearance-actions.test.ts` verifies direct-action authorization, hostile
requests, origin protection, failure feedback, and refresh behavior.
`tests/platform-http.test.ts` verifies that the obsolete cookie cannot affect the
login theme and that personal settings render on the server across platform pages
and refreshes. `tests/tenant-pages-http.test.ts` guards the Appearance route too.
