-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('pending', 'provisioning', 'active', 'failed', 'suspended', 'deprovisioning');

-- CreateEnum
CREATE TYPE "tenant_schema_status" AS ENUM ('pending', 'current', 'failed');

-- CreateEnum
CREATE TYPE "tenant_domain_type" AS ENUM ('subdomain', 'custom');

-- CreateEnum
CREATE TYPE "provisioning_run_status" AS ENUM ('running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "provisioning_step" AS ENUM ('create_database', 'create_database_user', 'grant_privileges', 'apply_migrations', 'create_initial_admin', 'register_domain', 'verify');

-- CreateEnum
CREATE TYPE "audit_actor_type" AS ENUM ('system', 'super_admin', 'tenant_user');

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(63) NOT NULL,
    "status" "tenant_status" NOT NULL DEFAULT 'pending',
    "status_reason" VARCHAR(500),
    "contact_email" VARCHAR(320) NOT NULL,
    "plan_id" UUID NOT NULL,
    "database_name" VARCHAR(63),
    "database_user" VARCHAR(63),
    "database_secret_ref" VARCHAR(255),
    "schema_status" "tenant_schema_status" NOT NULL DEFAULT 'pending',
    "schema_version" VARCHAR(255),
    "schema_migrated_at" TIMESTAMPTZ(3),
    "activated_at" TIMESTAMPTZ(3),
    "suspended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_domains" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "tenant_domain_type" NOT NULL DEFAULT 'subdomain',
    "hostname" VARCHAR(253) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_provisioning_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "provisioning_run_status" NOT NULL DEFAULT 'running',
    "step" "provisioning_step",
    "error_code" VARCHAR(100),
    "error_message" VARCHAR(500),
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "tenant_provisioning_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_type" "audit_actor_type" NOT NULL,
    "actor_id" VARCHAR(100),
    "tenant_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "target_type" VARCHAR(100),
    "target_id" VARCHAR(100),
    "metadata" JSONB,
    "ip_address" INET,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_database_name_key" ON "tenants"("database_name");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_database_user_key" ON "tenants"("database_user");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "tenants_plan_id_idx" ON "tenants"("plan_id");

-- CreateIndex
CREATE INDEX "tenant_domains_tenant_id_idx" ON "tenant_domains"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_domains_type_hostname_key" ON "tenant_domains"("type", "hostname");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_provisioning_runs_tenant_id_attempt_key" ON "tenant_provisioning_runs"("tenant_id", "attempt");

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_occurred_at_idx" ON "audit_events"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_action_occurred_at_idx" ON "audit_events"("action", "occurred_at");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_provisioning_runs" ADD CONSTRAINT "tenant_provisioning_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Everything below is written by hand: schema.prisma cannot express it.

-- Slugs and host names are matched exactly, so only the normalized form may be stored.
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_slug_format_check" CHECK ("slug" ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$');
ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_hostname_lowercase_check" CHECK ("hostname" = lower("hostname"));
ALTER TABLE "tenant_provisioning_runs" ADD CONSTRAINT "tenant_provisioning_runs_attempt_check" CHECK ("attempt" >= 1);

-- The plan every tenant starts on.
INSERT INTO "plans" ("id", "code", "name", "is_default") VALUES (gen_random_uuid(), 'free', 'Free', true);
