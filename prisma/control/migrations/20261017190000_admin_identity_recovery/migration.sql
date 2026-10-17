-- A recoverable desired-identity record stays on the tenant, even if an
-- application process stops between the two databases' commits. Existing
-- tenants capture their validated primary staff UUID on their first edit.
ALTER TABLE tenants
  ADD COLUMN admin_user_id uuid,
  ADD COLUMN admin_identity_version integer NOT NULL DEFAULT 0,
  ADD COLUMN admin_identity_sync_pending boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT tenants_admin_identity_version_nonnegative CHECK (admin_identity_version >= 0),
  ADD CONSTRAINT tenants_admin_identity_recovery_target CHECK (NOT admin_identity_sync_pending OR admin_user_id IS NOT NULL);
