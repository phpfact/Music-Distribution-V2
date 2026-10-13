# Music Distribution

Infrastructure foundation: a minimal Next.js application with PostgreSQL, pgAdmin,
Redis and Redis Insight, all run through Docker for both local development and
production. It contains no product features yet.

## Stack

| Component     | Version                 | Notes                                               |
| ------------- | ----------------------- | --------------------------------------------------- |
| Next.js       | 16.4.0 (App Router)     | Turbopack, `output: "standalone"`                   |
| React         | 19.3.0                  |                                                     |
| Node.js       | 24.21.0 LTS             | `node:24.21.0-trixie-slim`                          |
| TypeScript    | 6.0.3 (strict)          | See "Version constraints"                           |
| Tailwind CSS  | 4.3.3                   | via `@tailwindcss/postcss`                          |
| ESLint        | 9.39.5                  | See "Version constraints"                           |
| PostgreSQL    | 18.6                    |                                                     |
| pgAdmin       | 9.18                    |                                                     |
| Redis         | 8.10.2                  | AOF + RDB persistence                               |
| Redis Insight | 3.8.0                   |                                                     |

Every container image is pinned by tag **and** digest in
[docker/compose.yaml](docker/compose.yaml) and
[docker/app/Dockerfile](docker/app/Dockerfile). npm packages are pinned by
[package-lock.json](package-lock.json).

### Version constraints

Two packages are deliberately not on their newest major. Revisit both when
upgrading `eslint-config-next`:

- **TypeScript 6.0.3, not 7.x.** `typescript-eslint` 8.x (a dependency of
  `eslint-config-next` 16.4) supports `typescript <6.1.0`.
- **ESLint 9.39.5, not 10.x.** `eslint-plugin-react`, `eslint-plugin-import` and
  `eslint-plugin-jsx-a11y` (all pulled in by `eslint-config-next` 16.4) do not
  declare ESLint 10 support. npm prints a notice that ESLint 9 is no longer
  maintained; it is a development-only tool and is not in the production image.

## Requirements

- Docker Engine 25 or newer with the Compose plugin v2.24 or newer
  (developed and tested on Engine 29.1.3, Compose 2.40.3, macOS arm64)
- GNU Make 3.81 or newer, and `bash`
- Node.js is **not** needed on the host; everything runs in containers

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

```bash
make init     # creates .env from .env.example with generated random secrets
make up       # checks ports, builds, starts everything, waits until healthy
```

| Interface     | Address                 | Login                                              |
| ------------- | ----------------------- | -------------------------------------------------- |
| Application   | http://127.0.0.1:3000   | none                                               |
| pgAdmin       | http://127.0.0.1:5050   | `PGADMIN_DEFAULT_EMAIL` / `PGADMIN_DEFAULT_PASSWORD` from `.env` |
| Redis Insight | http://127.0.0.1:5540   | none (reachable from this machine only)            |

`make urls` prints the actual addresses, `make down` stops everything and keeps
all data, and `make` on its own lists every command.

The first start takes longer: it builds the dev image and installs
dependencies into a volume. Later starts take a few seconds.

## Layout

