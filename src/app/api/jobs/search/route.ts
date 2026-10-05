import { ARBEITNOW_PAGES_PER_BATCH, searchPublicJobs } from "../../../../lib/job-search";

export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawPage = url.searchParams.get("arbeitnowStartPage");
  const jobicyCursor = url.searchParams.get("jobicyCursor");
  const locations = url.searchParams.get("locations") ?? "";
  const roles = url.searchParams.get("roles") ?? "";
  if (locations.length > 2000 || roles.length > 2000) return Response.json({ error: "Search locations and job titles must each be 2,000 characters or less." }, { status: 400 });
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
    locations,
    roles,
  });
  // A healthy feed can return listings that do not match the user's local
  // filters. That is a successful search with zero matches, not an outage.
  const allSourcesFailed = result.sourceStatuses.length > 0 && result.sourceStatuses.every((source) => source.state === "failed");
  if (result.jobs.length === 0 && result.errors.length > 0 && allSourcesFailed) {
    return Response.json({ ...result, error: "The public job feeds are temporarily unavailable. Try again shortly." }, { status: 503 });
  }
  return Response.json(result);
}
