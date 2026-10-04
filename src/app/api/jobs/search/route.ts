import { ARBEITNOW_PAGES_PER_BATCH, searchPublicJobs } from "@/lib/job-search";

export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawPage = url.searchParams.get("arbeitnowStartPage");
  const startPage = rawPage === null ? 1 : Number(rawPage);
  if (!Number.isSafeInteger(startPage) || startPage < 1 || (startPage - 1) % ARBEITNOW_PAGES_PER_BATCH !== 0 || startPage > 1001) {
    return Response.json({ error: "Invalid job-feed page request." }, { status: 400 });
  }
  const result = await searchPublicJobs({ arbeitnowStartPage: startPage });
  if (result.jobs.length === 0 && result.errors.length > 0) {
    return Response.json({ ...result, error: "The public job feeds are temporarily unavailable. Try again shortly." }, { status: 503 });
  }
  return Response.json(result);
}
