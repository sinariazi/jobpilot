import { searchPublicJobs } from "@/lib/job-search";

export const maxDuration = 60;

export async function GET() {
  const result = await searchPublicJobs();
  if (result.jobs.length === 0 && result.errors.length > 0) {
    return Response.json({ ...result, error: "The public job feeds are temporarily unavailable. Try again shortly." }, { status: 503 });
  }
  return Response.json(result);
}
