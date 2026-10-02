import { descriptionText } from "./greenhouse";
import type { Job } from "./types";

type ArbeitnowPosting = {
  slug?: string;
  company_name?: string;
  title?: string;
  description?: string;
  remote?: boolean | string;
  url?: string;
  location?: string;
  created_at?: string;
  job_types?: string[];
};
type ArbeitnowPage = { data?: ArbeitnowPosting[]; links?: { next?: string | null } };
type RemotivePosting = {
  id?: number;
  url?: string;
  title?: string;
  company_name?: string;
  candidate_required_location?: string;
  job_type?: string;
  publication_date?: string;
  description?: string;
  category?: string;
};
type RemotivePage = { jobs?: RemotivePosting[] };
type JobicyPosting = {
  id?: number;
  url?: string;
  jobTitle?: string;
  companyName?: string;
  jobGeo?: string;
  jobType?: string[];
  pubDate?: string;
  jobDescription?: string;
  jobExcerpt?: string;
  jobIndustry?: string[];
};
type JobicyPage = { jobs?: JobicyPosting[] };

function validHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function postedDate(value?: string) {
  if (!value) return "Date not provided";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date not provided" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function clean(value?: string) {
  return descriptionText(value ?? "");
}

function mapArbeitnow(posting: ArbeitnowPosting, retrievedAt: string): Job | null {
  if (!posting.title || !posting.company_name || !validHttpUrl(posting.url)) return null;
  const description = clean(posting.description);
  const remote = posting.remote === true || String(posting.remote).toLowerCase() === "true";
  return {
    id: `arbeitnow-${posting.slug || posting.url}`,
    company: posting.company_name,
    role: posting.title,
    location: posting.location || (remote ? "Remote" : "Location not specified"),
    mode: remote ? "Remote" : posting.job_types?.join(", ") || "See posting",
    posted: postedDate(posting.created_at),
    source: "Arbeitnow",
    sourceUrl: posting.url,
    sourceAttributionUrl: "https://www.arbeitnow.com/",
    retrievedAt,
    summary: description.slice(0, 1200) || "Open the listing for the full role description.",
    ...(description ? { description } : {}),
  };
}

function mapRemotive(posting: RemotivePosting, retrievedAt: string): Job | null {
  if (!posting.id || !posting.title || !posting.company_name || !validHttpUrl(posting.url)) return null;
  const description = clean(posting.description);
  return {
    id: `remotive-${posting.id}`,
    company: posting.company_name,
    role: posting.title,
    location: posting.candidate_required_location || "Remote",
    mode: posting.job_type || "Remote",
    posted: postedDate(posting.publication_date),
    source: "Remotive",
    sourceUrl: posting.url,
    sourceAttributionUrl: "https://remotive.com/remote-jobs/api",
    ...(posting.category ? { department: posting.category } : {}),
    retrievedAt,
    summary: description.slice(0, 1200) || "Open the Remotive listing for the full role description.",
    ...(description ? { description } : {}),
  };
}

function mapJobicy(posting: JobicyPosting, retrievedAt: string): Job | null {
  if (!posting.id || !posting.jobTitle || !posting.companyName || !validHttpUrl(posting.url)) return null;
  const description = clean(posting.jobDescription || posting.jobExcerpt);
  return {
    id: `jobicy-${posting.id}`,
    company: posting.companyName,
    role: posting.jobTitle,
    location: posting.jobGeo || "Remote",
    mode: posting.jobType?.join(", ") || "Remote",
    posted: postedDate(posting.pubDate),
    source: "Jobicy",
    sourceUrl: posting.url,
    sourceAttributionUrl: "https://jobicy.com/jobs-rss-feed",
    ...(posting.jobIndustry?.length ? { department: posting.jobIndustry.join(", ") } : {}),
    retrievedAt,
    summary: description.slice(0, 1200) || "Open the Jobicy listing for the full role description.",
    ...(description ? { description } : {}),
  };
}

async function getJson<T>(url: string, revalidate?: number): Promise<T> {
  const cacheOptions = revalidate === undefined
    ? { cache: "no-store" as const }
    : { next: { revalidate } };
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "JobpilotLocal/0.1 (public job search)" },
    signal: AbortSignal.timeout(15000),
    ...cacheOptions,
  });
  if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function arbeitnowJobs(retrievedAt: string) {
  const pages = await Promise.all(Array.from({ length: 5 }, (_, index) =>
    getJson<ArbeitnowPage>(`https://www.arbeitnow.com/api/job-board-api?page=${index + 1}`)));
  return pages.flatMap((page) => (page.data ?? []).map((posting) => mapArbeitnow(posting, retrievedAt)).filter((job): job is Job => job !== null));
}

async function remotiveJobs(retrievedAt: string) {
  const page = await getJson<RemotivePage>("https://remotive.com/api/remote-jobs", 21600);
  return (page.jobs ?? []).map((posting) => mapRemotive(posting, retrievedAt)).filter((job): job is Job => job !== null);
}

async function jobicyJobs(retrievedAt: string) {
  const page = await getJson<JobicyPage>("https://jobicy.com/api/v2/remote-jobs?count=100&geo=europe", 3600);
  return (page.jobs ?? []).map((posting) => mapJobicy(posting, retrievedAt)).filter((job): job is Job => job !== null);
}

export async function searchPublicJobs() {
  const retrievedAt = new Date().toISOString();
  const feeds = await Promise.allSettled([arbeitnowJobs(retrievedAt), remotiveJobs(retrievedAt), jobicyJobs(retrievedAt)]);
  const jobs = feeds.flatMap((feed) => feed.status === "fulfilled" ? feed.value : []);
  const errors = feeds.flatMap((feed, index) => feed.status === "rejected"
    ? [`${["Arbeitnow", "Remotive", "Jobicy"][index]} is temporarily unavailable.`]
    : []);
  const unique = new Map<string, Job>();
  jobs.forEach((job) => unique.set(job.sourceUrl ?? job.id, job));
  return { jobs: [...unique.values()], errors, retrievedAt };
}
