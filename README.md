# Music Distribution

Infrastructure foundation: a minimal Next.js application with PostgreSQL, pgAdmin,
Redis, Redis Insight and MinIO AIStor object storage, all run through Docker for
both local development and production, plus the database schemas and migrations
(Prisma). It contains no product features yet.

## Stack

| Component     | Version                 | Notes                                               |
| ------------- | ----------------------- | --------------------------------------------------- |
| Next.js       | 16.4.0 (App Router)     | Turbopack, `output: "standalone"`                   |
| React         | 19.3.0                  |                                                     |
| Node.js       | 24.21.0 LTS             | `node:24.21.0-trixie-slim`                          |
| TypeScript    | 6.0.3 (strict)          | See "Version constraints"                           |
| Tailwind CSS  | 4.3.3                   | via `@tailwindcss/postcss`                          |
| ESLint        | 9.39.5                  | See "Version constraints"                           |
| Prisma        | 7.10.0                  | ORM and migrations, `pg` driver adapter. See "Database schema and migrations" |
| PostgreSQL    | 18.6                    |                                                     |
| pgAdmin       | 9.18                    |                                                     |
| Redis         | 8.10.2                  | AOF + RDB persistence                               |
| Redis Insight | 3.8.0                   |                                                     |
| MinIO AIStor  | RELEASE.2026-09-19T17-05-25Z | S3-compatible object storage; needs a license file. See "MinIO AIStor" |

Every container image is pinned by tag **and** digest in
[docker/compose.yaml](docker/compose.yaml) and
[docker/app/Dockerfile](docker/app/Dockerfile). npm packages are pinned by
[package-lock.json](package-lock.json).

### Version constraints

Two packages are deliberately not on their newest major. Revisit both when
upgrading `eslint-config-next`:

- **TypeScript 6.0.3, not 7.x.** `typescript-eslint` 8.x (a dependency of
  `eslint-config-next` 16.4) supports `typescript <6.1.0`.
- **Prisma 7.10.0, not 8.x.** Prisma 8 is still a release candidate, although
  npm's `latest` tag for the `prisma` package already points at it. Keep
  `prisma`, `@prisma/client` and `@prisma/adapter-pg` on the same version.
- **ESLint 9.39.5, not 10.x.** `eslint-plugin-react`, `eslint-plugin-import` and
  `eslint-plugin-jsx-a11y` (all pulled in by `eslint-config-next` 16.4) do not
  declare ESLint 10 support. npm prints a notice that ESLint 9 is no longer
  maintained; it is a development-only tool and is not in the production image.

## Requirements

- Docker Engine 25 or newer with the Compose plugin v2.24 or newer
  (developed and tested on Engine 29.1.3, Compose 2.40.3, macOS arm64)
- GNU Make 3.81 or newer, and `bash`
- Node.js is **not** needed on the host; everything runs in containers
- A MinIO AIStor license file (the free tier is enough for development); see
  "MinIO AIStor"

### Using sudo

Whether Docker needs `sudo` depends on the machine. With Docker Desktop
(macOS, Windows) it does not. On Linux it does unless your user is in the
`docker` group. The Makefile never adds `sudo` itself, so use whichever fits:

```bash
make up            # user can talk to Docker directly
sudo make up       # user needs elevated privileges
```

Every target works both ways (`sudo make down`, `sudo make sh`,
`sudo make logs s=app`, ...). `sudo make init` and `sudo make backup` hand the
files they create (`.env`, `backups/`) back to the user who ran `sudo`.

Pick one style per machine. On Docker Desktop, mixing them can leave
root-owned files in `~/.docker`, after which builds without `sudo` fail with
"permission denied".

## Quick start

First put the AIStor license file at `minio/minio.license` (see "MinIO AIStor").

```bash
make init             # creates .env from .env.example with generated random secrets
make aistor-install   # starts AIStor, creates its buckets and identities, checks them
make up               # checks ports and AIStor settings, builds, starts everything, waits until healthy
```

| Interface      | Address                 | Login                                              |
| -------------- | ----------------------- | -------------------------------------------------- |
| Application    | http://127.0.0.1:3000   | none                                               |
| pgAdmin        | http://127.0.0.1:5050   | `PGADMIN_DEFAULT_EMAIL` / `PGADMIN_DEFAULT_PASSWORD` from `.env` |
| Redis Insight  | http://127.0.0.1:5540   | none (reachable from this machine only)            |
| AIStor Console | http://127.0.0.1:9001   | `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` from `.env` |

`make urls` prints the actual addresses, `make down` stops everything and keeps
all data, and `make` on its own lists every command.

The first start takes longer: it builds the dev image and installs
dependencies into a volume. Later starts take a few seconds.

## Layout

```
src/                     Next.js application (App Router)
  app/api/health/        liveness (/api/health) and readiness (/api/health/ready)
  app/platform/          platform owner area: login page, dashboard, sign-out
  app/platform/(console)/tenants/
                         Tenant Management pages, forms and Server Actions
  proxy.ts               keeps /platform/** on the platform host (404 elsewhere)
  lib/env.ts             runtime configuration and validation
  lib/postgres.ts        bounded connection pool (control-plane database)
  lib/db/control.ts      Prisma client for the control-plane database
  lib/db/tenant.ts       Prisma client for one tenant's database
  lib/redis.ts           shared Redis client
  lib/platform-auth/     platform owner sign-in: user names, password hashing,
                         sessions, rate limiting
  lib/tenants/           tenant rules, generators and use cases (service/)
  lib/provisioning/      tenant database setup: admin SQL, migration applier,
                         existing-database checks, provisioning runner
  lib/domains/           host name rules, DNS checks, host -> tenant gate
  lib/secrets/           AES-256-GCM secret store (tenant database passwords)
  lib/storage/           files under STORAGE_ROOT (tenant profile images)
  lib/rate-limit.ts      generic Redis rate limiter (fails closed)
  lib/audit.ts           writes audit_events
  generated/prisma/      generated Prisma clients (git-ignored)
prisma/
  control/               control-plane schema and its migrations
  tenant/                tenant schema and its migrations (applied per tenant database)
  control.config.ts      Prisma CLI configuration for the control plane
  tenant.config.ts       Prisma CLI configuration for one tenant database
  connection.ts          builds the CLI's connection URL from POSTGRES_*
  migrate-tenants.ts     applies tenant migrations to every tenant database
  seed.ts                creates the initial platform owner; rotates its password
tests/                   automated tests (Vitest); support/ holds their helpers
vitest.config.ts         test runner configuration
docker/
  compose.yaml           base stack, shared by both environments
  compose.dev.yaml       development override (hot reload, host ports)
  compose.prod.yaml      production override (hardened, no database ports)
  app/                   Dockerfile, its .dockerignore, dev entrypoint
  postgres/              postgresql.conf
  redis/                 redis.conf
  aistor/                admin.sh: AIStor setup and checks, run in a one-off container
  scripts/               logic behind the Makefile targets
minio/                   the AIStor license file (git-ignored, never committed)
docs/
  tenant-management.md   design of the Tenant Management module
Makefile                 everyday commands
.env.example             configuration template (placeholders only)
```

