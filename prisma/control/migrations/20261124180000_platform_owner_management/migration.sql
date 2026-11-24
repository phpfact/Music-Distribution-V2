-- Platform Owner Management schema enhancements:
-- Add email, phone, last_login_at to platform_owners and add platform.users.delete privilege.

ALTER TABLE "platform_owners" ADD COLUMN IF NOT EXISTS "email" VARCHAR(320);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_owners_email_key" ON "platform_owners"(lower("email"));

ALTER TABLE "platform_owners" ADD COLUMN IF NOT EXISTS "phone" VARCHAR(20);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_owners_phone_key" ON "platform_owners"("phone") WHERE "phone" IS NOT NULL;

ALTER TABLE "platform_owners" ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMPTZ(3);

-- Mirror of platform.users.delete in the permission catalog
INSERT INTO "platform_permissions" ("key", "module_key", "action", "label", "description", "sort_order")
VALUES ('platform.users.delete', 'platform.users', 'delete', 'Delete Sub-Platform Owners', 'Delete Sub-Platform Owner accounts safely.', 650)
ON CONFLICT ("key") DO UPDATE SET
  "module_key"  = EXCLUDED."module_key",
  "action"      = EXCLUDED."action",
  "label"       = EXCLUDED."label",
  "description" = EXCLUDED."description",
  "sort_order"  = EXCLUDED."sort_order";
