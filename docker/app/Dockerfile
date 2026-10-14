# Next.js application image. Build context is the repository root.
#
#   dev       source is bind-mounted; dependencies live in a named volume
#   runner    optimized production build, non-root, no dev dependencies
#   migrator  one-off job that applies database migrations (make prod-migrate)
#
# The base image is pinned by tag AND digest. To upgrade, change both:
#   docker buildx imagetools inspect node:<version>-trixie-slim
ARG NODE_IMAGE=node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66

FROM ${NODE_IMAGE} AS base
# CHECKPOINT_DISABLE stops the Prisma CLI from contacting its update server.
ENV NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1
WORKDIR /app

# --- Development -------------------------------------------------------------
FROM base AS dev
ENV NODE_ENV=development
# Pre-create the volume mount points owned by the unprivileged user so new
# named volumes inherit that ownership.
RUN mkdir -p /app/node_modules /app/.next /home/node/.npm \
    && chown -R node:node /app /home/node/.npm
COPY --chmod=0755 docker/app/dev-entrypoint.sh /usr/local/bin/dev-entrypoint
USER node
EXPOSE 3000
ENTRYPOINT ["dev-entrypoint"]
CMD ["node_modules/.bin/next", "dev", "--hostname", "0.0.0.0", "--port", "3000"]

# --- Dependencies (all, needed to build) -------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# --- Build -------------------------------------------------------------------
FROM base AS builder
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No secrets are needed or available here; runtime config is validated at startup.
# The Prisma clients are generated code, so they are built from the schemas first.
RUN npm run db:generate && npm run build

# --- Production runtime ------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# The standalone output contains the server plus only the production
# dependencies it actually imports.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]

# --- Migrations (one-off job) ------------------------------------------------
# The Prisma CLI, the migration files, the tenant migration script and the seed
# script (make prod-seed). Needs the full dependency set, which is why it is not
# part of the runner image.
FROM base AS migrator
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY prisma ./prisma
# prisma/seed.ts imports the user name rules and the password hashing from here.
COPY src/lib/platform-auth ./src/lib/platform-auth
RUN npm run db:generate
USER node
CMD ["npm", "run", "db:deploy"]
