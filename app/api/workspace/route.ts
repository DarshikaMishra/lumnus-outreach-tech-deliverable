import { z } from "zod";
import { db } from "../../../lib/db";
import { intakeSchema, normalize, resultSchema } from "../../../lib/schema";
import { researchPrompt } from "../../../lib/prompt";
import { acceptResult, readWorkspace, saveCompany, startRun, updateOpportunity, WorkspaceError } from "../../../lib/workspace";
import { pollClay, submitClay } from "../../../lib/clay";

export const runtime = "nodejs";
const id = z.string().min(1).max(80);
const runBase = { companyId: id, replaces: id.nullable() };
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("company"), input: intakeSchema }),
  z.object({ action: z.literal("manual"), ...runBase }),
  z.object({ action: z.literal("clay"), ...runBase, estimate: z.string() }),
  z.object({ action: z.literal("poll"), runId: id }),
  z.object({ action: z.literal("prompt"), runId: id }),
  z.object({ action: z.literal("import"), runId: id, payload: resultSchema }),
  z.object({ action: z.literal("opportunity"), id, revision: z.number().int().min(0), command: z.unknown() }),
  z.object({ action: z.literal("recommend"), companyId: id, resultsId: id, team: z.string().max(500).nullable() }),
]);

export async function GET() {
  return Response.json(await readWorkspace(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") ?? new URL(request.url).host;
  const scheme = new URL(request.url).protocol;
  if (origin && origin !== scheme + "//" + host) {
    return Response.json({ error: "Unexpected request origin." }, { status: 403 });
  }
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return Response.json({ error: "Expected JSON." }, { status: 415 });
    }
    const body = await request.text();
    if (body.length > 150_000) return Response.json({ error: "Request is too large." }, { status: 413 });
    const command = requestSchema.parse(JSON.parse(body));
    let extra = {};
    switch (command.action) {
      case "company": extra = await saveCompany(command.input); break;
      case "manual": {
        const run = await startRun(command.companyId, "Manual import", command.replaces);
        extra = { runId: run.id, prompt: researchPrompt(intakeSchema.parse(run.input)) };
        break;
      }
      case "clay": await submitClay(command.companyId, command.replaces, command.estimate); break;
      case "poll": await pollClay(command.runId); break;
      case "prompt": {
        const run = await db.researchRun.findUnique({ where: { id: command.runId } });
        if (!run || run.source !== "Manual import") throw new WorkspaceError("Choose a manual import run.");
        extra = { runId: run.id, prompt: researchPrompt(intakeSchema.parse(run.input)) };
        break;
      }
      case "import": {
        const run = await db.researchRun.findUnique({ where: { id: command.runId } });
        if (!run || run.source !== "Manual import") throw new WorkspaceError("Choose a manual import run.");
        extra = { outcome: await acceptResult(command.runId, command.payload) };
        break;
      }
      case "opportunity": await updateOpportunity(command.id, command.revision, command.command); break;
      case "recommend": {
        const teamKey = command.team ? normalize(command.team) : null;
        const run = await db.researchRun.findFirst({ where: { id: command.resultsId, companyId: command.companyId } });
        if (!run || (teamKey && !resultSchema.parse(run.result).opportunities.some((o) => normalize(o.team) === teamKey))) {
          throw new WorkspaceError("Choose a team from current research.");
        }
        const changed = await db.company.updateMany({
          where: { id: command.companyId, resultsRunId: command.resultsId }, data: { firstTeam: teamKey },
        });
        if (!changed.count) throw new WorkspaceError("Research changed. Reload before choosing a team.");
        break;
      }
    }
    return Response.json({ ...await readWorkspace(), ...extra });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: error.issues.slice(0, 5).map((i) => i.path.join(".") + " — " + i.message).join(" · ") }, { status: 400 });
    }
    if (error instanceof WorkspaceError) return Response.json({ error: error.message }, { status: 400 });
    if (error instanceof SyntaxError) return Response.json({ error: "Invalid JSON." }, { status: 400 });
    return Response.json({ error: "Could not update the workspace. Refresh and check the current state before retrying." }, { status: 500 });
  }
}
