-- AlterTable
ALTER TABLE "users" ADD COLUMN     "password_hash" VARCHAR(255),
ADD COLUMN     "username" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");


-- Everything below is written by hand: schema.prisma cannot express it.

-- User names are matched exactly, so only the normalized form may be stored.
-- The same rule as platform_owners_username_format_check in the control plane.
ALTER TABLE "users" ADD CONSTRAINT "users_username_format_check" CHECK ("username" ~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$' AND char_length("username") >= 3);
