import { detectAtsPlatform } from "../../../../lib/application-preparation";
import { APPLICATION_EXTENSION_ORIGIN } from "../../../../lib/application-extension";
import { loadLocalState } from "../../../../lib/local-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = { "Cache-Control": "no-store", Vary: "Origin" };

function responseHeaders(origin: string) {
  return {
    ...PRIVATE_HEADERS,
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
}

function normalizePostingUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString();
}

function isAllowedOrigin(request: Request) {
  return request.headers.get("origin") === APPLICATION_EXTENSION_ORIGIN;
}

export async function OPTIONS(request: Request) {
  if (!isAllowedOrigin(request)) return Response.json({ error: "This local endpoint is available only to the Jobpilot browser extension." }, { status: 403, headers: PRIVATE_HEADERS });
  return new Response(null, { status: 204, headers: { ...responseHeaders(APPLICATION_EXTENSION_ORIGIN), "Access-Control-Max-Age": "600" } });
}

export async function GET(request: Request) {
  if (!isAllowedOrigin(request)) return Response.json({ error: "This local endpoint is available only to the Jobpilot browser extension." }, { status: 403, headers: PRIVATE_HEADERS });

  const postingUrl = new URL(request.url).searchParams.get("postingUrl");
  if (!postingUrl || postingUrl.length > 2048 || detectAtsPlatform(postingUrl).platform === "unknown") {
    return Response.json({ error: "Open a supported HTTPS employer application form first." }, { status: 400, headers: responseHeaders(APPLICATION_EXTENSION_ORIGIN) });
  }

  try {
    const state = await loadLocalState();
    if (!state.initialized) return Response.json({ error: "Open Jobpilot once and save your profile before using form fill." }, { status: 409, headers: responseHeaders(APPLICATION_EXTENSION_ORIGIN) });
    const normalizedUrl = normalizePostingUrl(postingUrl);
    const matchedJob = state.liveJobs.find((job) => {
      if (!job.sourceUrl) return false;
      try { return normalizePostingUrl(job.sourceUrl) === normalizedUrl; } catch { return false; }
    });
    const coverLetter = matchedJob ? state.coverLetterDrafts?.[matchedJob.id]?.draft : undefined;
    return Response.json({
      candidate: {
        name: state.profile.name,
        email: state.profile.email ?? "",
        phone: state.profile.phone ?? "",
        linkedin: state.profile.linkedin ?? "",
        portfolio: state.profile.portfolio ?? "",
        workAuthorization: state.profile.workAuthorization ?? "",
        coverLetter: coverLetter ?? "",
      },
      matchedSavedJob: Boolean(matchedJob),
    }, { headers: responseHeaders(APPLICATION_EXTENSION_ORIGIN) });
  } catch {
    return Response.json({ error: "Could not read Jobpilot's local profile. Check that Jobpilot is running." }, { status: 500, headers: responseHeaders(APPLICATION_EXTENSION_ORIGIN) });
  }
}
