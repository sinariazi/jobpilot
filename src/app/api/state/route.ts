import { loadLocalState, parsePersistedState, saveLocalState } from "@/lib/local-state";

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
  if (!state) return Response.json({ error: "The local state update has invalid fields or exceeds a size limit." }, { status: 400 });
  try {
    await saveLocalState(state);
    return Response.json({ ...state, initialized: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "The local state file could not be saved." }, { status: 500 });
  }
}