## Configuration

All configuration lives in one env file (`.env`, git-ignored, mode 600). It is
passed to Docker Compose, which hands each container only what it needs. It is
never copied into an image.

| Variable                                   | Purpose                                         | Notes |
| ------------------------------------------ | ----------------------------------------------- | ----- |
| `POSTGRES_DB`, `POSTGRES_USER`             | database and role name                          | applied on first initialization only |
| `POSTGRES_PASSWORD`                        | database password (**secret**)                  | applied on first initialization only |
| `POSTGRES_POOL_MAX`                        | max control-plane connections per app instance (default 10) | 1 to 100 |
| `POSTGRES_TENANT_POOL_MAX`                 | max connections per tenant database, per app instance (default 3) | 1 to 20 |
| `POSTGRES_TENANT_CLIENTS_MAX`              | soft retained-client target per app instance; idle overflow drains after 30 seconds (default 50), separate from pool connection limits | 1 to 1000 |
| `REDIS_PASSWORD`                           | Redis password (**secret**)                     | applied on every start |
| `REDIS_MAXMEMORY`, `REDIS_MAXMEMORY_POLICY`| memory cap and eviction policy                  | see "Redis" |
| `PGADMIN_DEFAULT_EMAIL`, `PGADMIN_DEFAULT_PASSWORD` | initial pgAdmin login (**secret**)     | applied on first initialization only |
| `PLATFORM_OWNER_INITIAL_USERNAME`, `PLATFORM_OWNER_INITIAL_PASSWORD` | first platform owner account (**secret**) | read only by `make db-seed` and `make db-rotate-owner-password`; see "Platform owner account" |
| `TENANT_SECRETS_KEY`                       | key for the stored tenant database passwords (**secret**) | generated by `make init`; **back it up**, see below |
| `PLATFORM_BASE_DOMAIN`                     | host of the platform; tenants get `<label>.<domain>` | default `localhost`; see "Tenant management" |
| `STORAGE_ROOT`                             | where uploaded files (tenant profile images) are kept | default `/app/storage`; Compose does not pass it, so the default applies |
| `AISTOR_LICENSE_FILE`                      | AIStor license file                             | default `../minio/minio.license`, relative to `docker/`; see "MinIO AIStor" |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`   | AIStor root (admin) login (**secret**)          | generated by `make init`; never given to the app |
| `AISTOR_PLATFORM_ACCESS_KEY`, `AISTOR_PLATFORM_SECRET_KEY` | identity for the Platform Owner bucket (secret key **secret**) | created by `make aistor-install` |
| `AISTOR_BACKUP_ACCESS_KEY`, `AISTOR_BACKUP_SECRET_KEY` | identity for the backup bucket (secret key **secret**) | created by `make aistor-install` |
| `APP_BIND_ADDRESS`, `APP_PORT`             | where the app is published on the host          | default `127.0.0.1:3000` |
| `PGADMIN_PORT`, `REDISINSIGHT_PORT`, `AISTOR_CONSOLE_PORT` | GUI ports, always on 127.0.0.1  | 5050, 5540, 9001 |
| `POSTGRES_HOST_PORT`, `REDIS_HOST_PORT`, `AISTOR_HOST_PORT` | **development only**, always on 127.0.0.1 | 5433, 6380, 9000 |
| `NEXT_DEV_BUNDLER`, `WATCHPACK_POLLING`    | **development only**, see "Hot reload"          | optional |
| `*_CPU_LIMIT`, `*_MEMORY_LIMIT`            | **production only** resource limits             | optional |

The host ports for PostgreSQL and Redis default to 5433 and 6380 rather than
5432 and 6379, because a natively installed PostgreSQL or Redis usually holds
the standard ones. Inside Docker the services always use their standard ports.

The application validates its configuration when the server starts. If
something is missing or invalid it logs every problem by variable name (never
the value) and exits with code 1. In production it also rejects placeholder
values and secrets shorter than 16 characters. Compose itself refuses to start
if a required variable is absent.

**`TENANT_SECRETS_KEY`**: every tenant database password is stored encrypted
in the control plane with a key derived from this value. Back it up together
with the database backups, but separately from them. If it is lost, every
stored tenant database password is unrecoverable; changing it breaks them in
the same way. Those tenants cannot be reached until their database passwords
are rotated or re-entered.

An `.env` created before Tenant Management existed lacks the key, and Compose
refuses to start. Add it by hand (`make init` never overwrites a file):

```bash
echo "TENANT_SECRETS_KEY=$(openssl rand -hex 24)" >> .env
```

No variable may be given a `NEXT_PUBLIC_` prefix unless it is meant to be
public: that prefix ships the value to the browser. Server modules import
`server-only`, so importing them from client code fails the build.

### Credentials

Some credentials are written into a data volume the first time a service
starts. Editing `.env` afterwards does **not** change them, and does not
reinitialize anything:

- **PostgreSQL**: `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` are
  used only to initialize an empty data volume. To change the password of an
  existing database, change it in the database and then in `.env`:

  ```bash
  make psql
  ALTER ROLE music_distribution PASSWORD 'new-password';   -- inside psql
  ```

  Then set `POSTGRES_PASSWORD` to the same value in `.env` and run `make up`.
  If the two disagree, the app's readiness check reports `postgres: down` and
  the PostgreSQL log shows "password authentication failed".
- **pgAdmin**: the login is created once in the `pgadmin_data` volume. Change
  the password inside pgAdmin (top-right user menu).
- **Redis**: the password is passed on every start, so changing
  `REDIS_PASSWORD` and running `make up` takes effect immediately. Update any
  connection saved in Redis Insight to match.
- **Platform owner**: `make db-seed` creates the account once, in the
  database. Editing `PLATFORM_OWNER_INITIAL_*` afterwards changes nothing; to
  change the password run `make db-rotate-owner-password` (see "Platform owner
  account").
- **AIStor**: the service identities follow `.env`: after changing
  `AISTOR_PLATFORM_SECRET_KEY` or `AISTOR_BACKUP_SECRET_KEY`, run
  `make aistor-install` again. Changing `MINIO_ROOT_USER` or
  `MINIO_ROOT_PASSWORD` of an existing deployment needs AIStor's documented
  root-credential rotation procedure, which has not been verified for this
  version yet; do not just edit `.env`.

## Commands

Run `make` for the full list. The most common ones:

| Command                         | What it does                                                    |
| ------------------------------- | --------------------------------------------------------------- |
| `make init`                     | create `.env` with generated secrets (never overwrites)         |
| `make up`                       | start the stack and wait until healthy                          |
| `make down`                     | stop and remove containers and network; **keeps all volumes**   |
| `make stop` / `make restart`    | stop or restart all services, or one with `s=<service>`         |
| `make build` / `make rebuild`   | build the app image / build it and update the stack             |
| `make ps` / `make health`       | container status / health plus the app's dependency checks      |
| `make logs`                     | follow logs; `make logs s=app` for one service                  |
| `make sh`                       | shell in the app container                                      |
| `make db-sh` / `make psql`      | shell / `psql` in the PostgreSQL container (`db=<name>` optional) |
| `make redis-cli`                | authenticated `redis-cli`                                       |
| `make lint` / `make typecheck` / `make check` | ESLint, TypeScript, or both (dev stack must be running) |
| `make test`                     | run the automated tests (dev stack must be running; see "Tests") |
| `make db-migration name=...` / `make tenant-migration name=...` | create a migration from schema edits |
| `make db-migrate` / `make db-status` | apply pending migrations / show what is applied            |
| `make db-generate`              | regenerate the Prisma clients                                   |
| `make db-seed`                  | create the initial platform owner if none exists                |
| `make db-rotate-owner-password` | set the platform owner's password from `.env`; revokes its sessions |
| `make backup` / `make restore FILE=...` | database backup and restore                             |
| `make aistor-install`           | first-time AIStor setup: buckets, identities, checks (safe to repeat) |
| `make aistor-health` / `make aistor-usage` | AIStor probes, license and drives / storage use and container resources |
| `make aistor-buckets` / `make aistor-bucket-inspect bucket=...` | list buckets / details of one bucket |
| `make aistor-smoke` / `make aistor-validate` | round-trip test / every setup and isolation check plus the round trip |
| `make aistor-config-check` / `make aistor-mc` | check the AIStor settings / admin shell with `mc`         |
| `make ports` / `make validate`  | check host ports / validate the Compose configuration           |
| `make prod-build` / `prod-up` / `prod-deploy` / `prod-down` | production image and stack         |
| `make prod-migrate`             | apply pending migrations in production                          |
| `make prod-seed`                | create the initial platform owner in production if none exists  |
| `make prod-ps` / `prod-logs` / `prod-health` / `prod-restart` / `prod-images` | production status   |
| `make prod-tools-up` / `prod-tools-down` | start or remove the GUIs in production                 |
| `make destroy-data`             | **permanently delete** this stack's volumes (typed confirmation) |

Services are `app`, `postgres`, `redis`, `aistor`, `pgadmin` and `redisinsight`.

Options: `s=<service>`, `MODE=dev|prod`, `ENV_FILE=<path>` (no spaces),
`DOCKER="sudo docker"`, `FILE=<backup>`, `db=<database>`, `name=<migration>`, `bucket=<name>`,
`APP_IMAGE=<name>`, `APP_TAG=<tag>`. Every generic command also works for production with
`MODE=prod`, for example `make backup MODE=prod`.

## Development

### Hot reload

The source tree is bind-mounted into the app container and the dev server uses
Turbopack with native file events. An edit on the host is served about a second
later with no restart. TypeScript and build errors appear in the browser overlay
and in `make logs s=app`.

`node_modules` and `.next` live in named volumes, not on the host, because they
contain Linux builds. When `package.json` or `package-lock.json` changes, the
container reinstalls dependencies automatically on its next start
(`make restart s=app`). To add a package:

```bash
make sh
npm install <package>     # inside the container; updates package.json and the lockfile
```

**If edits are not picked up** (for example a project kept on a Windows drive
under WSL 2, where file events do not reach the container), switch the dev
server to webpack with polling by setting both of these in `.env`, then
`make up`:

```
NEXT_DEV_BUNDLER=webpack
WATCHPACK_POLLING=true
```

Polling costs CPU, so use it only when needed. Turbopack's own polling option
(`watchOptions.pollIntervalMs`) did not detect changes in this setup, which is
why the fallback is webpack.

The project's `node_modules/` and `.next/` folders on the host are empty mount
points; the container never reads the host's copies. For editor type
information you can run `npm ci` on the host as well (Node 24). That installs
host-native packages for your editor only and does not affect the container.

On Linux, the dev container runs as uid 1000. If your user has a different
uid, files the container writes into the project (the lockfile,
`next-env.d.ts`) will be owned by uid 1000.

### Health checks

- `GET /api/health` is liveness: it answers whenever the server process can
  handle a request and checks no dependencies. Docker's health check uses it.
- `GET /api/health/ready` is readiness: 200 only when the app can query
  PostgreSQL and ping Redis, otherwise 503 with a per-dependency status.

A container marked "healthy" only means the process responds. `make health`
shows both the container states and the readiness report.

Startup order is enforced with health conditions: the app, pgAdmin and Redis
Insight start only after the service they depend on reports healthy (for the
app: PostgreSQL, Redis and AIStor). Nothing depends on the two GUIs, so the app
keeps running if one of them is down.

### Tests

```bash
make test          # or, inside the container (make sh): npm test
```

The tests are written with Vitest and live in `tests/`. They run inside the
app container, so the development stack must be running (`make up`). Nothing
is mocked away: they use the real PostgreSQL, the real Redis and, for the
sign-in flow, the running dev server. A run takes well under a minute.

What a run does to your stack:

- **A scratch database.** It creates `<POSTGRES_DB>_test`, applies the
  control-plane migrations to it with `prisma migrate deploy`, runs the
  migration, seed and library tests there, and drops it at the end. A copy left
  behind by a run that was killed is dropped at the start of the next one. Only
  a database whose name ends in `_test` is ever created or dropped.
- **The dev server.** `tests/platform-http.test.ts` signs in and out over HTTP
  at `http://127.0.0.1:3000` (set `E2E_BASE_URL` for another address). The dev
  server reads the development database, so that suite adds one throwaway
  platform owner named `e2e-<random>` there and deletes exactly that row, with
  its sessions, when it finishes. No other row is read or changed. If the
  server cannot be reached the suite fails; it is not skipped. If a run is
  killed half way, the `e2e-...` owner stays behind and can be deleted by hand.
