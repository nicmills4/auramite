-- CreateTable
CREATE TABLE "ReportRecipient" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportRecipient_orgId_email_key" ON "ReportRecipient"("orgId", "email");

-- AddForeignKey
ALTER TABLE "ReportRecipient" ADD CONSTRAINT "ReportRecipient_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: seed each existing organization with its members' login addresses,
-- so reports keep reaching the same people the moment this ships. Lowercased to
-- match how the application writes them, or the unique index would not actually
-- prevent duplicates. ON CONFLICT covers two users differing only by case.
INSERT INTO "ReportRecipient" ("id", "orgId", "email")
SELECT gen_random_uuid()::text, u."orgId", lower(u."email")
FROM "User" u
WHERE u."orgId" IS NOT NULL
ON CONFLICT ("orgId", "email") DO NOTHING;
