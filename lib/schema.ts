import { z } from "zod";

const line = z.string().trim().min(1).max(500);
const optional = z.string().trim().max(200).default("");
export const publicUrl = z.url({ protocol: /^https?$/ });
export const normalize = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const intakeSchema = z.object({
  name: line.refine((s) => Boolean(normalize(s)), "Enter a company name"),
  website: z.union([publicUrl, z.literal("")]).default(""),
  contact: optional,
  role: optional,
  connection: z.string().trim().max(1500).default(""),
  permission: z.boolean().default(false),
  owner: optional,
});
const evidence = z.strictObject({
  url: publicUrl,
  fact: line.describe("Specific factual claim supported by the page"),
  retrieval: z.enum(["reported_retrieved", "unavailable", "not_checked"]),
  excerpt: z.string().trim().max(600).describe("Short supporting excerpt, or empty if unavailable"),
});
const score = z.strictObject({ score: z.number().int().min(1).max(5), reason: line });
export const emailSchema = z.strictObject({ subject: line, body: z.string().trim().min(1).max(5000) });
export const opportunitySchema = z.strictObject({
  team: line,
  teamBasis: z.enum(["publicly_named", "inferred"]),
  project: line,
  pilot: line,
  evidence: z.array(evidence).min(1).max(8),
  hypothesis: line,
  verificationNotes: line,
  benefit: line,
  access: line,
  recipientRole: line,
  scores: z.strictObject({ evidence: score, feasibility: score, value: score }),
  rank: z.number().int().min(1).max(3),
  rankReason: line,
  draft: emailSchema,
});
export const resultShape = z.strictObject({ opportunities: z.array(opportunitySchema).length(3) });
export const resultSchema = resultShape.superRefine(({ opportunities }, ctx) => {
  for (const field of ["team", "project", "pilot"] as const) {
    const values = new Set(opportunities.map((o) => normalize(o[field])));
    if (values.size !== 3 || values.has("")) ctx.addIssue({code:"custom", path:["opportunities"], message:"Provide three distinct values for " + field});
  }
  if (new Set(opportunities.map((o) => o.rank)).size !== 3) ctx.addIssue({code:"custom", path:["opportunities"], message:"Use ranks 1, 2 and 3 exactly once"});
  opportunities.forEach((o, i) => {
    if (o.teamBasis === "publicly_named" && !o.evidence.some((e) => e.retrieval === "reported_retrieved" && e.excerpt)) {
      ctx.addIssue({code:"custom", path:["opportunities", i, "evidence"], message:"A publicly named team needs reported retrieved evidence and an excerpt"});
    }
  });
});
export const resultJsonSchema = z.toJSONSchema(resultShape);
export type OpportunityDetails = z.infer<typeof opportunitySchema>;
export type ResearchResult = z.infer<typeof resultSchema>;
export type Intake = z.infer<typeof intakeSchema>;
export const statuses = ["Draft", "Needs Review", "Approved", "Sent", "Replied", "Closed"] as const;