- **Redis.** Sign-in attempts are counted in the same Redis the dev app uses.
  The tests only use `vt-...` and `e2e-...` user names and client addresses
  from the documentation ranges (`203.0.113.0/24`, `198.51.100.0/24`), and
  delete exactly the counters they caused.

`make test` is not part of `make check`.

## Database schema and migrations

Prisma is the ORM and the migration tool. There are two schemas, because there
are two kinds of database:

| Schema | Database | Contents |
| ------ | -------- | -------- |
| [prisma/control/schema.prisma](prisma/control/schema.prisma) | the control plane (`POSTGRES_DB`), one for the platform | `plans`, `tenants`, `tenant_domains`, `tenant_provisioning_runs`, `audit_events`, `platform_owners`, `platform_owner_sessions` |
| [prisma/tenant/schema.prisma](prisma/tenant/schema.prisma) | one per tenant | `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `customers`, `artists`, `labels`, `audio_releases`, `video_releases`, `release_assets` |

Each has its own migration history and its own generated client. Tenant tables
carry no tenant id: the database itself is the boundary.

### Using the clients

```ts
import { getControlDb } from "@/lib/db/control";
import { getTenantDb } from "@/lib/db/tenant";

const tenant = await getControlDb().tenant.findUnique({ where: { slug } });
const customers = await getTenantDb(target).customer.findMany();
```

Both modules are server-only. `getTenantDb` takes the tenant's database name
and login, which must come from the tenant resolved on the server for the
request, never from request input. Model and enum types are imported from
`@/generated/prisma/control/client` and `@/generated/prisma/tenant/client`.

The clients are generated code and are not committed. They are generated when
the dev container starts and during the image build; after editing a schema
run `make db-generate` (the migration commands below do it for you).

### Changing a schema

1. Edit `prisma/control/schema.prisma` or `prisma/tenant/schema.prisma`.
2. Create the migration:

   ```bash
   make db-migration name=add_plan_limits        # control plane
   make tenant-migration name=add_customer_notes # tenant schema
   ```

   This writes `prisma/<schema>/migrations/<timestamp>_<name>/migration.sql`,
   applies it to a development database and regenerates the clients. A
   control-plane migration is applied to the development control plane. A
   tenant migration is applied to a scratch database,
   `<POSTGRES_DB>_tenant_dev`, created on first use; it exists only to develop
   and try tenant migrations.
3. Read the SQL. Prisma writes it from the schema diff; a rename, for example,
   becomes a drop and an add unless you edit it. Constraints Prisma cannot
   express (the `CHECK` constraints at the end of the two `init` migrations)
   are added to the SQL by hand.
4. `make restart s=app`, so the dev server stops using the old client.
5. Commit the schema and the migration together. Never edit a migration that
   has been applied anywhere else; add a new one.

### Applying migrations

```bash
make db-migrate
```

applies pending control-plane migrations, then pending tenant migrations to
the database of every `active` or `suspended` tenant, one at a time. It is
safe to repeat. For each tenant the outcome is recorded on its `tenants` row:
`schema_status` (`current` or `failed`), `schema_version` (the newest migration
applied) and `schema_migrated_at`. A tenant that fails is reported and the run
continues with the next one; the command then exits with an error. A tenant
whose database is missing counts as failed, it is never recreated empty.

Each tenant database is migrated on its own port (`database_port`, which may
be a different PostgreSQL port of `POSTGRES_HOST` than the control plane's).

Tenants that are still being provisioned are skipped: provisioning has to
apply the migrations to a new database itself, before it activates the tenant.
A newly provisioned tenant therefore gets the current schema during setup,
without `make db-migrate`.

Migrations connect with the administrative login (`POSTGRES_USER`), because
they change schemas. Tenant logins must not own their tables or be able to
alter them; granting them only the data privileges they need is part of
provisioning.

### Platform owner account

Platform owners are the people who run the platform. They are stored in the
control plane, never in a tenant database: `platform_owners` holds the user
name (lower-case, 3 to 64 characters, enforced by a `CHECK` constraint), an
Argon2id password hash and a status; `platform_owner_sessions` holds one row
per signed-in session, with the SHA-256 of the session token rather than the
token.

The first account is created from `PLATFORM_OWNER_INITIAL_USERNAME` and
`PLATFORM_OWNER_INITIAL_PASSWORD` in `.env` (`make init` generates the
password; read it from `.env` to sign in):

```bash
make db-seed       # development
make prod-seed     # production, after `make prod-migrate`
```

It only bootstraps an empty table. If any platform owner already exists it
changes nothing and says so, whatever the two variables contain, so it is safe
to repeat. The password must be 12 to 256 characters and not a `change-me...`
placeholder; a configuration problem is reported by variable name and nothing
is written.

Changing the two variables later does not change the account. To change the
password, set the new one in `.env` and run:

```bash
make db-rotate-owner-password             # development
make db-rotate-owner-password MODE=prod   # production
```

This sets the password of the account named by
`PLATFORM_OWNER_INITIAL_USERNAME` and deletes all of that account's sessions,
so every browser signed in as it has to sign in again. It fails if no such
account exists; it never creates one and never changes a user name or status.

Both commands read the two variables from the env file (a value exported in
your shell takes precedence) and pass them to that one process; Compose does
not put them in the environment of the application container, and the
production image contains no env file. The password is never logged. The two
lines may be removed from `.env` once the account exists. In development that
is the only way to keep them from the app process: the project folder,
including `.env`, is bind-mounted into the dev container, and the Next.js dev
server loads that file itself.

### Platform owner sign-in

| URL | What it is |
| --- | ---------- |
| `/platform/login` | the sign-in form |
| `/platform/dashboard` | the dashboard; only for a signed-in platform owner |
| `/platform` | redirects to the dashboard |

Anyone who is not signed in is sent to the login page. After signing in the
destination is always the dashboard: no return URL is read from the request.
The check is made on the server, in the page, on every request.

**Sessions** are kept on the server, in `platform_owner_sessions`. A session
ends 8 hours after sign-in, or after 30 minutes without a request, whichever
comes first. The browser holds a random token in the `md_platform_session`
cookie: `HttpOnly`, `SameSite=Lax`, scoped to `/platform`, and `Secure` in
production (so sign in over HTTPS, through the reverse proxy). Signing out
deletes the session row, so a copied cookie stops working at once. So do
`make db-rotate-owner-password` and disabling the account.

**Rate limits** are counted in Redis, before the password is checked: 5
attempts per user name and 20 per client address, each per 15 minutes. Past
either limit every attempt is refused, the correct password included, until
the window ends. A successful sign-in clears the count for that user name. If
Redis is unreachable, sign-in is refused rather than left unlimited. To lift a
block by hand:

```bash
make redis-cli
> SCAN 0 MATCH platform-login:* COUNT 1000
> DEL <key> [<key> ...]
```

**Client address**: the app assumes exactly one trusted reverse proxy in front
of it in production, and takes the client address from the last entry of
`X-Forwarded-For`. The proxy must append the address it saw to that header
(nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`). It
must also pass the `Host` and `Origin` headers through unchanged: Next.js
rejects a form submission whose `Origin` does not match the host, which is
what protects sign-in and sign-out against cross-site requests. With more than
one proxy, or none, the address is not reliable and the per-address limit with
it.

