-- CreateEnum
CREATE TYPE "registration_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "reviewer_type" AS ENUM ('platform_owner', 'tenant_user');

-- CreateEnum
CREATE TYPE "session_area" AS ENUM ('tenant', 'customer');

-- CreateEnum
CREATE TYPE "appearance_theme" AS ENUM ('light', 'dark', 'system');

-- CreateEnum
CREATE TYPE "appearance_accent" AS ENUM ('neutral', 'emerald', 'indigo', 'violet', 'blue', 'rose', 'amber');

-- CreateEnum
CREATE TYPE "appearance_width" AS ENUM ('default', 'full', 'focused');

-- CreateTable
CREATE TABLE "customer_registrations" (
    "id" UUID NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "account_type" "customer_type" NOT NULL,
    "status" "registration_status" NOT NULL DEFAULT 'pending',
    "rejection_reason" VARCHAR(500),
    "review_request_message" VARCHAR(1000),
    "review_requested_at" TIMESTAMPTZ(3),
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_type" "reviewer_type",
    "reviewed_by_id" UUID,
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "area" "session_area" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_sessions" (
    "id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "registration_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_appearance" (
    "id" VARCHAR(32) NOT NULL DEFAULT 'workspace',
    "theme" "appearance_theme" NOT NULL,
    "accent" "appearance_accent" NOT NULL,
    "width" "appearance_width" NOT NULL DEFAULT 'default',
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_appearance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_appearances" (
    "user_id" UUID NOT NULL,
    "theme" "appearance_theme" NOT NULL,
    "accent" "appearance_accent" NOT NULL,
    "width" "appearance_width" NOT NULL DEFAULT 'default',
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_appearances_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_registrations_user_id_key" ON "customer_registrations"("user_id");

-- CreateIndex
CREATE INDEX "customer_registrations_status_created_at_idx" ON "customer_registrations"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "registration_sessions_token_hash_key" ON "registration_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "registration_sessions_registration_id_idx" ON "registration_sessions"("registration_id");

-- CreateIndex
CREATE INDEX "registration_sessions_expires_at_idx" ON "registration_sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "customer_registrations" ADD CONSTRAINT "customer_registrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_sessions" ADD CONSTRAINT "registration_sessions_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "customer_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_appearances" ADD CONSTRAINT "user_appearances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Everything below is written by hand: schema.prisma cannot express it.

-- Matched exactly, so only the normalized forms may be stored (same rules as users).
ALTER TABLE "customer_registrations" ADD CONSTRAINT "customer_registrations_email_lowercase_check" CHECK ("email" = lower("email"));
ALTER TABLE "customer_registrations" ADD CONSTRAINT "customer_registrations_username_format_check" CHECK ("username" ~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$' AND char_length("username") >= 3);
-- A rejection always carries its reason; an approval always points at the created user.
ALTER TABLE "customer_registrations" ADD CONSTRAINT "customer_registrations_rejected_reason_check" CHECK ("status" <> 'rejected' OR "rejection_reason" IS NOT NULL);
ALTER TABLE "customer_registrations" ADD CONSTRAINT "customer_registrations_approved_user_check" CHECK ("status" <> 'approved' OR "user_id" IS NOT NULL);
-- One open (pending or rejected) request per email and per username. Approved
-- requests are history: their email/username now belong to a users row.
CREATE UNIQUE INDEX "customer_registrations_open_email_key" ON "customer_registrations"("email") WHERE "status" <> 'approved';
CREATE UNIQUE INDEX "customer_registrations_open_username_key" ON "customer_registrations"("username") WHERE "status" <> 'approved';
-- Exactly one workspace default appearance row.
ALTER TABLE "workspace_appearance" ADD CONSTRAINT "workspace_appearance_singleton_check" CHECK ("id" = 'workspace');
