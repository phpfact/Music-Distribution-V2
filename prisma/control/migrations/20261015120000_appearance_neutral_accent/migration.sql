-- Additive (CLAUDE.md: shadcn's black-and-white neutral appearance is the
-- default). Adds the "neutral" accent before the existing colours. Saved
-- personal and platform preferences keep the accent they already have; the
-- application default (src/lib/appearance/preferences.ts) becomes neutral.
ALTER TYPE "appearance_accent" ADD VALUE IF NOT EXISTS 'neutral' BEFORE 'emerald';
