-- CreateEnum
CREATE TYPE "tenant_domain_status" AS ENUM ('pending', 'active', 'failed');

-- CreateEnum
CREATE TYPE "tenant_database_mode" AS ENUM ('provisioned', 'existing');

-- AlterEnum
ALTER TYPE "provisioning_step" ADD VALUE 'check_database';

-- AlterTable
ALTER TABLE "tenant_domains" ADD COLUMN     "last_check_error" VARCHAR(300),
ADD COLUMN     "last_checked_at" TIMESTAMPTZ(3),
ADD COLUMN     "status" "tenant_domain_status" NOT NULL DEFAULT 'pending',
ADD COLUMN     "verification_token" VARCHAR(64),
ADD COLUMN     "verified_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "admin_username" VARCHAR(64) NOT NULL,
ADD COLUMN     "database_mode" "tenant_database_mode" NOT NULL DEFAULT 'provisioned',
ADD COLUMN     "database_port" INTEGER,
ADD COLUMN     "pending_admin_password_hash" VARCHAR(255),
ADD COLUMN     "phone" VARCHAR(16),
ADD COLUMN     "profile_image_key" VARCHAR(255);

-- CreateTable
CREATE TABLE "tenant_provisioning_steps" (
    "tenant_id" UUID NOT NULL,
    "step" "provisioning_step" NOT NULL,
    "completed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "run_id" UUID NOT NULL,

    CONSTRAINT "tenant_provisioning_steps_pkey" PRIMARY KEY ("tenant_id","step")
);

-- CreateTable
CREATE TABLE "secrets" (
    "id" UUID NOT NULL,
    "purpose" VARCHAR(50) NOT NULL,
    "key_version" SMALLINT NOT NULL,
    "nonce" BYTEA NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "auth_tag" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "secrets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_provisioning_steps_run_id_idx" ON "tenant_provisioning_steps"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_contact_email_key" ON "tenants"("contact_email");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_admin_username_key" ON "tenants"("admin_username");

-- AddForeignKey
ALTER TABLE "tenant_provisioning_steps" ADD CONSTRAINT "tenant_provisioning_steps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_provisioning_steps" ADD CONSTRAINT "tenant_provisioning_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "tenant_provisioning_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Everything below is written by hand: schema.prisma cannot express it.

-- ALTER TYPE ... ADD VALUE above: PostgreSQL allows it inside the migration's
-- transaction, but the new value cannot be used before that transaction
-- commits. Nothing in this migration uses 'check_database', and it is added
-- last, so the sort order of the existing values is unchanged.

-- Matched exactly, so only the normalized form may be stored. The user name
-- rule is the same as platform_owners_username_format_check.
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_contact_email_lowercase_check" CHECK ("contact_email" = lower("contact_email"));
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_admin_username_format_check" CHECK ("admin_username" ~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$' AND char_length("admin_username") >= 3);
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_phone_format_check" CHECK ("phone" ~ '^\+?[0-9]{7,15}$');
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_database_port_check" CHECK ("database_port" BETWEEN 1 AND 65535);

-- One subdomain row per tenant and at most one custom domain row per tenant.
CREATE UNIQUE INDEX "tenant_domains_one_subdomain_per_tenant_key" ON "tenant_domains"("tenant_id") WHERE "type" = 'subdomain';
CREATE UNIQUE INDEX "tenant_domains_one_custom_per_tenant_key" ON "tenant_domains"("tenant_id") WHERE "type" = 'custom';

-- Every new database grants CONNECT to PUBLIC, so each tenant's login could
-- open a connection to the control plane. Only the administrative login (the
-- owner) needs it. The database name differs per environment, hence dynamic SQL.
DO $$
BEGIN
  EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', current_database());
END
$$;
