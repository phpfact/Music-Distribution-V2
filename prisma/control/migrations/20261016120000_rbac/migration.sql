-- Role and privilege management (RBAC) foundation of the control plane
-- (.vibe/memory/role-privilege-management.md, "Database" and "Migration of
-- existing data").
--
-- Written by hand and IDEMPOTENT: every statement can run again on an already
-- migrated database without failing or changing data (IF NOT EXISTS, ON
-- CONFLICT, guarded DO blocks). It is safe on an empty database and on a
-- database with existing platform owners.

-- ---------------------------------------------------------------------------
-- 1. Enums

-- Customer users become an audit actor type. ADD VALUE commits with this
-- migration and nothing below uses the new value.
ALTER TYPE "audit_actor_type" ADD VALUE IF NOT EXISTS 'customer_user';

-- Custom roles can be disabled; system (master) roles are always active.
DO $$
BEGIN
  CREATE TYPE "role_status" AS ENUM ('active', 'disabled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Permission catalog mirror (src/lib/authz/catalog.ts, platform domain)

CREATE TABLE IF NOT EXISTS "platform_permissions" (
    "key" VARCHAR(100) NOT NULL,
    "module_key" VARCHAR(100) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "description" VARCHAR(500),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_permissions_pkey" PRIMARY KEY ("key"),
    -- A key is always <module>.<action> and always of the platform domain.
    CONSTRAINT "platform_permissions_key_format_check"
      CHECK ("key" = "module_key" || '.' || "action" AND "module_key" LIKE 'platform.%')
);

CREATE INDEX IF NOT EXISTS "platform_permissions_module_key_idx" ON "platform_permissions"("module_key");

-- Upsert of the whole platform catalog: re-running rewrites the same values.
INSERT INTO "platform_permissions" ("key", "module_key", "action", "label", "description", "sort_order") VALUES
  ('platform.tenants.view', 'platform.tenants', 'view', 'View tenants', 'Open the tenant directory, tenant details, summary counts and profile images.', 110),
  ('platform.tenants.create', 'platform.tenants', 'create', 'Create tenants', 'Use the create form, the value preview and the connection test, and create tenants.', 120),
  ('platform.tenants.edit', 'platform.tenants', 'edit', 'Edit tenants', 'Edit tenant details and domains and run domain checks.', 130),
  ('platform.tenants.suspend', 'platform.tenants', 'suspend', 'Suspend and reactivate tenants', 'Suspend a tenant and reactivate it again.', 140),
  ('platform.tenants.provision', 'platform.tenants', 'provision', 'Retry tenant setup', 'Retry the setup of a tenant whose provisioning failed.', 150),
  ('platform.tenants.credentials', 'platform.tenants', 'credentials', 'Manage tenant credentials', 'Reset the master password and rotate or update the database password.', 160),
  ('platform.tenant_registrations.view', 'platform.tenant_registrations', 'view', 'View customer registrations', 'Open a tenant''s customer registrations page and its counts.', 210),
  ('platform.tenant_registrations.review', 'platform.tenant_registrations', 'review', 'Approve and reject registrations', 'Approve or reject a tenant''s customer registrations.', 220),
  ('platform.tenant_registrations.suspend', 'platform.tenant_registrations', 'suspend', 'Suspend and reactivate customer accounts', 'Suspend or reactivate approved customer accounts of a tenant.', 230),
  ('platform.tenant_modules.manage', 'platform.tenant_modules', 'manage', 'Manage tenant modules', 'Switch the tenant and customer panel modules of a tenant on or off.', 310),
  ('platform.appearance.manage_global', 'platform.appearance', 'manage_global', 'Manage global appearance', 'Apply or reset the appearance for every Platform Owner.', 410),
  ('platform.roles.view', 'platform.roles', 'view', 'View roles', 'Open the platform roles and their privileges.', 510),
  ('platform.roles.create', 'platform.roles', 'create', 'Create roles', 'Create platform roles.', 520),
  ('platform.roles.edit', 'platform.roles', 'edit', 'Edit roles', 'Edit, disable and enable platform roles.', 530),
  ('platform.roles.delete', 'platform.roles', 'delete', 'Delete roles', 'Delete platform roles.', 540),
  ('platform.users.view', 'platform.users', 'view', 'View Sub-Platform Owners', 'Open the list of Sub-Platform Owners.', 610),
  ('platform.users.create', 'platform.users', 'create', 'Create Sub-Platform Owners', 'Create Sub-Platform Owner accounts.', 620),
  ('platform.users.edit', 'platform.users', 'edit', 'Edit Sub-Platform Owners', 'Change a Sub-Platform Owner''s details, role or password.', 630),
  ('platform.users.suspend', 'platform.users', 'suspend', 'Suspend and reactivate Sub-Platform Owners', 'Suspend a Sub-Platform Owner and reactivate it again.', 640),
  ('platform.modules.manage', 'platform.modules', 'manage', 'Manage platform modules', 'Switch platform modules on or off for everyone.', 710)
ON CONFLICT ("key") DO UPDATE SET
  "module_key"  = EXCLUDED."module_key",
  "action"      = EXCLUDED."action",
  "label"       = EXCLUDED."label",
  "description" = EXCLUDED."description",
  "sort_order"  = EXCLUDED."sort_order";

-- ---------------------------------------------------------------------------
-- 3. Platform roles and their privileges

CREATE TABLE IF NOT EXISTS "platform_roles" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "status" "role_status" NOT NULL DEFAULT 'active',
    -- Set only on the protected master role; privileges come from this key.
    "system_key" VARCHAR(50),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_roles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_roles_system_key_check" CHECK ("system_key" IS NULL OR "system_key" = 'master_platform'),
    -- A master role can never be disabled (nobody may be locked out).
    CONSTRAINT "platform_roles_system_active_check" CHECK ("system_key" IS NULL OR "status" = 'active'),
    CONSTRAINT "platform_roles_name_not_blank_check" CHECK (btrim("name") <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_roles_system_key_key" ON "platform_roles"("system_key");
-- Role names are unique case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS "platform_roles_name_lower_key" ON "platform_roles"(lower("name"));

CREATE TABLE IF NOT EXISTS "platform_role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_key" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_role_permissions_pkey" PRIMARY KEY ("role_id", "permission_key"),
    CONSTRAINT "platform_role_permissions_role_id_fkey"
      FOREIGN KEY ("role_id") REFERENCES "platform_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- A catalog privilege cannot vanish while a role still stores it.
    CONSTRAINT "platform_role_permissions_permission_key_fkey"
      FOREIGN KEY ("permission_key") REFERENCES "platform_permissions"("key") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "platform_role_permissions_permission_key_idx" ON "platform_role_permissions"("permission_key");

-- The master role of the platform domain (all platform privileges by system key).
INSERT INTO "platform_roles" ("id", "name", "description", "status", "system_key", "updated_at")
VALUES (
  gen_random_uuid(),
  'Master Platform',
  'Every platform privilege, including privileges added later. It cannot be edited, disabled or deleted.',
  'active',
  'master_platform',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("system_key") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Platform owners: one role each, the primary account, full name, creator

ALTER TABLE "platform_owners"
  ADD COLUMN IF NOT EXISTS "role_id" UUID,
  ADD COLUMN IF NOT EXISTS "full_name" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "is_primary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "created_by_id" UUID;

-- Data mapping (runs only while something is still unmapped):
--   * the oldest ACTIVE owner (the oldest owner when none is active) becomes
--     the primary account and holds Master Platform;
--   * every other owner without a role gets a legacy custom role holding
--     exactly the capabilities they already had: platform.tenants.* and
--     platform.tenant_registrations.*, plus platform.appearance.manage_global
--     only where can_manage_appearance was true. The new management
--     privileges (roles, users, modules, tenant modules) are NOT granted.
DO $$
DECLARE
  master_id        uuid;
  primary_id       uuid;
  has_flag         boolean;
  need_global      boolean;
  need_personal    boolean;
  global_role_id   uuid;
  personal_role_id uuid;
BEGIN
  -- Step 1: the master role created above.
  SELECT "id" INTO master_id FROM "platform_roles" WHERE "system_key" = 'master_platform';

  -- Step 2: the primary account (only when none exists yet).
  IF NOT EXISTS (SELECT 1 FROM "platform_owners" WHERE "is_primary") THEN
    SELECT "id" INTO primary_id
    FROM "platform_owners"
    ORDER BY ("status" = 'active') DESC, "created_at", "id"
    LIMIT 1;
    IF primary_id IS NOT NULL THEN
      UPDATE "platform_owners" SET "is_primary" = true, "role_id" = master_id WHERE "id" = primary_id;
    END IF;
  END IF;

  -- Step 3: everyone else who has no role yet.
  IF NOT EXISTS (SELECT 1 FROM "platform_owners" WHERE "role_id" IS NULL) THEN
    RETURN;
  END IF;

  -- The legacy flag is read with dynamic SQL: it no longer exists once this
  -- migration has finished (a re-run never reaches this point anyway).
  has_flag := EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'platform_owners' AND column_name = 'can_manage_appearance'
  );
  IF has_flag THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM "platform_owners" WHERE "role_id" IS NULL AND "can_manage_appearance")' INTO need_global;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM "platform_owners" WHERE "role_id" IS NULL AND NOT "can_manage_appearance")' INTO need_personal;
  ELSE
    -- Without the flag nobody is known to manage the global appearance (fail secure).
    need_global   := false;
    need_personal := true;
  END IF;

  -- Step 3a: owners who could change the platform-wide appearance.
  IF need_global THEN
    INSERT INTO "platform_roles" ("id", "name", "description", "status", "updated_at")
    VALUES (
      gen_random_uuid(),
      'Legacy Platform Owner',
      'Created by the RBAC migration for existing Platform Owners: tenant management, tenant customer registrations and global appearance.',
      'active',
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (lower("name")) DO NOTHING;
    SELECT "id" INTO global_role_id FROM "platform_roles" WHERE lower("name") = lower('Legacy Platform Owner');
    INSERT INTO "platform_role_permissions" ("role_id", "permission_key")
    SELECT global_role_id, "key" FROM "platform_permissions"
    WHERE "module_key" IN ('platform.tenants', 'platform.tenant_registrations') OR "key" = 'platform.appearance.manage_global'
    ON CONFLICT DO NOTHING;
    EXECUTE 'UPDATE "platform_owners" SET "role_id" = $1 WHERE "role_id" IS NULL AND "can_manage_appearance"' USING global_role_id;
  END IF;

  -- Step 3b: owners limited to their personal appearance.
  IF need_personal THEN
    INSERT INTO "platform_roles" ("id", "name", "description", "status", "updated_at")
    VALUES (
      gen_random_uuid(),
      'Legacy Platform Owner (personal appearance)',
      'Created by the RBAC migration for existing Platform Owners: tenant management and tenant customer registrations.',
      'active',
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (lower("name")) DO NOTHING;
    SELECT "id" INTO personal_role_id FROM "platform_roles" WHERE lower("name") = lower('Legacy Platform Owner (personal appearance)');
    INSERT INTO "platform_role_permissions" ("role_id", "permission_key")
    SELECT personal_role_id, "key" FROM "platform_permissions"
    WHERE "module_key" IN ('platform.tenants', 'platform.tenant_registrations')
    ON CONFLICT DO NOTHING;
    UPDATE "platform_owners" SET "role_id" = personal_role_id WHERE "role_id" IS NULL;
  END IF;
END
$$;

-- Every owner now holds exactly one role.
ALTER TABLE "platform_owners" ALTER COLUMN "role_id" SET NOT NULL;

DO $$
BEGIN
  -- A role in use can never vanish from under its owners.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_owners_role_id_fkey') THEN
    ALTER TABLE "platform_owners" ADD CONSTRAINT "platform_owners_role_id_fkey"
      FOREIGN KEY ("role_id") REFERENCES "platform_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  -- Creating another owner does not cascade: the creator may be removed later.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_owners_created_by_id_fkey') THEN
    ALTER TABLE "platform_owners" ADD CONSTRAINT "platform_owners_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "platform_owners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_roles_created_by_id_fkey') THEN
    ALTER TABLE "platform_roles" ADD CONSTRAINT "platform_roles_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "platform_owners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "platform_owners_role_id_idx" ON "platform_owners"("role_id");
-- Exactly one primary account at most (every indexed value is TRUE).
CREATE UNIQUE INDEX IF NOT EXISTS "platform_owners_one_primary_key" ON "platform_owners"("is_primary") WHERE "is_primary";

-- The appearance permission is now the platform.appearance.manage_global privilege.
ALTER TABLE "platform_owners" DROP COLUMN IF EXISTS "can_manage_appearance";

-- ---------------------------------------------------------------------------
-- 5. Central module switches (absent row = enabled; core modules are ignored)

CREATE TABLE IF NOT EXISTS "platform_module_settings" (
    "module_key" VARCHAR(100) NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" UUID,

    CONSTRAINT "platform_module_settings_pkey" PRIMARY KEY ("module_key"),
    CONSTRAINT "platform_module_settings_module_key_check" CHECK ("module_key" LIKE 'platform.%'),
    CONSTRAINT "platform_module_settings_updated_by_id_fkey"
      FOREIGN KEY ("updated_by_id") REFERENCES "platform_owners"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "tenant_module_settings" (
    "tenant_id" UUID NOT NULL,
    "module_key" VARCHAR(100) NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" UUID,

    CONSTRAINT "tenant_module_settings_pkey" PRIMARY KEY ("tenant_id", "module_key"),
    -- Tenant and customer panel modules only.
    CONSTRAINT "tenant_module_settings_module_key_check"
      CHECK ("module_key" LIKE 'tenant.%' OR "module_key" LIKE 'customer.%'),
    CONSTRAINT "tenant_module_settings_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tenant_module_settings_updated_by_id_fkey"
      FOREIGN KEY ("updated_by_id") REFERENCES "platform_owners"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- ---------------------------------------------------------------------------
-- 6. The master role can never be deleted or lose its system key (even when
--    nobody holds it), so the platform always has a master role to assign.

CREATE OR REPLACE FUNCTION "platform_roles_protect_master"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."system_key" IS NOT NULL THEN
      RAISE EXCEPTION 'the master role cannot be deleted'
        USING ERRCODE = 'restrict_violation', TABLE = 'platform_roles';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."system_key" IS DISTINCT FROM OLD."system_key" THEN
    RAISE EXCEPTION 'the system key of a role cannot change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'platform_roles_system_key_immutable', TABLE = 'platform_roles';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER "platform_roles_protect_master"
  BEFORE UPDATE OR DELETE ON "platform_roles"
  FOR EACH ROW EXECUTE FUNCTION "platform_roles_protect_master"();

-- ---------------------------------------------------------------------------
-- 7. Audit events are append-only

CREATE OR REPLACE FUNCTION "audit_events_append_only"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'audit events cannot be changed or deleted'
    USING ERRCODE = 'restrict_violation', TABLE = 'audit_events';
END
$$;

CREATE OR REPLACE TRIGGER "audit_events_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "audit_events_append_only"();

CREATE OR REPLACE TRIGGER "audit_events_no_truncate"
  BEFORE TRUNCATE ON "audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_events_append_only"();