**Disabling an account and revoking sessions** is done in SQL (`make psql`).
A disabled account cannot sign in and its sessions stop working immediately.
Delete them as well, or they work again if the account is re-enabled before
they expire:

```sql
UPDATE platform_owners SET status = 'disabled', updated_at = now() WHERE username = 'owner';
DELETE FROM platform_owner_sessions
  WHERE owner_id = (SELECT id FROM platform_owners WHERE username = 'owner');

-- Sign every platform owner out:
DELETE FROM platform_owner_sessions;
```

Sign-in attempts are logged as one line each (`[platform-auth] ...`). The
password, the session token and, for a failed attempt, the submitted user name
are never logged.

## Tenant management

Platform owners create, review, edit, suspend and reactivate tenants at
`/platform/tenants`. Each tenant gets its own PostgreSQL database, its own
admin account and a subdomain; the design is in
[docs/tenant-management.md](docs/tenant-management.md).

| URL | What it is |
| --- | ---------- |
| `/platform/tenants` | list, search, status filter and counts |
| `/platform/tenants/new` | create a tenant |
| `/platform/tenants/<id>` | details, setup progress, suspend/reactivate, retry setup, credential actions |
| `/platform/tenants/<id>/edit` | edit profile, admin login and domains |

**Platform host**: `/platform/**` answers only on the platform's own host,
which is `PLATFORM_BASE_DOMAIN` itself, `localhost` or an IP address
([src/proxy.ts](src/proxy.ts)). On any other host it is a 404. In production,
reach the console on `PLATFORM_BASE_DOMAIN` itself, not on `www.` or `admin.`
(both are reserved subdomain labels anyway).

