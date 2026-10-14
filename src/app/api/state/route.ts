import { loadLocalState, parseJob, parsePersistedState, saveLocalState } from "@/lib/local-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_LENGTH = 24_000_000;

export async function GET() {
  try {
    return Response.json(await loadLocalState(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "The local state file could not be read." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_LENGTH) {
    return Response.json({ error: "The local state update is too large." }, { status: 413 });
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_LENGTH) return Response.json({ error: "The local state update is too large." }, { status: 413 });
    body = JSON.parse(text) as unknown;
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const state = parsePersistedState(body);
  if (!state) {
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const record = body as Record<string, unknown>;
      if (Array.isArray(record.liveJobs)) {
        const invalidIndex = record.liveJobs.findIndex((job) => !parseJob(job));
        if (invalidIndex >= 0) {
          const invalidJob = record.liveJobs[invalidIndex] as { id?: unknown } | null;
          const id = invalidJob && typeof invalidJob.id === "string" ? ` (${invalidJob.id.slice(0, 120)})` : "";
          return Response.json({ error: `Found job ${invalidIndex + 1}${id} has fields that cannot be saved. Refresh the job search to replace this listing.` }, { status: 400 });
        }
      }
      if (parsePersistedState({ ...record, liveJobs: [] })) {
        return Response.json({ error: "One or more found-job records are invalid. Refresh the job search to replace them." }, { status: 400 });
      }
    }
    return Response.json({ error: "The local state update has invalid profile, tracker, or CV fields. Review the local data and try again." }, { status: 400 });
  }
  try {
    await saveLocalState(state);
    // Autosaves do not need to download the complete job pool back to the
    // browser. Backup restore and first-run migration explicitly request it.
    const includeState = new URL(request.url).searchParams.get("includeState") === "1";
    return Response.json(includeState ? { ...state, initialized: true } : { initialized: true, saved: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "The local state file could not be saved." }, { status: 500 });
  }
}
