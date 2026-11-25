import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "../generated/prisma/client";
import { db } from "./db";
import { emailSchema, normalize, resultSchema, type Intake } from "./schema";

export class WorkspaceError extends Error {
  override readonly name = "WorkspaceError";
}
const duplicateKeys = (input: Intake) => ({
  nameKey: normalize(input.name),
  domain: input.website ? new URL(input.website).hostname.toLowerCase().replace(/^www\./, "") : null,
});

export async function saveCompany(input: Intake) {
  const keys = duplicateKeys(input);
  const where = { OR: [{ nameKey: keys.nameKey }, ...(keys.domain ? [{ domain: keys.domain }] : [])] };
  try {
    const existing = await db.company.findFirst({ where });
    if (existing) return { id: existing.id, duplicate: true };
    const company = await db.company.create({
      data: { ...input, ...keys, permission: Boolean(input.connection && input.permission) },
    });
    return { id: company.id, duplicate: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await db.company.findFirst({ where });
      if (existing) return { id: existing.id, duplicate: true };
    }
    throw error;
  }
}

export async function startRun(companyId: string, source: "Clay API" | "Manual import", replaceRunId: string | null) {
  return db.$transaction(async (tx) => {
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    if (company.latestRunId !== replaceRunId) throw new WorkspaceError("Research changed. Reload the workspace and try again.");
    const prior = replaceRunId && await tx.researchRun.findUnique({where:{id:replaceRunId}});
    if (prior && prior.status === "Submitting" && Date.now() - +prior.updatedAt < 60_000) {
      throw new WorkspaceError("Clay submission is in progress. Wait before starting another run.");
    }
    const { name, website, contact, role, connection, permission, owner } = company;
    const run = await tx.researchRun.create({
      data: {
        id: randomUUID(), companyId, source,
        status: source === "Clay API" ? "Submitting" : "Awaiting import",
        input: { name, website, contact, role, connection: permission ? connection : "", permission, owner },
      },
    });
    await tx.company.update({ where: { id: companyId }, data: { latestRunId: run.id } });
    return run;
  });
}

export async function acceptResult(runId: string, payload: unknown, note: string | null = null) {
  const result = resultSchema.parse(payload);
  return db.$transaction(async (tx) => {
    const run = await tx.researchRun.findUniqueOrThrow({ where: { id: runId }, include: { company: true } });
    if (run.status === "Complete") return "duplicate";
    if (run.company.latestRunId !== runId) return "stale";
    if (!["Processing", "Awaiting import"].includes(run.status)) throw new WorkspaceError("This run cannot accept results.");
    await tx.researchRun.update({ where: { id: runId }, data: { status: "Complete", result, error: note } });
    const prior = await tx.opportunity.findMany({ where: { companyId: run.companyId } });
    for (const details of result.opportunities) {
      const teamKey = normalize(details.team);
      const existing = prior.find((row) => row.teamKey === teamKey);
      const draft = { subject: details.draft.subject, body: details.draft.body };
      if (!existing) {
        await tx.opportunity.create({ data: {
          companyId: run.companyId, teamKey, details, source: run.source, ...draft,
          originalSubject: draft.subject, originalBody: draft.body, owner: run.company.owner,
          contact: run.company.contact, role: run.company.role || details.recipientRole,
        } });
      }
    }
    const firstTeam = result.opportunities.some((o) => normalize(o.team) === run.company.firstTeam)
      ? run.company.firstTeam : null;
    await tx.company.update({ where: { id: run.companyId }, data: { resultsRunId: runId, firstTeam } });
    return "accepted";
  });
}

const commandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("edit"), email: emailSchema }),
  z.object({ kind: z.literal("approve"), email: emailSchema, reviewer: z.string().trim().min(1).max(200) }),
  z.object({ kind: z.enum(["review", "sent", "replied", "closed"]) }),
]);

export async function updateOpportunity(id: string, revision: number, command: unknown) {
  const action = commandSchema.parse(command);
  return db.$transaction(async (tx) => {
    const row = await tx.opportunity.findUniqueOrThrow({ where: { id } });
    if (row.revision !== revision) throw new WorkspaceError("This draft changed. Reload it before making changes.");
    const beforeSend = ["Draft", "Needs Review", "Approved"].includes(row.status);
    const data: Prisma.OpportunityUpdateInput = { revision: { increment: 1 } };
    if (action.kind === "edit" || action.kind === "approve") {
      if (!beforeSend) throw new WorkspaceError("This outreach record is read-only after sending or closing.");
      const changed = row.body !== action.email.body || row.subject !== action.email.subject;
      if (action.kind === "approve") {
        if (changed) throw new WorkspaceError("Save your edits before approving this draft.");
        Object.assign(data, { status: "Approved", reviewer: action.reviewer, approvedAt: new Date() });
      } else if (changed) {
        Object.assign(data, action.email, { status: "Needs Review", reviewer: null, approvedAt: null });
      } else return row;
    } else if (action.kind === "review" && row.status === "Draft") {
      data.status = "Needs Review";
    } else if (action.kind === "sent" && row.status === "Approved" && row.approvedAt) {
      Object.assign(data, { status: "Sent", lastContact: new Date() });
    } else if (action.kind === "replied" && row.status === "Sent") {
      Object.assign(data, { status: "Replied", lastContact: new Date() });
    } else if (action.kind === "closed" && row.status !== "Closed") {
      data.status = "Closed";
    } else throw new WorkspaceError("This status change is unavailable for the current record.");
    return tx.opportunity.update({ where: { id, revision }, data });
  });
}

export async function readWorkspace() {
  const companies = await db.company.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, website: true, contact: true, role: true, owner: true,
      connection: true, permission: true, latestRunId: true, resultsRunId: true, firstTeam: true,
      opportunities: { orderBy: { id: "asc" } },
      runs: {
        orderBy: { createdAt: "desc" },
        select: { id: true, source: true, status: true, remoteId: true, error: true, createdAt: true, result: true },
      },
    },
  });
  return { companies, estimate: clayEstimate() };
}

export function clayEstimate() {
  return process.env.CLAY_PUBLIC_API_KEY && /^(function:t_|workflow:wf_)[\w-]{1,53}$/.test(process.env.CLAY_ROUTINE_ID ?? "")
    ? process.env.CLAY_RUN_ESTIMATE?.trim() || null : null;
}
