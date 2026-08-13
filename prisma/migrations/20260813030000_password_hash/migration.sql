-- Password sign-in. Nullable: magic-link-era accounts set theirs via the
-- password-reset flow.
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
