# Object Storage (MinIO AIStor)

## Overview

- **Name:** Object storage, on MinIO AIStor (S3-compatible).
- **Purpose:** store tenant assets (audio/video, cover images, other files) and
  database backups, with one bucket per tenant, a dedicated Platform Owner
  bucket and separate backup storage.
- **Business goal:** strict tenant isolation for files and backups
  (PRD §4.9, §4.10, §5.7; TRD §6.3, §9, §11, §14).
- **Status (2026-10-17):** Phase 1 (Docker setup) implemented. Phase 2
  (tenant bucket provisioning in the app, storage credentials per tenant,
  isolation tests, database backups into AIStor, migration of local files) not
  started.

## Features

**Phase 1 (done):**

- `aistor` service in Docker Compose: pinned image, license file as a Compose
  secret, persistent volume `aistor_data`, health check, restart policy,
  production hardening.
- One-off `aistor-admin` job (same image, bundled `mc`) that runs
  `docker/aistor/admin.sh` for every `make aistor-*` target.
- Platform Owner bucket `md-platform` and backup bucket `md-backups`, each with
  an ownership tag, anonymous access off.
- Service identities `md-platform` (read/write/delete on `md-platform` only)
  and `md-backup` (read/write on `md-backups` only, no delete).
- Makefile targets: `aistor-install`, `aistor-config-check`, `aistor-health`,
  `aistor-mc`, `aistor-buckets`, `aistor-bucket-inspect`, `aistor-smoke`,
  `aistor-usage`, `aistor-validate`.
- Integration with existing targets: `make up` (runs `aistor-config-check`
  first, then starts AIStor with the stack), `make urls` (Console + S3 API),
  `make ports`, `make health` (required service), `make destroy-data` (warning
  names AIStor data), `s=aistor`.
- `docker/scripts/lib.sh` gained `env_file_value` (moved from `seed.sh`, now
  shared by `seed.sh` and `aistor.sh`).

**Phase 2 (planned, needs PRD decisions D-11, D-13 to D-18 first):** tenant
bucket + identity + policy as provisioning steps, provisioner identity,
policy/mapping checks, isolation test suite, `aistor-backup*`/restore targets,
key rotation, cleanup, performance test target, app integration (storage
module, readiness check).

## User Flow (operator)

