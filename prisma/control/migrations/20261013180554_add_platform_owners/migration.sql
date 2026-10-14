-- CreateEnum
CREATE TYPE "platform_owner_status" AS ENUM ('active', 'disabled');

-- CreateTable
CREATE TABLE "platform_owners" (
    "id" UUID NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "status" "platform_owner_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_owner_sessions" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_owner_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_owners_username_key" ON "platform_owners"("username");

-- CreateIndex
CREATE UNIQUE INDEX "platform_owner_sessions_token_hash_key" ON "platform_owner_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "platform_owner_sessions_owner_id_idx" ON "platform_owner_sessions"("owner_id");

-- CreateIndex
CREATE INDEX "platform_owner_sessions_expires_at_idx" ON "platform_owner_sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "platform_owner_sessions" ADD CONSTRAINT "platform_owner_sessions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "platform_owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Everything below is written by hand: schema.prisma cannot express it.

-- User names are matched exactly, so only the normalized form may be stored.
ALTER TABLE "platform_owners" ADD CONSTRAINT "platform_owners_username_format_check" CHECK ("username" ~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$' AND char_length("username") >= 3);
