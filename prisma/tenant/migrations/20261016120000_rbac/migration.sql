-- Role and privilege management (RBAC) foundation of a tenant database
-- (.vibe/memory/role-privilege-management.md, "Database" and "Migration of
-- existing data").
--
-- Written by hand and IDEMPOTENT: every statement can run again on an already
-- migrated database without failing or changing data (IF NOT EXISTS, ON
-- CONFLICT, guarded DO blocks). Safe on an empty database (a new tenant: the
-- admin is written later by provisioning) and on one with existing users.
--
-- The triggers run with the privileges of whoever writes (the tenant's
-- low-privilege runtime login): they only read tables that login can read,
-- and pin their search path so a temporary table cannot shadow them.

-- ---------------------------------------------------------------------------
-- 1. Enums

DO $$
BEGIN
  CREATE TYPE "role_status" AS ENUM ('active', 'disabled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- The two authorization domains of a tenant database.
DO $$
BEGIN
  CREATE TYPE "authz_domain" AS ENUM ('tenant', 'customer');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Permission catalog mirror (src/lib/authz/catalog.ts, tenant + customer)

ALTER TABLE "permissions"
  ADD COLUMN IF NOT EXISTS "domain" "authz_domain",
  ADD COLUMN IF NOT EXISTS "module_key" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "action" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "label" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0;

-- Upsert of the tenant and customer catalogs: re-running rewrites the same values.
INSERT INTO "permissions" ("id", "key", "domain", "module_key", "action", "label", "description", "sort_order") VALUES
  (gen_random_uuid(), 'tenant.registrations.view', 'tenant'::"authz_domain", 'tenant.registrations', 'view', 'View customer registrations', 'Open the customer registrations page and its counts.', 110),
  (gen_random_uuid(), 'tenant.registrations.review', 'tenant'::"authz_domain", 'tenant.registrations', 'review', 'Approve and reject registrations', 'Approve or reject customer registrations.', 120),
  (gen_random_uuid(), 'tenant.registrations.suspend', 'tenant'::"authz_domain", 'tenant.registrations', 'suspend', 'Suspend and reactivate customer accounts', 'Suspend or reactivate approved customer accounts.', 130),
  (gen_random_uuid(), 'tenant.appearance.manage_workspace', 'tenant'::"authz_domain", 'tenant.appearance', 'manage_workspace', 'Manage workspace appearance', 'Apply or reset the workspace default appearance.', 210),
  (gen_random_uuid(), 'tenant.roles.view', 'tenant'::"authz_domain", 'tenant.roles', 'view', 'View roles', 'Open the tenant roles and their privileges.', 310),
  (gen_random_uuid(), 'tenant.roles.create', 'tenant'::"authz_domain", 'tenant.roles', 'create', 'Create roles', 'Create tenant roles.', 320),
  (gen_random_uuid(), 'tenant.roles.edit', 'tenant'::"authz_domain", 'tenant.roles', 'edit', 'Edit roles', 'Edit, disable and enable tenant roles.', 330),
  (gen_random_uuid(), 'tenant.roles.delete', 'tenant'::"authz_domain", 'tenant.roles', 'delete', 'Delete roles', 'Delete tenant roles.', 340),
  (gen_random_uuid(), 'tenant.users.view', 'tenant'::"authz_domain", 'tenant.users', 'view', 'View Sub-Tenants', 'Open the list of Sub-Tenants.', 410),
  (gen_random_uuid(), 'tenant.users.create', 'tenant'::"authz_domain", 'tenant.users', 'create', 'Create Sub-Tenants', 'Create Sub-Tenant accounts.', 420),
  (gen_random_uuid(), 'tenant.users.edit', 'tenant'::"authz_domain", 'tenant.users', 'edit', 'Edit Sub-Tenants', 'Change a Sub-Tenant''s details, role or password.', 430),
  (gen_random_uuid(), 'tenant.users.suspend', 'tenant'::"authz_domain", 'tenant.users', 'suspend', 'Suspend and reactivate Sub-Tenants', 'Suspend a Sub-Tenant and reactivate it again.', 440),
  (gen_random_uuid(), 'customer.roles.view', 'customer'::"authz_domain", 'customer.roles', 'view', 'View roles', 'Open the customer roles and their privileges.', 110),
  (gen_random_uuid(), 'customer.roles.create', 'customer'::"authz_domain", 'customer.roles', 'create', 'Create roles', 'Create customer roles.', 120),
  (gen_random_uuid(), 'customer.roles.edit', 'customer'::"authz_domain", 'customer.roles', 'edit', 'Edit roles', 'Edit, disable and enable customer roles.', 130),
  (gen_random_uuid(), 'customer.roles.delete', 'customer'::"authz_domain", 'customer.roles', 'delete', 'Delete roles', 'Delete customer roles.', 140),
  (gen_random_uuid(), 'customer.sub_customers.view', 'customer'::"authz_domain", 'customer.sub_customers', 'view', 'View Sub-Customers', 'Open the list of Sub-Customers.', 210),
  (gen_random_uuid(), 'customer.sub_customers.create', 'customer'::"authz_domain", 'customer.sub_customers', 'create', 'Create Sub-Customers', 'Create Sub-Customer accounts.', 220),
  (gen_random_uuid(), 'customer.sub_customers.edit', 'customer'::"authz_domain", 'customer.sub_customers', 'edit', 'Edit Sub-Customers', 'Change a Sub-Customer''s details, role or password.', 230),
  (gen_random_uuid(), 'customer.sub_customers.suspend', 'customer'::"authz_domain", 'customer.sub_customers', 'suspend', 'Suspend and reactivate Sub-Customers', 'Suspend a Sub-Customer and reactivate it again.', 240)
ON CONFLICT ("key") DO UPDATE SET
  "domain"      = EXCLUDED."domain",
  "module_key"  = EXCLUDED."module_key",
  "action"      = EXCLUDED."action",
  "label"       = EXCLUDED."label",
  "description" = EXCLUDED."description",
  "sort_order"  = EXCLUDED."sort_order";

-- Legacy privileges outside the catalog grant nothing any more: removed, and
-- with them (ON DELETE CASCADE) every role link to them.
DELETE FROM "permissions" WHERE "domain" IS NULL;

ALTER TABLE "permissions"
  ALTER COLUMN "domain" SET NOT NULL,
  ALTER COLUMN "module_key" SET NOT NULL,
  ALTER COLUMN "action" SET NOT NULL,
  ALTER COLUMN "label" SET NOT NULL;

DO $$
BEGIN
  -- A key is always <module>.<action> and belongs to its own domain.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'permissions_key_format_check') THEN
    ALTER TABLE "permissions" ADD CONSTRAINT "permissions_key_format_check" CHECK (
      "key" = "module_key" || '.' || "action"
      AND (("domain" = 'tenant' AND "module_key" LIKE 'tenant.%')
        OR ("domain" = 'customer' AND "module_key" LIKE 'customer.%'))
    );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "permissions_domain_module_key_idx" ON "permissions"("domain", "module_key");

-- ---------------------------------------------------------------------------
-- 3. Roles: domain, protected system key, status, customer owner, creator

ALTER TABLE "roles"
  ADD COLUMN IF NOT EXISTS "domain" "authz_domain",
  ADD COLUMN IF NOT EXISTS "system_key" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "status" "role_status" NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "owner_customer_id" UUID,
  ADD COLUMN IF NOT EXISTS "created_by_id" UUID;

-- Legacy roles (anything but the owner role): their privileges were removed
-- above, so they become disabled tenant roles that nobody holds (their user
-- links are removed below). The key is appended to the name so the scoped
-- unique name index can never collide.
UPDATE "roles"
SET "domain"    = 'tenant',
    "status"    = 'disabled',
    "is_system" = false,
    "name"      = left("name", 80) || ' (' || "key" || ')'
WHERE "domain" IS NULL AND "key" NOT IN ('owner', 'master_customer');

-- Master Tenant: the existing owner role (key 'owner' kept), or a new one.
INSERT INTO "roles" ("id", "key", "name", "description", "is_system", "domain", "system_key", "status", "updated_at")
VALUES (
  gen_random_uuid(),
  'owner',
  'Master Tenant',
  'Every tenant privilege, including privileges added later. It cannot be edited, disabled or deleted.',
  true,
  'tenant',
  'master_tenant',
  'active',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "name"              = EXCLUDED."name",
  "description"       = EXCLUDED."description",
  "is_system"         = true,
  "domain"            = 'tenant',
  "system_key"        = 'master_tenant',
  "status"            = 'active',
  "owner_customer_id" = NULL;

-- Master Customer: one per tenant database, owned by no customer.
INSERT INTO "roles" ("id", "key", "name", "description", "is_system", "domain", "system_key", "status", "updated_at")
VALUES (
  gen_random_uuid(),
  'master_customer',
  'Master Customer',
  'Every customer privilege, including privileges added later. It cannot be edited, disabled or deleted.',
  true,
  'customer',
  'master_customer',
  'active',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "name"              = EXCLUDED."name",
  "description"       = EXCLUDED."description",
  "is_system"         = true,
  "domain"            = 'customer',
  "system_key"        = 'master_customer',
  "status"            = 'active',
  "owner_customer_id" = NULL;

ALTER TABLE "roles" ALTER COLUMN "domain" SET NOT NULL;

-- Custom roles get a generated key, so the services never invent one.
ALTER TABLE "roles" ALTER COLUMN "key" SET DEFAULT ('custom_' || replace(gen_random_uuid()::text, '-', ''));

DO $$
BEGIN
  -- Only the two master roles carry a system key, each in its own domain.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roles_system_key_check') THEN
    ALTER TABLE "roles" ADD CONSTRAINT "roles_system_key_check" CHECK (
      "system_key" IS NULL
      OR ("system_key" = 'master_tenant' AND "domain" = 'tenant')
      OR ("system_key" = 'master_customer' AND "domain" = 'customer')
    );
  END IF;
  -- A master role can never be disabled (nobody may be locked out).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roles_system_active_check') THEN
    ALTER TABLE "roles" ADD CONSTRAINT "roles_system_active_check" CHECK ("system_key" IS NULL OR "status" = 'active');
  END IF;
  -- The old flag stays in step with the system key.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roles_system_flag_check') THEN
    ALTER TABLE "roles" ADD CONSTRAINT "roles_system_flag_check" CHECK ("is_system" = ("system_key" IS NOT NULL));
  END IF;
  -- Custom customer roles (and only they) are owned by a main customer.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roles_owner_customer_check') THEN
    ALTER TABLE "roles" ADD CONSTRAINT "roles_owner_customer_check" CHECK (
      ("owner_customer_id" IS NOT NULL) = ("domain" = 'customer' AND "system_key" IS NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roles_owner_customer_id_fkey') THEN
    ALTER TABLE "roles" ADD CONSTRAINT "roles_owner_customer_id_fkey"
      FOREIGN KEY ("owner_customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roles_created_by_id_fkey') THEN
    ALTER TABLE "roles" ADD CONSTRAINT "roles_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "roles_system_key_key" ON "roles"("system_key");
CREATE INDEX IF NOT EXISTS "roles_owner_customer_id_idx" ON "roles"("owner_customer_id");
-- Role names are unique per scope (domain + owning main customer), case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS "roles_scope_name_key" ON "roles"(
  "domain",
  COALESCE("owner_customer_id", '00000000-0000-0000-0000-000000000000'::uuid),
  lower("name")
);

-- ---------------------------------------------------------------------------
-- 4. Users: primary accounts

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_primary" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 5. One role per user: existing links mapped, then UNIQUE (user_id)
--
-- Runs once, while user_roles still has its old two-column primary key:
--   * links to any role other than the two masters grant nothing (removed);
--   * Master Tenant stays only with staff users (no customer link);
--   * duplicates are reduced to the oldest link, then user_id becomes the key;
--   * each approved registration's user of a main customer gets Master Customer;
--   * an approved account that is suspended also gets its main customer row
--     disabled (account lifecycle rule of the RBAC spec).
-- Anyone else keeps no role (fail secure).
DO $$
DECLARE
  tenant_master   uuid;
  customer_master uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'user_roles'::regclass AND conname = 'user_roles_pkey' AND array_length(conkey, 1) = 2
  ) THEN
    RETURN;
  END IF;

  -- Step 1: the two master roles created above.
  SELECT "id" INTO tenant_master FROM "roles" WHERE "system_key" = 'master_tenant';
  SELECT "id" INTO customer_master FROM "roles" WHERE "system_key" = 'master_customer';

  -- Step 2: links that grant nothing any more.
  DELETE FROM "user_roles" WHERE "role_id" NOT IN (tenant_master, customer_master);
  DELETE FROM "user_roles" ur
  USING "users" u
  WHERE ur."user_id" = u."id"
    AND ((ur."role_id" = tenant_master AND u."customer_id" IS NOT NULL)
      OR (ur."role_id" = customer_master AND u."customer_id" IS NULL));

  -- Step 3: one link per user (the oldest wins), then user_id is the key.
  DELETE FROM "user_roles" ur
  USING "user_roles" keep
  WHERE ur."user_id" = keep."user_id"
    AND (keep."created_at", keep."role_id") < (ur."created_at", ur."role_id");
  ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_pkey";
  ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id");

  -- Step 4: Master Customer for the user of every approved main customer.
  INSERT INTO "user_roles" ("user_id", "role_id")
  SELECT u."id", customer_master
  FROM "customer_registrations" r
  JOIN "users" u ON u."id" = r."user_id"
  JOIN "customers" c ON c."id" = u."customer_id"
  WHERE r."status" = 'approved' AND c."parent_id" IS NULL
  ON CONFLICT ("user_id") DO NOTHING;

  -- Step 5: a suspended approved account suspends its main customer row too.
  UPDATE "customers" c
  SET "status" = 'disabled', "updated_at" = CURRENT_TIMESTAMP
  FROM "customer_registrations" r
  JOIN "users" u ON u."id" = r."user_id"
  WHERE r."status" = 'approved'
    AND u."customer_id" = c."id"
    AND u."status" = 'disabled'
    AND c."parent_id" IS NULL
    AND c."status" = 'active';
END
$$;

-- The primary staff account: the oldest active holder of Master Tenant (the
-- oldest holder when none is active), only while there is none.
UPDATE "users" SET "is_primary" = true
WHERE "id" = (
    SELECT u."id"
    FROM "users" u
    JOIN "user_roles" ur ON ur."user_id" = u."id"
    JOIN "roles" r ON r."id" = ur."role_id"
    WHERE r."system_key" = 'master_tenant' AND u."customer_id" IS NULL
    ORDER BY (u."status" = 'active') DESC, u."created_at", u."id"
    LIMIT 1
  )
  AND NOT EXISTS (SELECT 1 FROM "users" p WHERE p."is_primary" AND p."customer_id" IS NULL);

-- The primary user of each approved main customer, only while it has none.
UPDATE "users" u SET "is_primary" = true
FROM "customer_registrations" r, "customers" c
WHERE r."user_id" = u."id"
  AND r."status" = 'approved'
  AND c."id" = u."customer_id"
  AND c."parent_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "users" p WHERE p."is_primary" AND p."customer_id" = u."customer_id");

-- One primary staff account; one primary user per customer.
CREATE UNIQUE INDEX IF NOT EXISTS "users_one_primary_staff_key" ON "users"("is_primary")
  WHERE "is_primary" AND "customer_id" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "users_one_primary_per_customer_key" ON "users"("customer_id")
  WHERE "is_primary" AND "customer_id" IS NOT NULL;

-- A role in use can never vanish from under its users.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_role_id_fkey' AND confdeltype <> 'r') THEN
    ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_role_id_fkey";
    ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey"
      FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 6. Triggers: domain and scope rules the schema cannot express

-- A role only stores privileges of its own domain.
CREATE OR REPLACE FUNCTION "role_permissions_domain_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  role_domain       authz_domain;
  permission_domain authz_domain;
BEGIN
  SELECT r."domain" INTO role_domain FROM "roles" r WHERE r."id" = NEW."role_id";
  SELECT p."domain" INTO permission_domain FROM "permissions" p WHERE p."id" = NEW."permission_id";
  -- Missing rows are left to the foreign keys.
  IF role_domain IS NOT NULL AND permission_domain IS NOT NULL AND role_domain <> permission_domain THEN
    RAISE EXCEPTION 'a % role cannot hold a % privilege', role_domain, permission_domain
      USING ERRCODE = 'check_violation', CONSTRAINT = 'role_permissions_domain_match', TABLE = 'role_permissions';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER "role_permissions_domain_guard"
  BEFORE INSERT OR UPDATE ON "role_permissions"
  FOR EACH ROW EXECUTE FUNCTION "role_permissions_domain_guard"();

-- A staff user holds a tenant role; a customer user holds a customer role,
-- and a custom customer role only when its owner is the user's main customer
-- (COALESCE(parent_id, id) of the user's customer).
CREATE OR REPLACE FUNCTION "user_roles_scope_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  user_customer uuid;
  main_customer uuid;
  role_domain   authz_domain;
  role_owner    uuid;
BEGIN
  SELECT u."customer_id", COALESCE(c."parent_id", c."id")
  INTO user_customer, main_customer
  FROM "users" u
  LEFT JOIN "customers" c ON c."id" = u."customer_id"
  WHERE u."id" = NEW."user_id";
  IF NOT FOUND THEN
    RETURN NEW; -- left to the foreign key
  END IF;

  SELECT r."domain", r."owner_customer_id" INTO role_domain, role_owner FROM "roles" r WHERE r."id" = NEW."role_id";
  IF NOT FOUND THEN
    RETURN NEW; -- left to the foreign key
  END IF;

  IF user_customer IS NULL AND role_domain <> 'tenant' THEN
    RAISE EXCEPTION 'a staff user can only hold a tenant role'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'user_roles_domain_match', TABLE = 'user_roles';
  END IF;
  IF user_customer IS NOT NULL AND role_domain <> 'customer' THEN
    RAISE EXCEPTION 'a customer user can only hold a customer role'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'user_roles_domain_match', TABLE = 'user_roles';
  END IF;
  IF role_owner IS NOT NULL AND role_owner <> main_customer THEN
    RAISE EXCEPTION 'this customer role belongs to another customer'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'user_roles_customer_scope', TABLE = 'user_roles';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER "user_roles_scope_guard"
  BEFORE INSERT OR UPDATE ON "user_roles"
  FOR EACH ROW EXECUTE FUNCTION "user_roles_scope_guard"();

-- A role's domain, system key and owner never change (assignments rely on
-- them), and a custom customer role is owned by a MAIN customer.
CREATE OR REPLACE FUNCTION "roles_scope_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  owner_parent uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND (
       NEW."domain" IS DISTINCT FROM OLD."domain"
    OR NEW."system_key" IS DISTINCT FROM OLD."system_key"
    OR NEW."owner_customer_id" IS DISTINCT FROM OLD."owner_customer_id"
  ) THEN
    RAISE EXCEPTION 'the domain, system key and owner of a role cannot change'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'roles_scope_immutable', TABLE = 'roles';
  END IF;
  IF NEW."owner_customer_id" IS NOT NULL THEN
    SELECT c."parent_id" INTO owner_parent FROM "customers" c WHERE c."id" = NEW."owner_customer_id";
    IF FOUND AND owner_parent IS NOT NULL THEN
      RAISE EXCEPTION 'a customer role can only be owned by a main customer'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'roles_owner_main_customer', TABLE = 'roles';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER "roles_scope_guard"
  BEFORE INSERT OR UPDATE ON "roles"
  FOR EACH ROW EXECUTE FUNCTION "roles_scope_guard"();

-- The master roles can never be deleted (even when nobody holds them), so a
-- master role is always there to assign.
CREATE OR REPLACE FUNCTION "roles_protect_system"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD."system_key" IS NOT NULL THEN
    RAISE EXCEPTION 'a master role cannot be deleted'
      USING ERRCODE = 'restrict_violation', TABLE = 'roles';
  END IF;
  RETURN OLD;
END
$$;

CREATE OR REPLACE TRIGGER "roles_protect_system"
  BEFORE DELETE ON "roles"
  FOR EACH ROW EXECUTE FUNCTION "roles_protect_system"();

-- Customers are at most one level deep: a sub-customer's parent is a main
-- customer, and a customer with sub-customers (or its own roles) cannot
-- become a sub-customer. The parent row is locked, so two concurrent changes
-- cannot together build a second level.
CREATE OR REPLACE FUNCTION "customers_hierarchy_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  grandparent uuid;
BEGIN
  IF NEW."parent_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c."parent_id" INTO grandparent FROM "customers" c WHERE c."id" = NEW."parent_id" FOR SHARE;
  IF FOUND AND grandparent IS NOT NULL THEN
    RAISE EXCEPTION 'a sub-customer cannot have sub-customers'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'customers_one_level', TABLE = 'customers';
  END IF;
  IF EXISTS (SELECT 1 FROM "customers" c WHERE c."parent_id" = NEW."id") THEN
    RAISE EXCEPTION 'a customer with sub-customers cannot become a sub-customer'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'customers_one_level', TABLE = 'customers';
  END IF;
  IF EXISTS (SELECT 1 FROM "roles" r WHERE r."owner_customer_id" = NEW."id") THEN
    RAISE EXCEPTION 'a customer that owns roles cannot become a sub-customer'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'customers_one_level', TABLE = 'customers';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER "customers_hierarchy_guard"
  BEFORE INSERT OR UPDATE OF "parent_id" ON "customers"
  FOR EACH ROW EXECUTE FUNCTION "customers_hierarchy_guard"();