```
src/                     Next.js application (App Router)
  app/api/health/        liveness (/api/health) and readiness (/api/health/ready)
  lib/env.ts             runtime configuration and validation
  lib/postgres.ts        bounded connection pool
  lib/redis.ts           shared Redis client
docker/
  compose.yaml           base stack, shared by both environments
  compose.dev.yaml       development override (hot reload, host ports)
  compose.prod.yaml      production override (hardened, no database ports)
  app/                   Dockerfile, its .dockerignore, dev entrypoint
  postgres/              postgresql.conf
  redis/                 redis.conf
  scripts/               logic behind the Makefile targets
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
| `POSTGRES_POOL_MAX`                        | max connections per app instance (default 10)   | 1 to 100 |
| `REDIS_PASSWORD`                           | Redis password (**secret**)                     | applied on every start |
| `REDIS_MAXMEMORY`, `REDIS_MAXMEMORY_POLICY`| memory cap and eviction policy                  | see "Redis" |
| `PGADMIN_DEFAULT_EMAIL`, `PGADMIN_DEFAULT_PASSWORD` | initial pgAdmin login (**secret**)     | applied on first initialization only |
| `APP_BIND_ADDRESS`, `APP_PORT`             | where the app is published on the host          | default `127.0.0.1:3000` |
| `PGADMIN_PORT`, `REDISINSIGHT_PORT`        | GUI ports, always on 127.0.0.1                  | 5050, 5540 |
| `POSTGRES_HOST_PORT`, `REDIS_HOST_PORT`    | **development only**, always on 127.0.0.1       | 5433, 6380 |
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
| `make backup` / `make restore FILE=...` | database backup and restore                             |
| `make ports` / `make validate`  | check host ports / validate the Compose configuration           |
| `make prod-build` / `prod-up` / `prod-deploy` / `prod-down` | production image and stack         |
| `make prod-ps` / `prod-logs` / `prod-health` / `prod-restart` / `prod-images` | production status   |
| `make prod-tools-up` / `prod-tools-down` | start or remove the GUIs in production                 |
| `make destroy-data`             | **permanently delete** this stack's volumes (typed confirmation) |

Services are `app`, `postgres`, `redis`, `pgadmin` and `redisinsight`.

Options: `s=<service>`, `MODE=dev|prod`, `ENV_FILE=<path>` (no spaces),
`DOCKER="sudo docker"`, `FILE=<backup>`, `db=<database>`, `APP_IMAGE=<name>`,
`APP_TAG=<tag>`. Every generic command also works for production with
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
Insight start only after the service they depend on reports healthy. Nothing
depends on the two GUIs, so the app keeps running if one of them is down.

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

Redis is provided as infrastructure; the application only pings it for the
readiness check.

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

## Persistent data

All state lives in named Docker volumes, prefixed with the Compose project
name `mdnext`:

| Volume                     | Contents                                   |
| -------------------------- | ------------------------------------------ |
| `mdnext_postgres_data`     | the PostgreSQL cluster                     |
| `mdnext_redis_data`        | Redis AOF and RDB files                    |
| `mdnext_pgadmin_data`      | pgAdmin settings and saved connections     |
| `mdnext_redisinsight_data` | Redis Insight settings and saved connections |
| `mdnext_app_*`             | development only: dependencies and build cache |

PostgreSQL 18 images keep data under `/var/lib/postgresql/18/docker`, so the
volume is mounted at `/var/lib/postgresql` (not `/var/lib/postgresql/data` as
in version 17 and earlier). PostgreSQL only initializes a data directory that
is empty; an existing one is never reinitialized.

**Safe**: these keep every volume.

- `make up`, `make stop`, `make restart`, `make down`
- `make build`, `make rebuild`, `make prod-build`, `make prod-deploy`
- `make prod-down`, `make prod-tools-down`
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
encrypt it wherever you store it. It covers the application database only, not
roles or pgAdmin settings. Schedule it with cron or your host's scheduler; no
scheduler is included.

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
- pgAdmin and Redis Insight do not start unless you ask for them.
- The app is published on `127.0.0.1` only. CPU and memory limits apply.

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

### Deploy

```bash
make prod-deploy        # = make prod-build, then make prod-up
make prod-health
```

Each build is tagged `mdnext-app:<git short SHA>`, or `local` when the project
is not a git repository. `make prod-up` only starts an application image that
already exists locally; it never builds one implicitly, so what runs is always
a tag you chose. To build elsewhere and pull on the server, use
`APP_IMAGE=<registry>/<name>` for both `prod-build` and `prod-up`, and
push/pull the image yourself.

Database data is untouched by a deployment. No migrations exist yet; when they
do, running them is a separate, deliberate step.

### Roll back

```bash
make prod-images                  # tags available on this host
make prod-up APP_TAG=<previous>   # start the previous image
```

This rolls back the application only. Rolling back data means restoring a
backup.

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
- **Scaling**: each app instance holds up to `POSTGRES_POOL_MAX` connections;
  keep instances x pool size below PostgreSQL's `max_connections` (100).
- **Database role**: the app currently connects as `POSTGRES_USER`, which the
  official image creates as a superuser. That is acceptable while the only
  query is the readiness check (`SELECT 1`). Before adding real queries,
  create a least-privilege application role and keep the superuser for
  administration and provisioning only.

### Not covered here

These depend on your hosting and are not configured by this repository: DNS and
TLS certificates, the reverse proxy, host firewall rules, OS and Docker
updates, off-host backup storage and scheduling, monitoring and alerting, and
high availability (this is a single-host setup; a managed PostgreSQL or Redis
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
| Edits do not trigger a reload | See "Hot reload". |
| `Cannot connect to the Docker daemon` | Start Docker Desktop / the Docker service. |
| `image 'mdnext-app:...' not found locally` | Run `make prod-build` (or pull the image) before `make prod-up`. |
| A new dependency is missing in the container | `make restart s=app` reinstalls when the lockfile changed. |
