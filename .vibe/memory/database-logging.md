# Database Logging

## Overview

PostgreSQL development and production Compose services load the same checked-in
`docker/postgres/postgresql.conf`. Operational logging must retain duration and
server health information without copying authentication SQL or bind values.

## Requested audit remediation (2026-10-17)

- AUD-018: use duration-only logging; disable ordinary and sampled statement text,
  statement-on-error text and bind parameter logging. Terse database error output
  omits detail/query/context; disable lock-wait reports that may carry SQL context.
- Preserve UTC timestamps, process identity, checkpoints and database errors.
- Configuration requires operator reload/restart before an existing deployment
  uses it; verification uses a disposable PostgreSQL instance, not live logs.
- Primary database error messages can themselves contain data: these settings are
  a SQL/bind logging policy, not universal redaction of arbitrary server messages.

## Change history

- 2026-10-17: Recorded AUD-018 configuration boundary before implementation.
- 2026-10-18: Implemented and verified on a disposable PostgreSQL 18 instance:
  successful slow SQL and failing verifier-bearing DDL retained duration/error
  signals without synthetic credential markers; all configured values matched.
- 2026-10-18: Applied to the local development stack. A file bind retained the
  previous inode across reload; a controlled PostgreSQL restart loaded the new
  file. Live `pg_settings` matched the policy and the app/database were healthy.
