-- Additive: existing records retain their theme/accent and receive the current
-- console width. The enum rejects arbitrary sizes in both persistence scopes.
CREATE TYPE "appearance_width" AS ENUM ('default', 'full', 'focused');

ALTER TABLE "platform_owner_appearances"
ADD COLUMN "width" "appearance_width" NOT NULL DEFAULT 'default';

ALTER TABLE "platform_appearance"
ADD COLUMN "width" "appearance_width" NOT NULL DEFAULT 'default';
