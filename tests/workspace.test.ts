import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { intakeSchema, type ResearchResult } from "../lib/schema";
import { researchPrompt } from "../lib/prompt";

const temp = mkdtempSync(join(tmpdir(), "lumnus-test-"));
process.env.DATABASE_URL = "file:" + join(temp, "test.db");
execFileSync(process.execPath, ["scripts/init-db.cjs"]);
const workspace = import("../lib/workspace");
const database = import("../lib/db");

after(async () => {
  const { db } = await database;
  await db.$disconnect();
  rmSync(temp, { recursive: true, force: true });
});

// Synthetic fixtures for storage checks. No claim here is outreach research.
function fixture(label = "initial"): ResearchResult {
  return { opportunities: [1, 2, 3].map((rank) => ({
    team: "Synthetic team " + rank, teamBasis: "inferred", project: label + " project " + rank,
    pilot: "Synthetic pilot " + rank, benefit: "Synthetic benefit", access: "Synthetic access",
    recipientRole: "Synthetic role", rank, rankReason: "Test ranking",
    hypothesis: "Synthetic hypothesis", verificationNotes: "Fixture only",
    evidence: [{ url: "https://example.com/", fact: "Fixture only", retrieval: "not_checked", excerpt: "" }],
    scores: {
      evidence: { score: 1, reason: "Test evidence" },
      feasibility: { score: 2, reason: "Test feasibility" },
      value: { score: 3, reason: "Test value" },
    },
    draft: { subject: label + " subject " + rank, body: "Synthetic draft for a test." },
  })) };
}

test("duplicate companies, stale and duplicate deliveries, preserved draft and approval reset", async () => {
  const { saveCompany, startRun, acceptResult, updateOpportunity } = await workspace;
  const { db } = await database;
  const input = intakeSchema.parse({ name: "Fixture Company", website: "https://example.com" });
  const { id } = await saveCompany(input);
  assert.deepEqual(await saveCompany(intakeSchema.parse({name:"Different Name",website:"https://www.example.com"})), {id,duplicate:true});
  assert.deepEqual(await saveCompany(intakeSchema.parse({name:" FIXTURE COMPANY "})), {id,duplicate:true});
  const old = await startRun(id, "Manual import", null);
  const current = await startRun(id, "Manual import", old.id);
  assert.equal(await acceptResult(old.id, fixture("stale")), "stale");
  assert.equal(await db.opportunity.count(), 0);
  const deliveries = await Promise.all([acceptResult(current.id, fixture()), acceptResult(current.id, fixture())]);
  assert.deepEqual(deliveries.sort(), ["accepted", "duplicate"]);
  assert.equal(await db.opportunity.count(), 3);
  const row = await db.opportunity.findFirstOrThrow({ where: { teamKey: "synthetic team 1" } });
  const approved = await updateOpportunity(row.id, row.revision, {
    kind:"approve", email:{subject:row.subject, body:row.body}, reviewer:"Reviewer",
  });
  assert.equal(approved.status, "Approved");
  assert.ok(approved.approvedAt);
  const rerun = await startRun(id, "Manual import", current.id);
  assert.equal((await db.company.findUniqueOrThrow({where:{id}})).resultsRunId, current.id);
  await acceptResult(rerun.id, fixture("rerun"));
  assert.equal((await db.opportunity.findUniqueOrThrow({where:{id:row.id}})).status, "Approved");
  const edited = await updateOpportunity(row.id, approved.revision, {kind:"edit", email:{subject:row.subject,body:"Human edit."}});
  assert.equal(edited.status, "Needs Review");
  assert.equal(edited.approvedAt, null);
  assert.equal(edited.reviewer, null);
  assert.equal(edited.originalBody, row.body);
  await assert.rejects(updateOpportunity(row.id, approved.revision, {kind:"sent"}), /draft changed/);
  await assert.rejects(updateOpportunity(row.id, edited.revision, {kind:"sent"}), /unavailable/);
});

test("only permitted warm-connection details appear in the research prompt", () => {
  const input = intakeSchema.parse({name:"Fixture",connection:"Private connection fixture"});
  assert.ok(!researchPrompt(input).includes(input.connection));
  assert.ok(researchPrompt({...input,permission:true}).includes(input.connection));
});

test("Clay's malformed closing delimiter can be repaired without changing result values", async () => {
  const { decodeClayResult } = await import("../lib/clay");
  const result = fixture();
  const json = JSON.stringify(result);
  assert.deepEqual(decodeClayResult(json), {value:result,repaired:false});
  assert.deepEqual(decodeClayResult(json.replace(/\]\}$/, "}}").slice(0, -1)), {value:result,repaired:true});
  assert.deepEqual(decodeClayResult('{"opportunities":[broken}}}'), {value:undefined,repaired:false});
});
