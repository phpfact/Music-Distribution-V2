# Everyday commands for the Docker stack. Run `make` (or `make help`) for a list.
#
# If Docker needs elevated privileges on your machine, prefix any command with
# sudo: `sudo make up`, `sudo make down`, `sudo make sh`. sudo is never added here.
#
# Variables you can pass on the command line:
#   s=<service>      limit a command to one service: app postgres redis aistor pgadmin redisinsight
#   MODE=dev|prod    which Compose override to use (default: dev)
#   ENV_FILE=<path>  environment file (default: .env; the path must not contain spaces)
#   DOCKER=<cmd>     docker binary, e.g. DOCKER="sudo docker" if your user needs sudo
#   FILE=<path>      backup file for `make restore`
#   db=<name>        database for `make psql` (default: the application database)
#   name=<words>     migration name for `make db-migration` / `make tenant-migration`
#   bucket=<name>    bucket for `make aistor-bucket-inspect`
#   APP_IMAGE=<name> production image name (default: mdnext-app)
#   APP_TAG=<tag>    production image tag (default: git short SHA, or "local")

SHELL := /bin/bash
.DEFAULT_GOAL := help

DOCKER   ?= docker
ENV_FILE ?= .env
MODE     ?= dev

ifeq ($(filter $(MODE),dev prod),)
$(error MODE must be 'dev' or 'prod' (got '$(MODE)'))
endif

# Production image name and tag: one immutable tag per commit, which is what
# makes rollback possible. Set these on the command line, not in the env file
# (values exported from here take precedence over the env file).
APP_IMAGE ?= mdnext-app
APP_TAG   ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo local)

COMPOSE := $(DOCKER) compose --env-file $(ENV_FILE) -f docker/compose.yaml -f docker/compose.$(MODE).yaml
# Same, including the optional GUIs that sit behind the "tools" profile in production.
COMPOSE_ALL := $(COMPOSE) --profile tools

export COMPOSE DOCKER ENV_FILE MODE APP_IMAGE APP_TAG

# Host ports to check before starting (VAR:default, defaults as in the Compose files).
DEV_PORTS   := APP_PORT:3000 POSTGRES_HOST_PORT:5433 REDIS_HOST_PORT:6380 AISTOR_HOST_PORT:9000 AISTOR_CONSOLE_PORT:9001 PGADMIN_PORT:5050 REDISINSIGHT_PORT:5540
PROD_PORTS  := APP_PORT:3000 AISTOR_CONSOLE_PORT:9001
TOOLS_PORTS := PGADMIN_PORT:5050 REDISINSIGHT_PORT:5540

SCRIPTS := docker/scripts

.PHONY: help init up down stop restart build rebuild ps logs urls ports validate \
        sh db-sh psql redis-cli typecheck lint check test health backup restore \
        db-generate db-migration tenant-migration db-migrate db-status prod-migrate \
        db-seed db-rotate-owner-password prod-seed \
        prod-build prod-up prod-deploy prod-down prod-restart prod-ps prod-logs \
        prod-health prod-images prod-tools-up prod-tools-down destroy-data \
        aistor-install aistor-config-check aistor-health aistor-mc aistor-buckets \
        aistor-bucket-inspect aistor-smoke aistor-usage aistor-validate \
        _require-env _require-dev

##@ Getting started

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"} \
		/^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0, 5); next} \
		/^[a-zA-Z0-9_-]+:.*##/ {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@printf '\nOptions: s=<service>  MODE=dev|prod  ENV_FILE=<path>  DOCKER="sudo docker"  FILE=<backup>\n'
	@printf 'Examples: make logs s=app    make restart s=redis    make restore FILE=backups/x.dump\n'
	@printf 'Needs sudo for Docker? Prefix the command: sudo make up, sudo make down, sudo make sh\n\n'

init: ## Create .env from .env.example with generated secrets (never overwrites)
	@$(SCRIPTS)/init-env.sh .env.example $(ENV_FILE)

##@ Development stack

up: _require-env ports aistor-config-check ## Start the stack in the background and wait until it is healthy
	@if [ "$(MODE)" = "prod" ]; then \
		$(DOCKER) image inspect "$(APP_IMAGE):$(APP_TAG)" >/dev/null 2>&1 \
			|| { echo "error: image '$(APP_IMAGE):$(APP_TAG)' not found locally. Build it (make prod-build) or pull it first."; exit 1; }; \
	fi
	@$(COMPOSE) up -d --wait --wait-timeout 600 $(if $(filter prod,$(MODE)),--no-build,) \
		|| { echo; echo "Startup failed or timed out. Inspect with: make ps / make logs s=<service>"; exit 1; }
	@$(MAKE) --no-print-directory urls

