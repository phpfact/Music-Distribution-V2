-- Additive only: preserve existing owners, sessions, tenants and preferences.
ALTER TABLE "platform_owners"
ADD COLUMN "can_manage_appearance" BOOLEAN NOT NULL DEFAULT true;

CREATE TYPE "appearance_theme" AS ENUM ('light', 'dark', 'system');
CREATE TYPE "appearance_accent" AS ENUM ('emerald', 'indigo', 'violet', 'blue', 'rose', 'amber');

CREATE TABLE "platform_owner_appearances" (
    "owner_id" UUID NOT NULL,
    "theme" "appearance_theme" NOT NULL,
    "accent" "appearance_accent" NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_owner_appearances_pkey" PRIMARY KEY ("owner_id"),
    CONSTRAINT "platform_owner_appearances_owner_id_fkey"
      FOREIGN KEY ("owner_id") REFERENCES "platform_owners"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "platform_appearance" (
    "id" VARCHAR(32) NOT NULL DEFAULT 'platform',
    "theme" "appearance_theme" NOT NULL,
    "accent" "appearance_accent" NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_appearance_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_appearance_singleton_check" CHECK ("id" = 'platform')
);
