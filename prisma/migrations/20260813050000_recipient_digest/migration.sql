-- Per-recipient delivery cadence. WEEKLY quiets no-change reports only; new
-- leaks always send immediately.
CREATE TYPE "Digest" AS ENUM ('EVERY_SCAN', 'WEEKLY');
ALTER TABLE "ReportRecipient" ADD COLUMN "digest" "Digest" NOT NULL DEFAULT 'EVERY_SCAN';
ALTER TABLE "ReportRecipient" ADD COLUMN "lastSentAt" TIMESTAMP(3);
