import { descriptionText } from "./greenhouse";
import { adzunaLocationForMarket, adzunaMarketsForLocations, mapAdzunaPosting } from "./adzuna";
import type { AdzunaPage } from "./adzuna";
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
type JobicyPage = { jobs?: JobicyPosting[]; nextCursor?: string | null; hasMore?: boolean; success?: boolean; error?: string };
type AdzunaSearch = { roles: string; locations: string };

function validHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function postedDate(value?: string) {
  if (!value) return "Date not provided";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date not provided" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function publishedAt(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
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
    ...(publishedAt(posting.created_at) ? { postedAt: publishedAt(posting.created_at) } : {}),
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
    mode: `Remote${posting.job_type ? ` · ${posting.job_type}` : ""}`,
    posted: postedDate(posting.publication_date),
    ...(publishedAt(posting.publication_date) ? { postedAt: publishedAt(posting.publication_date) } : {}),
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
    mode: `Remote${posting.jobType?.length ? ` · ${posting.jobType.join(", ")}` : ""}`,
    posted: postedDate(posting.pubDate),
    ...(publishedAt(posting.pubDate) ? { postedAt: publishedAt(posting.pubDate) } : {}),
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

export const ARBEITNOW_PAGES_PER_BATCH = 5;

async function arbeitnowJobs(retrievedAt: string, startPage: number) {
  const pages = await Promise.all(Array.from({ length: ARBEITNOW_PAGES_PER_BATCH }, (_, index) =>
    getJson<ArbeitnowPage>(`https://www.arbeitnow.com/api/job-board-api?page=${startPage + index}`)));
  const jobs = pages.flatMap((page) => (page.data ?? []).map((posting) => mapArbeitnow(posting, retrievedAt)).filter((job): job is Job => job !== null));
  const lastPage = pages.at(-1);
  const nextLink = lastPage?.links?.next;
  const hasMore = lastPage?.links && "next" in lastPage.links
    ? typeof nextLink === "string" && (() => {
      try {
        const url = new URL(nextLink, "https://www.arbeitnow.com");
        return url.hostname === "www.arbeitnow.com" && url.pathname === "/api/job-board-api" && Number(url.searchParams.get("page")) === startPage + ARBEITNOW_PAGES_PER_BATCH;
      } catch { return false; }
    })()
    : (lastPage?.data?.length ?? 0) > 0;
  return { jobs, nextArbeitnowPage: hasMore ? startPage + ARBEITNOW_PAGES_PER_BATCH : null };
}

async function remotiveJobs(retrievedAt: string) {
  const page = await getJson<RemotivePage>("https://remotive.com/api/remote-jobs", 21600);
  return (page.jobs ?? []).map((posting) => mapRemotive(posting, retrievedAt)).filter((job): job is Job => job !== null);
}

async function jobicyJobs(retrievedAt: string, cursor?: string) {
  const params = new URLSearchParams({ count: "100", geo: "europe" });
  if (cursor !== undefined) params.set("cursor", cursor);
  const page = await getJson<JobicyPage>(`https://jobicy.com/api/v2/remote-jobs?${params}`, 3600);
  if (page.success === false) throw new Error(typeof page.error === "string" ? page.error : "Jobicy rejected the request.");
  const hasCursor = typeof page.nextCursor === "string" && page.nextCursor.length > 0;
  const paginationError = page.hasMore === true && !hasCursor ? "Jobicy reported more listings without a continuation cursor; this page loaded, but further pages cannot be requested." : undefined;
  return {
    jobs: (page.jobs ?? []).map((posting) => mapJobicy(posting, retrievedAt)).filter((job): job is Job => job !== null),
    nextJobicyCursor: page.hasMore === false || !hasCursor ? null : page.nextCursor!,
    ...(paginationError ? { paginationError } : {}),
  };
}

const ADZUNA_RESULTS_PER_PAGE = 50;

async function adzunaJobs(retrievedAt: string, search: AdzunaSearch, pageNumber: number) {
  const appId = process.env.ADZUNA_APP_ID?.trim();
  const appKey = process.env.ADZUNA_APP_KEY?.trim();
  if (!appId || !appKey) return { jobs: [] as Job[], errors: ["Adzuna is enabled but not configured. Add ADZUNA_APP_ID and ADZUNA_APP_KEY to .env.local, then restart Jobpilot."] };
  const markets = adzunaMarketsForLocations(search.locations);
  if (!search.roles.trim()) return { jobs: [] as Job[], errors: ["Add target job titles to your profile before using Adzuna search."] };
  if (!markets.length) return { jobs: [] as Job[], errors: ["Adzuna supports selected markets only. Add a supported country name (for example Austria or Switzerland) to your preferred locations."] };
  const results = await Promise.all(markets.map(async (market) => {
    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      "content-type": "application/json",
      results_per_page: String(ADZUNA_RESULTS_PER_PAGE),
      what: search.roles.trim(),
      where: adzunaLocationForMarket(search.locations, market),
    });
    const response = await getJson<AdzunaPage>(`https://api.adzuna.com/v1/api/jobs/${market.code}/search/${pageNumber}?${params}`);
    const postings = response.results ?? [];
    return {
      jobs: postings.map((posting) => mapAdzunaPosting(posting, market, retrievedAt)).filter((job): job is Job => job !== null),
      hasMore: postings.length === ADZUNA_RESULTS_PER_PAGE,
    };
  }));
  return {
    jobs: results.flatMap((result) => result.jobs),
    errors: [],
    nextAdzunaPage: pageNumber < 1000 && results.some((result) => result.hasMore) ? pageNumber + 1 : null,
  };
}

