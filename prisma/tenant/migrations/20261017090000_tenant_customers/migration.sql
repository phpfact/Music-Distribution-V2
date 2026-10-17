-- Customers module of the tenant panel (.vibe/memory/customer-management.md).
--
-- Adds the three privileges of the new tenant module `tenant.customers` to the
-- tenant-database mirror of the permission catalog (src/lib/authz/catalog.ts).
-- No table changes: customers, users and user_roles already hold everything a
-- customer created by tenant staff needs.
--
-- Master Tenant gets the new privileges automatically (a master role grants
-- every catalog privilege of its domain); custom tenant roles get them only
-- when a role editor grants them.
--
-- Written as an idempotent upsert (same pattern as the rbac migration), so
-- running the file again changes nothing.

INSERT INTO "permissions" ("id", "key", "domain", "module_key", "action", "label", "description", "sort_order") VALUES
  (gen_random_uuid(), 'tenant.customers.view', 'tenant'::"authz_domain", 'tenant.customers', 'view', 'View customers', 'Open the customers list, its counts and the dashboard''s active customers figure.', 160),
  (gen_random_uuid(), 'tenant.customers.create', 'tenant'::"authz_domain", 'tenant.customers', 'create', 'Create customers', 'Create customer accounts that can log in right away.', 170),
  (gen_random_uuid(), 'tenant.customers.suspend', 'tenant'::"authz_domain", 'tenant.customers', 'suspend', 'Suspend and reactivate customers', 'Suspend a customer (and with it its sub-customers) and reactivate it again.', 180)
ON CONFLICT ("key") DO UPDATE SET
  "domain"      = EXCLUDED."domain",
  "module_key"  = EXCLUDED."module_key",
  "action"      = EXCLUDED."action",
  "label"       = EXCLUDED."label",
  "description" = EXCLUDED."description",
  "sort_order"  = EXCLUDED."sort_order";
