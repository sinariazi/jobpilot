import type { Job } from "./types";

type GreenhousePosting = {
  id: number;
  title: string;
  updated_at?: string;
  absolute_url: string;
  location?: { name?: string };
  departments?: { name: string }[];
  content?: string;
};

type GreenhouseResponse = { jobs?: GreenhousePosting[] };

export function descriptionText(value: string) {
  return value
    .replace(/<(br\s*\/?|\/p|\/div|\/li|\/h[1-6]|\/section|\/ul|\/ol)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => {
      const point = code[0].toLowerCase() === "x" ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10);
      return Number.isFinite(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    })
    .replace(/[\t\r ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 8000);
}

function inferSkills(text: string) {
  const catalog = ["TypeScript", "JavaScript", "React", "Next.js", "Node.js", "Python", "PostgreSQL", "AWS", "Azure", "Docker", "Kubernetes", "Kafka", "CI/CD", "GraphQL", "REST APIs", "Playwright", "LLM", "AI", "system design", "observability"];
  const lowered = text.toLowerCase();
  return catalog.filter((skill) => lowered.includes(skill.toLowerCase()));
}

export async function fetchGreenhouseJobs(slugs: string[]): Promise<{ jobs: Job[]; errors: string[] }> {
  const fetchedAt = new Date().toISOString();
  const results = await Promise.all(slugs.map(async (rawSlug) => {
    const slug = rawSlug.trim().toLowerCase();
    if (!/^[a-z0-9-]{1,80}$/.test(slug)) return { jobs: [] as Job[], error: `Skipped invalid Greenhouse board slug: ${rawSlug}` };
    try {
      const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`, {
        headers: { Accept: "application/json", "User-Agent": "JobpilotLocal/0.1 (public job-board listings)" },
        signal: AbortSignal.timeout(12000),
        cache: "no-store",
      });
      if (!response.ok) return { jobs: [] as Job[], error: `${slug}: Greenhouse returned HTTP ${response.status}` };
      const payload = await response.json() as GreenhouseResponse;
      const jobs = (payload.jobs ?? []).map((posting): Job => {
        const description = descriptionText(posting.content ?? "");
        const summary = description.slice(0, 1200) || "Open the original posting for the full role description.";
        const text = `${posting.title} ${summary}`;
        return {
          id: `gh-${slug}-${posting.id}`,
          company: slug.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
          role: posting.title,
          location: posting.location?.name || "Location not specified",
          mode: /remote/i.test(`${posting.location?.name ?? ""} ${summary}`) ? "Remote / flexible" : "See posting",
          posted: posting.updated_at ? new Date(posting.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Date not provided",
          source: "Greenhouse",
          ...(posting.departments?.length ? { department: posting.departments.map((department) => department.name).join(", ").slice(0, 500) } : {}),
          sourceUrl: posting.absolute_url,
          retrievedAt: fetchedAt,
          skills: inferSkills(text),
          required: inferSkills(`${posting.title} ${description}`).slice(0, 6),
          summary,
          ...(description ? { description } : {}),
          isLive: true,
        };
      });
      return { jobs, error: "" };
    } catch {
      return { jobs: [] as Job[], error: `${slug}: could not reach the Greenhouse public board API` };
    }
  }));
  return { jobs: results.flatMap((result) => result.jobs), errors: results.map((result) => result.error).filter(Boolean) };
}