### Provisioning

Creating a tenant stores it as `pending` and starts setup in the background;
the details page shows the steps as they run. Setup:

1. creates a dedicated login role for the tenant: not a superuser, no
   `CREATEDB`/`CREATEROLE`/`BYPASSRLS`. It cannot connect to other tenants'
   databases or to the control plane;
2. creates the tenant's database (or checks an existing one, see below) and
   grants that role data privileges only: it does not own the tables;
3. installs the tenant schema (the migrations in `prisma/tenant/migrations`,
   recorded the way Prisma records them);
4. creates the tenant admin account in the tenant database;
5. checks the subdomain and signs in as the tenant role to verify.

Status goes `pending` -> `provisioning` -> `active`, or `failed` with a
message on the details page. **Retry setup** continues from the first step
that has not succeeded; every step is safe to repeat. Nothing is ever deleted:
not on failure, not on retry, and the module has no "delete tenant". A
database or role that this platform did not create is never touched.

The tenant's database password is generated (or entered) once, stored
encrypted in the control plane (see `TENANT_SECRETS_KEY` under
"Configuration") and never shown again. A generated master password for the
tenant admin is shown once, after creation, and not stored anywhere.

**Provisioning login**: setup and migrations connect as `POSTGRES_USER`, the
administrative login. Follow-up: replace it with a dedicated login that has
`CREATEDB` and `CREATEROLE` but is not a superuser.

**Using an existing database** (Manual entry only) requires:

- the database is on the same PostgreSQL server (`POSTGRES_HOST`; the port may
  differ);
- it is empty, or already holds this platform's tenant schema (only pending
  migrations are applied). Anything else is refused and left unmodified;
- the supplied login is not a superuser, has no `BYPASSRLS`, is not
  `POSTGRES_USER` and is not used by another tenant;
- the administrative login can connect to it and create in schema `public`.

"Test connection" on the create form runs these checks before anything is saved.

### Domains

Every tenant has a subdomain `<label>.<PLATFORM_BASE_DOMAIN>`. In development
that is `<label>.localhost:3000`: browsers resolve `*.localhost` to this
machine, so no DNS is needed. In production the app cannot do these itself:

- a wildcard DNS record `*.<PLATFORM_BASE_DOMAIN>` pointing to the reverse
  proxy;
- a wildcard TLS certificate for it at the reverse proxy.

A **custom domain** is optional and never blocks activation. It becomes active
once DNS has a TXT record `_md-verify.<host>` with the value
`md-verify=<token>` (both shown on the details page, with "Check DNS") and the
host itself resolves. Pointing the host at the proxy and its certificate are
the domain owner's and your hosting's job; the app creates no DNS records and
no certificates.

### Suspension and the tenant gate

Suspending requires a reason and takes effect at once: the tenant gate refuses
the tenant. Its database, files and domains are kept, and reactivating restores
access. Both are recorded in the status history (`audit_events`).

The gate is `getTenantAccess` in
[src/lib/domains/resolve.ts](src/lib/domains/resolve.ts): it maps the request
host to a tenant and allows only an `active` tenant whose schema is current.
**Every tenant-facing route must call `getTenantAccess`** and serve nothing
unless the result's `access` is `allowed`. Today the only tenant-facing page is `/`, which shows a
status message on a tenant host.

## pgAdmin

Open http://127.0.0.1:5050 and sign in with `PGADMIN_DEFAULT_EMAIL` and
`PGADMIN_DEFAULT_PASSWORD` from `.env`.

The server **Music Distribution (postgres)** is already registered. Click it
and enter `POSTGRES_PASSWORD` when asked (you can let pgAdmin save it). To
register it by hand instead, use *Register > Server* with:

