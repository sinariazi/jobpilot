import { ARBEITNOW_PAGES_PER_BATCH, searchPublicJobs } from "../../../../lib/job-search";

export const maxDuration = 60;

function validPage(raw: unknown, maxPage: number): raw is number {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 1 && raw <= maxPage;
}

function parseAdzunaOptions(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (typeof body.includeAdzuna !== "boolean") return null;
  if (typeof body.roles !== "string" || body.roles.length > 2000
    || typeof body.locations !== "string" || body.locations.length > 2000) return null;
  if (body.adzunaPage !== undefined && (!body.includeAdzuna || !validPage(body.adzunaPage, 1000))) return null;
  if (body.arbeitnowStartPage !== undefined && (!validPage(body.arbeitnowStartPage, 1001) || (body.arbeitnowStartPage - 1) % ARBEITNOW_PAGES_PER_BATCH !== 0)) return null;
  if (body.jobicyCursor !== undefined && (typeof body.jobicyCursor !== "string" || body.jobicyCursor.length === 0 || body.jobicyCursor.length > 8192)) return null;
  return {
    includeAdzuna: body.includeAdzuna,
    roles: body.roles.trim(),
    locations: body.locations.trim(),
    ...(body.adzunaPage !== undefined ? { adzunaPage: body.adzunaPage } : {}),
    ...(body.arbeitnowStartPage !== undefined ? { arbeitnowStartPage: body.arbeitnowStartPage } : {}),
    ...(body.jobicyCursor !== undefined ? { jobicyCursor: body.jobicyCursor } : {}),
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawPage = url.searchParams.get("arbeitnowStartPage");
  const jobicyCursor = url.searchParams.get("jobicyCursor");
  const startPage = rawPage === null ? undefined : Number(rawPage);
  if (startPage !== undefined && (!Number.isSafeInteger(startPage) || startPage < 1 || (startPage - 1) % ARBEITNOW_PAGES_PER_BATCH !== 0 || startPage > 1001)) {
    return Response.json({ error: "Invalid job-feed page request." }, { status: 400 });
  }
  if (jobicyCursor !== null && (jobicyCursor.length === 0 || jobicyCursor.length > 8192)) {
    return Response.json({ error: "Invalid Jobicy continuation cursor." }, { status: 400 });
  }
  const result = await searchPublicJobs({
    ...(startPage !== undefined ? { arbeitnowStartPage: startPage } : {}),
    ...(jobicyCursor !== null ? { jobicyCursor } : {}),
  });
  if (result.jobs.length === 0 && result.errors.length > 0) {
    return Response.json({ ...result, error: "The public job feeds are temporarily unavailable. Try again shortly." }, { status: 503 });
  }
  return Response.json(result);
}

export async function POST(request: Request) {
  let raw: unknown;
  try { raw = await request.json() as unknown; } catch { return Response.json({ error: "Invalid job search request." }, { status: 400 }); }
  const options = parseAdzunaOptions(raw);
  if (!options) return Response.json({ error: "Invalid Adzuna search preferences." }, { status: 400 });
  const result = await searchPublicJobs({
    ...(options.includeAdzuna ? { adzunaSearch: { roles: options.roles, locations: options.locations } } : {}),
    ...(options.adzunaPage !== undefined ? { adzunaPage: options.adzunaPage } : {}),
    ...(options.arbeitnowStartPage !== undefined ? { arbeitnowStartPage: options.arbeitnowStartPage } : {}),
    ...(options.jobicyCursor !== undefined ? { jobicyCursor: options.jobicyCursor } : {}),
  });
  if (result.jobs.length === 0 && result.errors.length > 0) {
    return Response.json({ ...result, error: result.errors.join(" ") }, { status: 503 });
  }
  return Response.json(result);
}
