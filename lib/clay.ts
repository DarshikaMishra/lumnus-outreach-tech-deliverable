import { z } from "zod";
import { db } from "./db";
import { intakeSchema, resultSchema } from "./schema";
import { researchPrompt } from "./prompt";
import { acceptResult, clayEstimate, startRun, WorkspaceError } from "./workspace";

const runId = z.string().regex(/^[\w-]{1,128}$/);
const base = "https://api.clay.com/public/v0/routines";
function clayFetch(path: string, body?: unknown) {
  return fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "clay-api-key": process.env.CLAY_PUBLIC_API_KEY ?? "", "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000),
  });
}

export async function submitClay(companyId: string, replaces: string | null, approvedEstimate: string) {
  const estimate = clayEstimate();
  if (!estimate || approvedEstimate !== estimate) throw new WorkspaceError("Review and approve the current Clay estimate before submitting.");
  const run = await startRun(companyId, "Clay API", replaces);
  let message = "Clay did not confirm submission. Check Clay’s Runs before starting another run, which may consume credits again.";
  try {
    const response = await clayFetch("/" + process.env.CLAY_ROUTINE_ID + "/run", {
      items: [{ id: run.id, inputs: { prompt: researchPrompt(intakeSchema.parse(run.input)) } }],
    });
    if (response.status !== 202) {
      message = `Clay rejected or could not confirm submission (HTTP ${response.status}). Check Clay’s Runs before retrying.`;
      throw new Error();
    }
    const accepted = z.object({ routine_run_id: runId, status: z.literal("in_progress") }).parse(await response.json());
    await db.researchRun.update({ where: { id: run.id }, data: { remoteId: accepted.routine_run_id, status: "Processing" } });
  } catch {
    await db.researchRun.updateMany({ where: { id: run.id, status: "Submitting" }, data: { status: "Submission unconfirmed", error: message } });
  }
}

export async function pollClay(id: string) {
  const run = await db.researchRun.findUniqueOrThrow({ where: { id }, include: { company: true } });
  if (run.company.latestRunId !== id || run.status !== "Processing" || !run.remoteId) return;
  if (!process.env.CLAY_PUBLIC_API_KEY) throw new WorkspaceError("Set the Clay API key and restart the server to check this run.");
  let response: Response;
  try {
    response = await clayFetch("/run/" + runId.parse(run.remoteId) + "/results");
  } catch {
    throw new WorkspaceError("Clay could not be reached. Check this run again later.");
  }
  if (!response.ok) throw new WorkspaceError(`Clay results returned HTTP ${response.status}. Check configuration or try refreshing later. This only reads the existing run.`);
  const envelope = z.object({
    routine_run_id: runId,
    status: z.enum(["in_progress", "complete"]),
    data: z.array(z.object({ id: z.string(), status: z.string(), result: z.unknown() })).optional(),
  }).safeParse(await response.json().catch(() => null));
  if (!envelope.success || envelope.data.routine_run_id !== run.remoteId) {
    throw new WorkspaceError("Clay returned an unexpected response. Check the run in Clay.");
  }
  if (envelope.data.status === "in_progress") return;
  const item = envelope.data.data?.find((x) => x.id === id);
  const output = z.object({
    research_result: z.unknown().optional(),
    structuredOutputs: z.object({ research_result: z.unknown() }).optional(),
  }).safeParse(item?.result);
  const decoded = decodeClayResult(output.success
    ? output.data.structuredOutputs?.research_result ?? output.data.research_result
    : undefined);
  const result = resultSchema.safeParse(decoded.value);
  if (item?.status !== "complete" || !result.success) {
    await db.researchRun.updateMany({ where: { id, status: "Processing" }, data: {
      status: "Failed", error: "Clay did not produce a valid research_result. Check the function output or import corrected JSON in a new manual run.",
    } });
    return;
  }
  await acceptResult(id, result.data, decoded.repaired
    ? "Clay omitted the closing opportunities bracket. The app restored it and validated the result."
    : null);
}


// Claygents can serialize the structured text field as malformed JSON.
// Recover only this exact missing-array-delimiter case. Schema validation follows.
export function decodeClayResult(value: unknown): { value: unknown; repaired: boolean } {
  if (typeof value !== "string") return { value, repaired: false };
  const text = value.trim();
  try {
    return { value: JSON.parse(text), repaired: false };
  } catch {
    if (text.startsWith('{"opportunities":[') && text.endsWith("}}}")) {
      try {
        return { value: JSON.parse(text.slice(0, -1) + "]}"), repaired: true };
      } catch {
        return { value: undefined, repaired: false };
      }
    }
    return { value: undefined, repaired: false };
  }
}