export async function searchPublicJobs(options: { arbeitnowStartPage?: number; jobicyCursor?: string; adzunaPage?: number; adzunaSearch?: AdzunaSearch } = {}) {
  const retrievedAt = new Date().toISOString();
  const startPage = options.arbeitnowStartPage ?? 1;
  const loadingMore = options.arbeitnowStartPage !== undefined || options.jobicyCursor !== undefined || options.adzunaPage !== undefined;
  const requestArbeitnow = !loadingMore || options.arbeitnowStartPage !== undefined;
  const requestRemotive = !loadingMore;
  const requestJobicy = !loadingMore || options.jobicyCursor !== undefined;
  const requestAdzuna = options.adzunaSearch !== undefined && (!loadingMore || options.adzunaPage !== undefined);
  const [arbeitnowResult, remotiveResult, jobicyResult, adzunaResult] = await Promise.all([
    requestArbeitnow ? Promise.allSettled([arbeitnowJobs(retrievedAt, startPage)]).then(([result]) => result) : Promise.resolve(null),
    requestRemotive ? Promise.allSettled([remotiveJobs(retrievedAt)]).then(([result]) => result) : Promise.resolve(null),
    requestJobicy ? Promise.allSettled([jobicyJobs(retrievedAt, options.jobicyCursor)]).then(([result]) => result) : Promise.resolve(null),
    requestAdzuna ? Promise.allSettled([adzunaJobs(retrievedAt, options.adzunaSearch!, options.adzunaPage ?? 1)]).then(([result]) => result) : Promise.resolve(null),
  ]);
  let jobs: Job[] = [];
  const errors: string[] = [];
  let nextArbeitnowPage: number | null = loadingMore ? options.arbeitnowStartPage ?? null : null;
  let nextJobicyCursor: string | null = loadingMore ? options.jobicyCursor ?? null : null;
  let nextAdzunaPage: number | null = null;
  if (arbeitnowResult) {
    if (arbeitnowResult.status === "fulfilled") {
      jobs = [...jobs, ...arbeitnowResult.value.jobs];
      nextArbeitnowPage = arbeitnowResult.value.nextArbeitnowPage;
    } else errors.push("Arbeitnow is temporarily unavailable.");
  }
  if (remotiveResult) {
    if (remotiveResult.status === "fulfilled") jobs = [...jobs, ...remotiveResult.value];
    else errors.push("Remotive is temporarily unavailable.");
  }
  if (jobicyResult) {
    if (jobicyResult.status === "fulfilled") {
      jobs = [...jobs, ...jobicyResult.value.jobs];
      nextJobicyCursor = jobicyResult.value.nextJobicyCursor;
      if (jobicyResult.value.paginationError) errors.push(jobicyResult.value.paginationError);
    } else errors.push("Jobicy is temporarily unavailable.");
  }
  if (adzunaResult) {
    if (adzunaResult.status === "fulfilled") {
      jobs = [...jobs, ...adzunaResult.value.jobs];
      errors.push(...adzunaResult.value.errors);
      nextAdzunaPage = "nextAdzunaPage" in adzunaResult.value ? adzunaResult.value.nextAdzunaPage ?? null : null;
    } else errors.push("Adzuna is temporarily unavailable. Check your API credentials and provider quota.");
  }
  const unique = new Map<string, Job>();
  jobs.forEach((job) => unique.set(job.sourceUrl ?? job.id, job));
  return { jobs: [...unique.values()], errors, retrievedAt, nextArbeitnowPage, nextJobicyCursor, nextAdzunaPage };
}
