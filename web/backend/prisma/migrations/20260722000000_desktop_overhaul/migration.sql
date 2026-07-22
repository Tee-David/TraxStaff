-- AlterTable: Organization — idle-discard default policy
ALTER TABLE "Organization" ADD COLUMN "keepIdleDefault" BOOL NOT NULL DEFAULT true;

-- AlterTable: User — monitoring consent
ALTER TABLE "User" ADD COLUMN "consentAcceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "consentVersion" INT4;

-- Deduplicate AppUsage before adding the (sessionId, blockStart, appName) unique
-- index. Keep the lexicographically-smallest id per group, drop the rest.
DELETE FROM "AppUsage" a
USING "AppUsage" b
WHERE a."sessionId" = b."sessionId"
  AND a."blockStart" = b."blockStart"
  AND a."appName" = b."appName"
  AND a."id" > b."id";

-- CreateIndex: AppUsage unique key (idempotent app-usage ingestion)
CREATE UNIQUE INDEX "AppUsage_sessionId_blockStart_appName_key" ON "AppUsage"("sessionId", "blockStart", "appName");

-- CreateTable: UrlUsage
CREATE TABLE "UrlUsage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sessionId" UUID NOT NULL,
    "domain" STRING NOT NULL,
    "seconds" INT4 NOT NULL,
    "blockStart" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UrlUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UrlUsage_sessionId_blockStart_domain_key" ON "UrlUsage"("sessionId", "blockStart", "domain");

-- CreateIndex
CREATE INDEX "UrlUsage_sessionId_idx" ON "UrlUsage"("sessionId");

-- CreateTable: IdleDiscard
CREATE TABLE "IdleDiscard" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sessionId" UUID NOT NULL,
    "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3) NOT NULL,
    "seconds" INT4 NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdleDiscard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdleDiscard_sessionId_idx" ON "IdleDiscard"("sessionId");

-- CreateTable: TimeNote
CREATE TABLE "TimeNote" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "body" STRING NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeNote_sessionId_idx" ON "TimeNote"("sessionId");

-- AddForeignKey
ALTER TABLE "UrlUsage" ADD CONSTRAINT "UrlUsage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrackingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdleDiscard" ADD CONSTRAINT "IdleDiscard_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrackingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeNote" ADD CONSTRAINT "TimeNote_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrackingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeNote" ADD CONSTRAINT "TimeNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