1. Get the AIStor license file (free tier: <https://www.min.io/pricing>) and
   put it at `minio/minio.license` in the project (git-ignored), mode 600.
2. Add the AIStor variables to `.env` (`make init` for a new file; an existing
   `.env` needs the block from README "MinIO AIStor").
3. `make aistor-install` (idempotent): checks config, starts AIStor, creates
   buckets, policies and identities, then validates.
4. `make up` starts AIStor with the rest of the stack; `make urls` prints the
   Console address. Console login = `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`.

## Admin Flow

- Diagnose: `make aistor-health`, `make aistor-usage`, `make logs s=aistor`.
- Inspect: `make aistor-buckets`, `make aistor-bucket-inspect bucket=<name>`.
- Verify: `make aistor-smoke`, `make aistor-validate`.
- Manual work: `make aistor-mc` (admin shell; aliases `aistor`, `platform`,
  `backup`).

## Business Rules

- One bucket per tenant (phase 2); Platform Owner bucket and backup storage
  are separate and never reachable with tenant credentials.
- A bucket is never reassigned or reused.
- Root credentials are for bootstrap and break-glass only, never given to the
  app.
- The backup identity cannot delete (deletion only through a future retention
  procedure).

## Validations

- `aistor-config-check` (host): required variables present; placeholders
  (`change-me…`) rejected in production; `minioadmin` rejected always; root
  user ≥ 3 chars; secrets ≥ 8 chars (≥ 16 in production); access keys match
  `^[A-Za-z0-9._-]{3,64}$` and are all different; license file exists, is
  non-empty and readable (warning if group/other can read it); the image is
  pinned by digest; `compose config` is valid. Problems name variables only.
- `admin.sh inspect` validates the bucket name (S3 rules) before use.

## UI Behavior

- No application UI in phase 1. The AIStor Console (built into the server) is
  published on `127.0.0.1:${AISTOR_CONSOLE_PORT:-9001}`.

## Database

- None in phase 1. Phase 2 (TRD §13): `tenant_buckets`, backup records.

## APIs

- AIStor S3 API: `aistor:9000` inside Docker; development also on
  `127.0.0.1:${AISTOR_HOST_PORT:-9000}`; production publishes no API port.
- Health: `/minio/health/live`, `/minio/health/ready`, `/minio/health/cluster`
  (unauthenticated). The Compose health check uses `ready` through `curl`
  inside the container.

## Security

- License: Compose secret (`/run/secrets/aistor_license`) from
  `AISTOR_LICENSE_FILE` (default `../minio/minio.license`, relative to
  `docker/`). Git-ignored (`/minio/`), excluded from the app build context
  (`Dockerfile.dockerignore`), and hidden from the development app container
  (empty tmpfs on `/app/minio`, approved by the user 2026-10-17).
- Credentials go to the containers as environment variables. Inside
  `admin.sh` they are URL-encoded into `MC_HOST_<alias>` variables, so they
  never appear in a host command line, output or log.
- Least-privilege policies `md-platform-rw` and `md-backup-rw`; no anonymous
  access (checked by policy and by an unauthenticated HTTP request).
- Production: `read_only`, `tmpfs /tmp`, `cap_drop: ALL`, `no-new-privileges`,
  CPU/memory limits; Console on 127.0.0.1 only.

## Performance

- Production limits default to 1 CPU / 1 GB (`AISTOR_CPU_LIMIT`,
  `AISTOR_MEMORY_LIMIT`). Thresholds and load tests: phase 2 (TRD §16).

## Dependencies

- Image `quay.io/minio/aistor/minio:RELEASE.2026-09-19T17-05-25Z@sha256:107cf2014a9583c74c11e3cdbd6903d89c2244355886b89ce532f4ecae9c23f3`
  (bundles `mc` RELEASE.2026-09-19T15-24-59Z, `curl`, `bash`, `sha256sum`;
  no `grep`/`sed`/`awk`).
- AIStor license (FREE plan, no expiry, verified 2026-10-17).
- Existing `docker/scripts/lib.sh`, Makefile conventions.

## Edge Cases

- Interrupted install: a fixed-name system bucket that exists **empty and
  untagged** is finished (tag set) with a warning; untagged with objects, or
  tagged for another owner, is a conflict and is never touched.
- An identity whose policy differs from ours is reported, not changed.
- Missing license file: `make up` / `aistor-install` stop with a clear message
  before touching any container (Compose alone does not notice a missing
  secret file while the container already exists).
- Existing `.env` without AIStor variables: Compose refuses to start and names
  the variable; README gives the block to append.

## Design Decisions

- **Bundled `mc` instead of a separate `quay.io/minio/aistor/mc` image:** the
  server image ships the matching `mc` release, so one image covers server and
  admin jobs (TRD §6.3 updated).
- **One-off `aistor-admin` service** (profile `aistor-admin`) instead of
  `exec` into the server: the service and backup secrets stay out of the
  long-running server's environment.
- **Entrypoint `/usr/bin/minio`:** skips the image's deprecated user-switching
  wrapper.
- **Runs as root inside the container** (image default). Verified working with
  `cap_drop: ALL` + read-only root filesystem. On a Linux production host the
  license file must therefore be readable by root without capabilities (owned
  by root, or mode 644).
- **Fixed names** (TRD §9.1 proposals): service `aistor`, volume
  `aistor_data`, buckets `md-platform` / `md-backups`, identities
  `md-platform` / `md-backup`, policies `md-platform-rw` / `md-backup-rw`,
  owner tag `md-owner=platform|backups`.
- **`app` depends on `aistor` being healthy** (TRD §6.3), so the stack does not
  start without a working AIStor.

## Technical Notes

- `MC_CONFIG_DIR=/tmp/.mc` (image default) works with the read-only root.
- Compose resolves `AISTOR_LICENSE_FILE` relative to `docker/` (the folder of
  the first Compose file).
- Root credential rotation for an existing deployment: follow AIStor's
  documented procedure; not yet verified for this version.

## Verification (2026-10-17, development, macOS arm64)

- `make aistor-install` from scratch and repeated: all 22 checks ok.
- Config-check negatives: missing license, `minioadmin`, spaces, duplicate
  identity names, production placeholders and short secrets: all reported.
- Interrupted install (empty untagged bucket) finished with a warning; untagged
  bucket with objects and foreign-tagged bucket refused, data untouched
  (tested on a throwaway server); extra policy and disabled identity refused.
- Buckets, identities and policies survive `make restart s=aistor` and
  container recreation; smoke test passes afterwards.
- No secret or root user value in any target output or the AIStor log.
- `/app/minio` is an empty tmpfs inside the development app container.
- Production mode: `make validate MODE=prod` passes; hardening flags tested
  with `docker run` (read-only, `cap_drop ALL`, `no-new-privileges`). The
  production stack itself was not started on this machine.

## Known Bugs

- None.

## Resolved Bugs

- None.

## Pending Improvements

- Phase 2 items above; off-host backup copy; metrics/alerting.

## Change History

- 2026-10-17: Requirements added to PRD/TRD v1.1 (commit cf043c9).
- 2026-10-17: Phase 1 Docker setup (service, admin job, buckets, identities,
  Makefile targets, README).
