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
  let state = parsePersistedState(body);
  let skippedListings = 0;
  if (!state) {
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const record = body as Record<string, unknown>;
      if (Array.isArray(record.liveJobs)) {
        // An invalid feed item must not prevent valid jobs and scores from
        // being saved. Keep the valid listings and tell the UI what was skipped.
        const validListings = record.liveJobs.map(parseJob).filter((job) => job !== null);
        skippedListings = record.liveJobs.length - validListings.length;
        if (skippedListings > 0) {
          state = parsePersistedState({ ...record, liveJobs: validListings });
        }
      }
      if (!state && parsePersistedState({ ...record, liveJobs: [] })) {
        return Response.json({ error: "One or more found-job records are invalid. Refresh the job search to replace them." }, { status: 400 });
      }
    }
    if (!state) return Response.json({ error: "The local state update has invalid profile, tracker, or CV fields. Review the local data and try again." }, { status: 400 });
  }
  try {
    await saveLocalState(state);
    // Autosaves do not need to download the complete job pool back to the
    // browser. Backup restore and first-run migration explicitly request it.
    const includeState = new URL(request.url).searchParams.get("includeState") === "1";
    const warning = skippedListings > 0 ? `${skippedListings} malformed job listing${skippedListings === 1 ? " was" : "s were"} skipped; the other jobs and scores were saved.` : undefined;
    return Response.json(includeState
      ? { ...state, initialized: true, ...(warning ? { warning } : {}) }
      : { initialized: true, saved: true, ...(warning ? { warning } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "The local state file could not be saved." }, { status: 500 });
  }
}
