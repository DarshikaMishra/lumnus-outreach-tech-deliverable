CREATE TABLE IF NOT EXISTS "Company" (
  "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "nameKey" TEXT NOT NULL,
  "website" TEXT NOT NULL DEFAULT '', "domain" TEXT, "contact" TEXT NOT NULL DEFAULT '',
  "role" TEXT NOT NULL DEFAULT '', "connection" TEXT NOT NULL DEFAULT '',
  "permission" BOOLEAN NOT NULL DEFAULT false, "owner" TEXT NOT NULL,
  "latestRunId" TEXT, "resultsRunId" TEXT, "firstTeam" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "Company_nameKey_key" ON "Company"("nameKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Company_domain_key" ON "Company"("domain");
CREATE TABLE IF NOT EXISTS "ResearchRun" (
  "id" TEXT NOT NULL PRIMARY KEY, "companyId" TEXT NOT NULL,
  "source" TEXT NOT NULL, "status" TEXT NOT NULL, "remoteId" TEXT, "error" TEXT,
  "input" JSONB NOT NULL, "result" JSONB,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ResearchRun_remoteId_key" ON "ResearchRun"("remoteId");
CREATE INDEX IF NOT EXISTS "ResearchRun_companyId_createdAt_idx" ON "ResearchRun"("companyId", "createdAt");
CREATE TABLE IF NOT EXISTS "Opportunity" (
  "id" TEXT NOT NULL PRIMARY KEY, "companyId" TEXT NOT NULL, "teamKey" TEXT NOT NULL,
  "details" JSONB NOT NULL, "source" TEXT NOT NULL, "originalSubject" TEXT NOT NULL,
  "originalBody" TEXT NOT NULL, "subject" TEXT NOT NULL, "body" TEXT NOT NULL,
  "owner" TEXT NOT NULL, "contact" TEXT NOT NULL, "role" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Draft', "reviewer" TEXT, "approvedAt" DATETIME,
  "lastContact" DATETIME, "revision" INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Opportunity_companyId_teamKey_key" ON "Opportunity"("companyId", "teamKey");