| Field                | Value                              |
| -------------------- | ---------------------------------- |
| Host name/address    | `postgres` (**not** `localhost`)   |
| Port                 | `5432`                             |
| Maintenance database | value of `POSTGRES_DB`             |
| Username             | value of `POSTGRES_USER`           |
| Password             | value of `POSTGRES_PASSWORD`       |

pgAdmin runs in its own container, where `localhost` is pgAdmin itself. The
database is reached by its service name on the internal network, on its
internal port 5432 regardless of `POSTGRES_HOST_PORT`.

The `pgadmin_data` volume stores pgAdmin's own settings and saved connections.
It is not a database backup.

## Redis Insight

Open http://127.0.0.1:5540. On first use Redis Insight asks you to accept its
license terms. In development the connection **Music Distribution (redis)** is
preconfigured and is added as soon as the terms are accepted. To add it by hand
(always the case in production), choose *Add Redis database* with:

| Field    | Value                              |
| -------- | ---------------------------------- |
| Host     | `redis` (**not** `localhost`)      |
| Port     | `6379`                             |
| Username | leave empty                        |
| Password | value of `REDIS_PASSWORD`          |

Redis Insight has no login of its own. It is protected by network restriction:
its port is published on 127.0.0.1 only, and in production it does not run
unless you start it. For that reason the Redis password is preconfigured in
development only.

## Redis

Redis is provided as infrastructure. The application pings it for the
readiness check and keeps the platform owner sign-in attempt counters in it
(see "Platform owner sign-in").

**Persistence** is configured deliberately in
[docker/redis/redis.conf](docker/redis/redis.conf), not assumed from the
volume:

- **AOF** (`appendonly yes`, `appendfsync everysec`): every write is appended
  and synced once per second. A crash or power loss can lose about one second
  of writes at most. This is what Redis loads on startup.
- **RDB** snapshots (`save 3600 1 300 100 60 10000`) are written as well and
  are convenient to copy elsewhere.

Both are files on the `redis_data` volume. That protects against restarts and
crashes; it is not a backup, since losing the disk loses both.

**Memory**: `REDIS_MAXMEMORY` (default `256mb`) with `REDIS_MAXMEMORY_POLICY`
(default `noeviction`). With `noeviction`, a full Redis rejects writes with an
error rather than silently deleting keys, which is the safe default for
persisted data and for queues. If you use Redis purely as a cache, set the
policy to `allkeys-lru`.

## MinIO AIStor