down: _require-env ## Stop and remove containers and the network. KEEPS all data volumes
	@$(COMPOSE_ALL) down

stop: _require-env ## Stop containers without removing them (s=<service> for one)
	@$(COMPOSE_ALL) stop $(s)

restart: _require-env ## Restart all services, or one with s=<service>
	@$(COMPOSE_ALL) restart $(s)

build: _require-env ## Build the application image (data volumes are not affected)
	@$(COMPOSE) $(if $(filter prod,$(MODE)),--profile migrate build app migrate,build app)

rebuild: build up ## Build the application image, then start/update the stack

ps: _require-env ## Show service status
	@$(COMPOSE_ALL) ps -a

logs: _require-env ## Follow logs for all services, or one with s=<service>
	@$(COMPOSE_ALL) logs -f --tail=100 $(s)

urls: _require-env ## Print the local addresses of the running web interfaces
	@printf '\n'
	@a=$$($(COMPOSE) port app 3000 2>/dev/null); [ -z "$$a" ] || printf '  %-15s http://%s\n' "Application" "$$a"
	@a=$$($(COMPOSE_ALL) port pgadmin 8080 2>/dev/null); [ -z "$$a" ] || printf '  %-15s http://%s\n' "pgAdmin" "$$a"
	@a=$$($(COMPOSE_ALL) port redisinsight 5540 2>/dev/null); [ -z "$$a" ] || printf '  %-15s http://%s\n' "Redis Insight" "$$a"
	@a=$$($(COMPOSE) port aistor 9001 2>/dev/null); [ -z "$$a" ] || printf '  %-15s http://%s\n' "AIStor Console" "$$a"
	@a=$$($(COMPOSE) port aistor 9000 2>/dev/null); [ -z "$$a" ] || printf '  %-15s http://%s\n' "AIStor S3 API" "$$a"
	@printf '\n'

ports: _require-env ## Check that the host ports this stack needs are free
	@$(SCRIPTS)/check-ports.sh $(if $(filter prod,$(MODE)),$(PROD_PORTS),$(DEV_PORTS))

validate: _require-env ## Validate the Compose configuration without starting anything
	@$(COMPOSE) config --quiet && echo "Compose configuration for MODE=$(MODE) is valid."

##@ Shells

sh: _require-env ## Open a shell in the application container
	@$(COMPOSE) exec app sh

db-sh: _require-env ## Open a shell in the PostgreSQL container
	@$(COMPOSE) exec postgres bash

psql: _require-env ## Open psql on the application database (db=<name> for another one)
	@$(COMPOSE) exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$${1:-$$POSTGRES_DB}"' sh $(db)

redis-cli: _require-env ## Open an authenticated redis-cli session
	@$(COMPOSE) exec redis redis-cli

##@ Code quality (development stack must be running)

typecheck: _require-dev ## Run the TypeScript compiler in check mode
	@$(COMPOSE) exec -T app npm run typecheck

lint: _require-dev ## Run ESLint
	@$(COMPOSE) exec -T app npm run lint

check: lint typecheck ## Run lint and typecheck

test: _require-dev ## Run the automated tests (uses a scratch database and the running dev server)
	@$(COMPOSE) exec -T app npm test

##@ Database schema (Prisma)

db-generate: _require-dev ## Regenerate the Prisma clients after editing a schema
	@$(COMPOSE) exec -T app npm run --silent db:generate

db-migration: _require-dev ## Create and apply a control-plane migration: make db-migration name=<what_changed>
	@NAME="$(name)" $(SCRIPTS)/migration.sh control

tenant-migration: _require-dev ## Create a tenant migration (applied to a scratch database): name=<what_changed>
	@NAME="$(name)" $(SCRIPTS)/migration.sh tenant

db-migrate: _require-env ## Apply pending migrations: control plane, then every tenant database
	@if [ "$(MODE)" = "prod" ]; then \
		$(DOCKER) image inspect "$(APP_IMAGE):$(APP_TAG)-migrate" >/dev/null 2>&1 \
			|| { echo "error: image '$(APP_IMAGE):$(APP_TAG)-migrate' not found locally. Build it (make prod-build) or pull it first."; exit 1; }; \
		$(COMPOSE) --profile migrate run --rm migrate; \
	else \
		$(COMPOSE) exec -T app npm run --silent db:deploy; \
	fi

db-status: _require-dev ## Show which control-plane migrations are applied
	@$(COMPOSE) exec -T app npm run --silent db:control:status

db-seed: _require-env ## Create the initial platform owner if none exists
	@$(SCRIPTS)/seed.sh create

db-rotate-owner-password: _require-env ## Set the platform owner's password from the env file; revokes its sessions
	@$(SCRIPTS)/seed.sh rotate

##@ Health and data

