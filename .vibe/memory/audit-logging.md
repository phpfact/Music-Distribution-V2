# Audit logging

## Overview and requested change (2026-10-17, AUD-016)

The control-plane audit writer is the shared boundary for administrative events.
It retains the existing actor, action, target, UTC database time and validated IP.
An optional request-context envelope is stored in the existing JSON metadata,
without a database migration. Current HTTP context is read automatically at the
writer, so every existing administrative callsite receives the same contract;
background jobs omit absent request context and can pass explicit safe context.

## Security and context

Only an internally generated request ID, normalized endpoint without query or
private path values, method, status/outcome and coarse browser/OS/device labels
are allowed. User-agent text is bounded before classification and is never
stored. Proxy-owned correlation headers overwrite incoming values. Header-only
contexts without proxy metadata receive a server-generated ID; direct service
calls outside a request remain valid. No credentials, cookies, tokens, raw form
values or arbitrary client headers enter the envelope.

## Dependencies and verification

Shared request-context helpers serve audit rows, authentication outcomes and
host rejection events. Regression tests cover sanitization, bounded emission,
context persistence and omission outside requests.

## Authentication and rejection telemetry

`security-events.ts` emits allowlisted JSON authentication outcomes to the
existing application stdout/stderr collector. UTC timestamps, area, tenant,
verified database actor IDs, last trusted proxy IP and request envelope support
correlation. Submitted identifiers are HMAC-SHA256 pseudonyms using the existing
`tenantSecretsKey` with a versioned auth-only domain separator and tenant scope.
The same pseudonym accompanies later verified success; it remains stable across
replicas/restarts that share the key and changes if the master key rotates.
Passwords, cookies, tokens and raw identifiers are excluded. This does not add a
new authentication database write or make sign-in depend on log persistence.

Host rejection telemetry permits twenty events per process per fixed minute;
the counter has constant memory and cannot grow with attacker host cardinality.
Excess events are suppressed until the next window. External log retention and
collection remain deployment responsibilities.

## Completion and verification — 2026-10-18

Shared request-context, structured authentication outcomes and bounded host telemetry implemented. The existing administrative writer automatically records sanitized context in JSON metadata; no schema migration. Validation: targeted real-database regression 6 files / 120 tests passed; database-free observability/logout regression 2 files / 16 tests passed; ESLint, TypeScript, production build and diff whitespace checks passed. The parent integration task owns the exclusive full-suite run and main merge.