[MinIO AIStor](https://docs.min.io/aistor/) is the S3-compatible object
storage for tenant assets and database backups (requirements: PRD §4.9–4.10,
TRD §6.3, §9, §14). This is phase 1: the service, its two platform buckets and
their identities. Per-tenant buckets, storage credentials and backups into
AIStor come in phase 2 (see [.vibe/memory/object-storage.md](.vibe/memory/object-storage.md)).

### License

AIStor does not start without a license file. The free tier (one node, no
support) is enough for development; whether it fits production is an open
decision (PRD D-12).

1. Request it at <https://www.min.io/pricing> (Free → Get Started) and download
   `minio.license`.
2. Put it in the project and restrict it to your user:

   ```bash
   mkdir -p minio && mv ~/Downloads/minio.license minio/minio.license && chmod 600 minio/minio.license
   ```

`minio/` is git-ignored and excluded from the app image's build context, and
in development the app container sees an empty `/app/minio`: only the
`aistor` service can read the license. Never commit or share it
(redistribution is prohibited). To keep it elsewhere, set
`AISTOR_LICENSE_FILE` (absolute, or relative to `docker/`).

### Setup

A new `.env` from `make init` already has the AIStor settings. An `.env`
created earlier lacks them and Compose refuses to start; append them by hand
(`make init` never overwrites a file):

```bash
printf '%s\n' "AISTOR_LICENSE_FILE=../minio/minio.license" "MINIO_ROOT_USER=$(openssl rand -hex 24)" "MINIO_ROOT_PASSWORD=$(openssl rand -hex 24)" "AISTOR_PLATFORM_ACCESS_KEY=md-platform" "AISTOR_PLATFORM_SECRET_KEY=$(openssl rand -hex 24)" "AISTOR_BACKUP_ACCESS_KEY=md-backup" "AISTOR_BACKUP_SECRET_KEY=$(openssl rand -hex 24)" "AISTOR_CONSOLE_PORT=9001" "AISTOR_HOST_PORT=9000" >> .env
```

Then run `make aistor-install`. It is safe to repeat and:

1. checks the settings and the license file (`make aistor-config-check`);
2. starts AIStor and waits until it is healthy;
3. creates the buckets, policies and identities below;
4. runs every check in `make aistor-validate`, including the smoke test.

| Bucket        | Owner tag             | Identity      | Policy (only this bucket)                 |
| ------------- | --------------------- | ------------- | ----------------------------------------- |
| `md-platform` | `md-owner=platform`   | `md-platform` | `md-platform-rw`: list, read, write, delete |
| `md-backups`  | `md-owner=backups`    | `md-backup`   | `md-backup-rw`: list, read, write; **no delete** |

No bucket allows anonymous access. The identities cannot reach each other's
bucket, create buckets or manage identities; `make aistor-validate` proves it
each time. The root login is for the Console and `make aistor-mc` only; the
app never receives it.

A bucket with one of these names that is tagged for someone else, or untagged
but holding objects, is never adopted: the install stops and changes nothing.
An identity holding another policy, or a disabled one, is reported, not changed.

### Access

- **Console**: `http://127.0.0.1:9001` (production: 127.0.0.1 only, through an
  SSH tunnel as for the GUIs). Log in with `MINIO_ROOT_USER` /
  `MINIO_ROOT_PASSWORD` from `.env`.
- **S3 API**: `aistor:9000` inside Docker; in development also
  `http://127.0.0.1:9000`. Production publishes no API port.
- `make aistor-mc` opens a shell with `mc` and the aliases `aistor` (root),
  `platform` and `backup`. Changes made there bypass the application.

The `make aistor-*` targets run in a one-off `aistor-admin` container built
from the same image (it bundles the matching `mc`), so the service secrets are
never part of the long-running server's environment, a command line or any
output.

## Persistent data

All state lives in named Docker volumes, prefixed with the Compose project
name `mdnext`:

| Volume                     | Contents                                   |
| -------------------------- | ------------------------------------------ |
| `mdnext_postgres_data`     | the PostgreSQL cluster                     |
| `mdnext_redis_data`        | Redis AOF and RDB files                    |
| `mdnext_pgadmin_data`      | pgAdmin settings and saved connections     |
| `mdnext_redisinsight_data` | Redis Insight settings and saved connections |
| `mdnext_aistor_data`       | AIStor objects, buckets, identities and policies |
| `mdnext_app_storage`       | production only: uploaded files (`STORAGE_ROOT`), i.e. tenant profile images |
| `mdnext_app_*`             | development only: dependencies and build cache |

In development uploaded files go to `storage/` in the project folder
(git-ignored) instead of a volume.

PostgreSQL 18 images keep data under `/var/lib/postgresql/18/docker`, so the
volume is mounted at `/var/lib/postgresql` (not `/var/lib/postgresql/data` as
in version 17 and earlier). PostgreSQL only initializes a data directory that
is empty; an existing one is never reinitialized.

**Safe**: these keep every volume.

- `make up`, `make stop`, `make restart`, `make down`
- `make build`, `make rebuild`, `make prod-build`, `make prod-deploy`
- `make prod-down`, `make prod-tools-down`
- `make aistor-install` and the other `make aistor-*` targets
- restarting Docker or the machine

**Destructive**: these delete data and are never run by any other command.

- `make destroy-data` deletes this project's volumes after you type
  `destroy mdnext`. Take a backup first.
- `docker compose ... down --volumes` and `docker volume rm` / `prune`, if you
  run them yourself.

The project name is set in `docker/compose.yaml`. Changing it (or setting
`COMPOSE_PROJECT_NAME`) makes Compose use a different, empty set of volumes;
the old ones are not deleted, just no longer attached.

## Backup and restore

Volumes are not backups. Take logical backups and copy them off the machine.

```bash
make backup
```

writes `backups/<database>_<UTC timestamp>.dump` (pg_dump custom format,
compressed), checks that `pg_restore` can read it back, and only then gives it
its final name. The directory and files are created private (700 / 600): a
backup contains all application data, so treat it like the database itself and
encrypt it wherever you store it. Schedule it with cron or your host's
scheduler; no scheduler is included.

What `make backup` covers today:

| Data | Backed up by `make backup` |
| ---- | -------------------------- |
| control-plane database (tenants, domains, audit events, encrypted tenant database passwords) | yes |
| each tenant's database | **no**: separate databases, dump each one yourself (`pg_dump -Fc <database>`) |
| PostgreSQL roles, including tenant logins | **no** (`pg_dumpall --roles-only`) |
| `app_storage` volume (tenant profile images) | **no**: copy the volume or `/app/storage` yourself |
| `TENANT_SECRETS_KEY` | **no**: keep it with your secrets; without it the stored tenant database passwords cannot be decrypted |
| Redis, pgAdmin and Redis Insight data | no |

`make restore` restores the control-plane database only.

```bash
make restore FILE=backups/music_distribution_20261013T165307Z.dump
```

Restore never overwrites in place:

1. The file is validated, and you confirm by typing the database name
   (or pass `CONFIRM=<database>` for scripts).
2. The backup is restored into a new staging database. If that fails, the
   staging database is removed and the live one is untouched.
3. Only then are the names swapped. Connections to the database, including the
   application's, are closed for the switch; the app reconnects by itself.
4. The previous database is kept as `<database>_before_restore_<timestamp>`.

When you are satisfied, drop the kept copy (the exact name is printed):

```bash
make psql
DROP DATABASE "music_distribution_before_restore_20261013165331";   -- inside psql
```

### Undoing a restore

```bash
make stop s=app
make psql db=postgres
```

```sql
ALTER DATABASE "music_distribution" RENAME TO "music_distribution_discarded";
ALTER DATABASE "music_distribution_before_restore_20261013165331" RENAME TO "music_distribution";
```

```bash
make up
```

If a rename reports that the database is being accessed by other users, close
the other sessions (for example a pgAdmin query window) and repeat it.

A backup you have never restored is unproven. Test a restore periodically,
ideally on another machine.

## Production

The production stack is the same base file with a different override
([docker/compose.prod.yaml](docker/compose.prod.yaml)). It needs a single host
with Docker; no Kubernetes or Swarm.

What changes compared with development:

- The app runs the optimized standalone build (`node server.js`), as a
  non-root user, on a read-only filesystem, with all capabilities dropped and
  `no-new-privileges`. The image contains no dev dependencies, source, env
  files or secrets.
- PostgreSQL and Redis publish **no** host ports. Redis also runs read-only
  with all capabilities dropped.
- AIStor publishes only its Console, on `127.0.0.1`, and runs read-only with
  all capabilities dropped and `no-new-privileges` (verified with this image).
- pgAdmin and Redis Insight do not start unless you ask for them.
- The app is published on `127.0.0.1` only. CPU and memory limits apply.
- Migrations and the seed run from a separate image (`<tag>-migrate`) that
  holds the Prisma CLI, the migration files and the seed script. It is a
  one-off job, never part of the running stack.

### Before the first deployment

1. `make init` on the server, then edit `.env`. The generated secrets are
   suitable; set a real `PGADMIN_DEFAULT_EMAIL`. Keep the file at mode 600. If
   your host offers a secret manager, inject these values as environment
   variables from it instead of keeping them in a file.
2. Leave `APP_BIND_ADDRESS=127.0.0.1` and put a reverse proxy (Caddy, nginx,
   Traefik or your provider's load balancer) on the host to terminate HTTPS and
   forward to `127.0.0.1:3000`. TLS is not handled by this stack.
3. Do not publish the app on `0.0.0.0` unless something in front of it filters
   traffic. Ports published by Docker bypass host firewalls such as `ufw`.
4. Review the resource limits in `.env.example` and, if you raise the
   PostgreSQL memory limit, `shared_buffers` in
   [docker/postgres/postgresql.conf](docker/postgres/postgresql.conf).
5. Arrange off-host backups (see above) and test a restore.
6. Check `PLATFORM_OWNER_INITIAL_USERNAME` and `PLATFORM_OWNER_INITIAL_PASSWORD`
   in `.env`. On the first deployment, after `make prod-build` and
   `make prod-migrate` (see "Deploy"), create the platform owner account with
   `make prod-seed`. It is needed once; see "Platform owner account".
7. Put the AIStor license on the server (see "MinIO AIStor") and run
   `make aistor-install MODE=prod` once. AIStor runs as the container's root
   user without capabilities, so on Linux the license file must be readable by
   root as it is: owned by root (`sudo chown root:root minio/minio.license`,
   mode 600) or mode 644. Confirm the license tier for production first
   (PRD D-12).

### Deploy

```bash
make prod-build         # the app image and its migration image
make prod-migrate       # apply pending database migrations
make prod-seed          # first deployment only: create the platform owner
make prod-up
make prod-health
```

`make prod-deploy` is `prod-build` followed by `prod-up`; it does not run
migrations or the seed.

Each build is tagged `mdnext-app:<git short SHA>`, or `local` when the project
is not a git repository. `make prod-up` only starts an application image that
already exists locally; it never builds one implicitly, so what runs is always
a tag you chose. To build elsewhere and pull on the server, use
`APP_IMAGE=<registry>/<name>` for both `prod-build` and `prod-up`, and
push/pull the image yourself.

Database data is untouched by `prod-build` and `prod-up`. Migrations are a
separate, deliberate step: `make prod-migrate` starts PostgreSQL if needed,
applies what is pending (see "Applying migrations") and exits. Run it before
`prod-up`, so the new application code never meets an old schema, and take a
backup first. Because the previous application version keeps running until
`prod-up`, write migrations it can tolerate: add first, remove in a later
release.

### Roll back

```bash
make prod-images                  # tags available on this host
make prod-up APP_TAG=<previous>   # start the previous image
```

This rolls back the application only. Migrations are not reversed: Prisma has
no down migrations. Rolling back the schema or data means restoring a backup,
or writing a new migration that undoes the change.

### Management GUIs in production

```bash
make prod-tools-up      # pgAdmin on 127.0.0.1:5050, Redis Insight on 127.0.0.1:5540
make prod-tools-down    # remove them again; their settings are kept
```

They listen on the server's loopback interface only. Reach them through an SSH
tunnel and stop them when you are done:

```bash
ssh -L 5050:127.0.0.1:5050 -L 5540:127.0.0.1:5540 user@server
```

### Stop

```bash
make prod-down          # keeps all volumes
```

### Operations notes

- **Restarts**: services use `restart: unless-stopped`, so they come back after
  a crash or reboot (Docker must be enabled at boot). Docker spaces out
  repeated restarts with an increasing delay. A service that keeps failing
  shows as `restarting` in `make prod-ps`; read `make prod-logs s=<service>`.
- **Logs** go to Docker's `json-file` driver, capped at 5 files of 10 MB per
  container. Ship them elsewhere if you need longer retention. PostgreSQL logs
  the full text of statements slower than one second, which can include
  personal data; adjust `log_min_duration_statement` if that matters to you.
- **Updates**: to upgrade an image, change its tag and digest together
  (`docker buildx imagetools inspect <image>:<tag>` prints the digest), then
  redeploy. A PostgreSQL **major** upgrade is not a tag change: it needs a
  dump and restore or `pg_upgrade`.
- **One stack per host**: development and production share the project name
  and therefore the volumes. Do not run both on the same machine against data
  you care about.
- **Scaling**: each app instance holds up to `POSTGRES_POOL_MAX` connections
  to the control plane, plus up to `POSTGRES_TENANT_POOL_MAX` for each tenant
  with requests in flight. Tenant connections are closed after 10 seconds
  idle, so the total follows the number of tenants active at the same moment,
  not the number of tenants. Keep instances x (pool + busy tenants x tenant
  pool) below PostgreSQL's `max_connections` (100), or put a connection pooler
  in front as the tenant count grows.
- **Database role**: the app currently connects to the control plane as
  `POSTGRES_USER`, which the official image creates as a superuser. That is
  acceptable while the only query is the readiness check (`SELECT 1`). Before
  adding real queries, create a least-privilege application role and keep the
  superuser for administration, provisioning and migrations only.

### Not covered here

These depend on your hosting and are not configured by this repository: DNS and
TLS certificates, the reverse proxy, host firewall rules, OS and Docker
updates, off-host backup storage and scheduling (including copies of what is
stored in AIStor), monitoring and alerting, and high availability (this is a
single-host setup with a single-drive AIStor; a managed PostgreSQL or Redis
would replace the corresponding service).

## Troubleshooting

| Symptom | Cause and fix |
| ------- | ------------- |
| `'.env' not found` | Run `make init`. |
| `Port NNNN (...) is already in use` | Something else holds that host port. Set the named variable in `.env` to a free port, or stop the other process. `make ports` repeats the check. |
| `required variable ... is missing a value` | A required setting is absent from `.env`; compare with `.env.example`. |
| App exits with `Invalid environment configuration` | Fix the variables it lists, then `make up`. |
| `/api/health/ready` returns 503 | The app cannot reach PostgreSQL or Redis. `make health`, then `make logs s=app`. Usually a password in `.env` that no longer matches the data volume (see "Credentials"). |
| `password authentication failed` | `.env` was changed after the volume was initialized. See "Credentials". |
| pgAdmin cannot connect using `localhost` | Use host `postgres`, port `5432`. |
| Redis Insight cannot connect using `localhost` | Use host `redis`, port `6379`. |
| pgAdmin refuses to start over the email address | Reserved domains such as `.local` are rejected; use a normal address. |
| `permission denied` talking to Docker | Use `DOCKER="sudo docker"`, or add your user to the `docker` group. |
| `required variable MINIO_ROOT_USER ...` (or another AIStor variable) | `.env` predates AIStor; append the block from "MinIO AIStor", then `make aistor-install`. |
| `license file not found` / AIStor exits at start | Put the license at `minio/minio.license` (or set `AISTOR_LICENSE_FILE`); `make aistor-config-check` names the problem. On Linux production, see "Before the first deployment" step 7. |
| `bucket '...' exists but is not ours` | A bucket with that name holds data or another owner's tag; `make aistor-bucket-inspect bucket=<name>`, then decide by hand. Nothing was changed. |
| AIStor Console login fails | Use `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` from `.env` (the generated user name is a long random value, not `minioadmin`). |
| Edits do not trigger a reload | See "Hot reload". |
| `Cannot connect to the Docker daemon` | Start Docker Desktop / the Docker service. |
| `image 'mdnext-app:...' not found locally` | Run `make prod-build` (or pull the image) before `make prod-up`. |
| A new dependency is missing in the container | `make restart s=app` reinstalls when the lockfile changed. |
| `Cannot find module '@/generated/prisma/...'` | The Prisma clients have not been generated: `make db-generate`. |
| A new model or column is missing at runtime | The dev server still holds the old Prisma client: `make restart s=app`. |
| `The table ... does not exist` | Migrations are pending: `make db-migrate`. |
| `make db-migration` stops, saying the environment is non-interactive | The change needs a confirmation (it would lose data). Run it from a terminal. |