health: _require-env ## Show service health and the app's dependency checks
	@$(SCRIPTS)/health.sh

backup: _require-env ## Dump the database to backups/<db>_<UTC time>.dump
	@$(SCRIPTS)/pg-backup.sh

restore: _require-env ## Restore a dump: make restore FILE=backups/<name>.dump (asks to confirm)
	@FILE="$(FILE)" $(SCRIPTS)/pg-restore.sh

##@ Object storage (MinIO AIStor; every command also works with MODE=prod)

aistor-install: _require-env ## First-time AIStor setup: start it, create buckets and identities, validate (safe to repeat)
	@$(SCRIPTS)/aistor.sh install

aistor-config-check: _require-env ## Check the AIStor settings and license file without starting anything
	@$(SCRIPTS)/aistor.sh config-check

aistor-health: _require-env ## AIStor health probes, license plan and drive status
	@$(SCRIPTS)/aistor.sh health

aistor-mc: _require-env ## Admin shell with mc (aliases: aistor = root, platform, backup)
	@$(SCRIPTS)/aistor.sh shell

aistor-buckets: _require-env ## List buckets with owner tag, anonymous access and usage
	@$(SCRIPTS)/aistor.sh buckets

aistor-bucket-inspect: _require-env ## Details of one bucket: make aistor-bucket-inspect bucket=<name>
	@BUCKET="$(bucket)" $(SCRIPTS)/aistor.sh inspect

aistor-smoke: _require-env ## Upload/download/delete round trip with the platform and backup identities
	@$(SCRIPTS)/aistor.sh smoke

aistor-usage: _require-env ## Storage usage, drive capacity and AIStor container resources
	@$(SCRIPTS)/aistor.sh usage

aistor-validate: _require-env ## Check buckets, tags, permissions and isolation, then run the smoke test
	@$(SCRIPTS)/aistor.sh validate

##@ Production (same commands with MODE=prod)

prod-build: ## Build the production image and its migration image, tagged with APP_TAG
	@$(MAKE) --no-print-directory MODE=prod build
	@echo "Built production images: $(APP_IMAGE):$(APP_TAG) and $(APP_IMAGE):$(APP_TAG)-migrate"

prod-migrate: ## Apply pending database migrations in production (run before prod-up)
	@$(MAKE) --no-print-directory MODE=prod db-migrate

prod-seed: ## Create the initial platform owner in production if none exists (after prod-migrate)
	@$(MAKE) --no-print-directory MODE=prod db-seed

prod-up: ## Start the production stack using the image tagged APP_TAG
	@$(MAKE) --no-print-directory MODE=prod up

prod-deploy: prod-build prod-up ## Build the production image, then start/update the stack

prod-down: ## Stop the production stack. KEEPS all data volumes
	@$(MAKE) --no-print-directory MODE=prod down

prod-restart: ## Restart production services (s=<service> for one)
	@$(MAKE) --no-print-directory MODE=prod restart s=$(s)

prod-ps: ## Show production service status
	@$(MAKE) --no-print-directory MODE=prod ps

prod-logs: ## Follow production logs (s=<service> for one)
	@$(MAKE) --no-print-directory MODE=prod logs s=$(s)

prod-health: ## Show production service health
	@$(MAKE) --no-print-directory MODE=prod health

prod-images: ## List locally available production image tags (for rollback)
	@$(DOCKER) image ls --format 'table {{.Repository}}\t{{.Tag}}\t{{.CreatedSince}}\t{{.Size}}' "$(APP_IMAGE)"

prod-tools-up: _require-env ## Start pgAdmin and Redis Insight in production (127.0.0.1 only)
	@$(MAKE) --no-print-directory MODE=prod _tools-up

prod-tools-down: _require-env ## Stop and remove the production GUIs (keeps their settings)
	@$(MAKE) --no-print-directory MODE=prod _tools-down

##@ Danger zone

destroy-data: _require-env ## PERMANENTLY delete this stack's volumes (typed confirmation required)
	@$(SCRIPTS)/destroy-data.sh

# --- Internal targets ---------------------------------------------------------

.PHONY: _tools-up _tools-down

_tools-up:
	@$(SCRIPTS)/check-ports.sh $(TOOLS_PORTS)
	@$(COMPOSE_ALL) up -d --wait --wait-timeout 300 pgadmin redisinsight
	@$(MAKE) --no-print-directory urls

_tools-down:
	@$(COMPOSE_ALL) rm --stop --force pgadmin redisinsight

_require-env:
	@[ -f "$(ENV_FILE)" ] || { echo "error: '$(ENV_FILE)' not found. Create it with: make init"; exit 1; }

_require-dev: _require-env
	@[ "$(MODE)" = "dev" ] || { echo "error: this command only works with the development stack (MODE=dev)."; exit 1; }
