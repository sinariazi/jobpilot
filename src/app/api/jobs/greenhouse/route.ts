import { fetchGreenhouseJobs } from "@/lib/greenhouse";

export async function POST(request: Request) {
  let body: { slugs?: unknown };
  try {
    body = await request.json() as { slugs?: unknown };
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!Array.isArray(body.slugs) || !body.slugs.every((slug) => typeof slug === "string")) {
    return Response.json({ error: "Provide a list of Greenhouse board slugs." }, { status: 400 });
  }
  const slugs = [...new Set(body.slugs)].slice(0, 10);
  if (slugs.length === 0) return Response.json({ error: "Enter at least one Greenhouse board slug." }, { status: 400 });
  const result = await fetchGreenhouseJobs(slugs);
  return Response.json(result);
}
