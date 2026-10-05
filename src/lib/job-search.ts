import { descriptionText } from "./greenhouse";
import { matchesTargetRole } from "./matcher";
import { matchesPreferredLocation, resolveProviderGeographies, type ProviderGeography } from "./locations";
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
type JobicyLocationsPage = { locations?: Array<{ geoName?: string; geoSlug?: string }> };
export type SearchSourceStatus = { source: string; state: "success" | "partial" | "failed"; count: number; fetchedCount: number; checkedAt: string; message?: string };
export const PUBLIC_JOB_SOURCES = [
  { name: "Arbeitnow", access: "Public paginated JSON API; no key", geography: "Primarily Germany with some Europe-wide listings", fields: "Title, company, location, remote flag, employment type, description, posting date, link", freshness: "Provider-dependent; no freshness guarantee published", restriction: "Credit/link Arbeitnow; use is as-is and permission may be revoked" },
  { name: "Remotive", access: "Public JSON API; no key", geography: "Remote roles with candidate eligibility text; not a broad local Austria board", fields: "Title, company, required location, job type, category, HTML description, date, source link", freshness: "Listings are delayed 24 hours; cache and fetch no more than four times daily", restriction: "Link the Remotive listing and identify Remotive; not for reposting to third-party job boards" },
  { name: "Jobicy", access: "Public JSON API; no key or registration", geography: "Remote jobs; location and keyword filters; rolling seven-day feed", fields: "Title, company, geo eligibility, type, industry, description, date, Jobicy link", freshness: "Three-hour publication delay; only the last seven days; cursor is valid 24 hours", restriction: "Preserve canonical Jobicy link and source attribution; avoid excessive requests" },
] as const;

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

function mapJobicy(posting: JobicyPosting, retrievedAt: string, sourceLocationScope = ""): Job | null {
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
    ...(sourceLocationScope ? { sourceLocationScope } : {}),
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
const ARBEITNOW_MAX_START_PAGE = 1001;

async function getArbeitnowPage(page: number) {
  const url = `https://www.arbeitnow.com/api/job-board-api?page=${page}`;
  try {
    return await getJson<ArbeitnowPage>(url);
  } catch (error) {
    // Retry transient provider throttling/outages once. Network timeouts and
    // malformed responses are reported directly instead of extending delays.
    if (!(error instanceof Error) || !/HTTP (?:429|5\d\d)/.test(error.message)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 300));
    return getJson<ArbeitnowPage>(url);
  }
}

async function arbeitnowJobs(retrievedAt: string, startPage: number) {
  const requests = await Promise.allSettled(Array.from({ length: ARBEITNOW_PAGES_PER_BATCH }, (_, index) =>
    getArbeitnowPage(startPage + index)));
  const pages = requests.flatMap((result, index) => result.status === "fulfilled" ? [{ pageNumber: startPage + index, value: result.value }] : []);
  const pageErrors = requests.flatMap((result, index) => result.status === "rejected" ? [`Arbeitnow page ${startPage + index} failed; other feed results are still available.`] : []);
  const jobs = pages.flatMap(({ value }) => (value.data ?? []).map((posting) => mapArbeitnow(posting, retrievedAt)).filter((job): job is Job => job !== null));
  // A failed last request must not strand the feed: use the highest page that
  // did arrive to determine whether more pages exist, then move past this batch.
  const lastFetched = pages.at(-1);
  const lastPage = lastFetched?.value;
  const nextLink = lastPage?.links?.next;
  const linkedNextPage = typeof nextLink === "string" ? (() => {
      try {
        const url = new URL(nextLink, "https://www.arbeitnow.com");
        const page = Number(url.searchParams.get("page"));
        return url.hostname === "www.arbeitnow.com" && url.pathname === "/api/job-board-api" && Number.isSafeInteger(page) && page > lastFetched!.pageNumber;
      } catch { return false; }
    })() : false;
  const hasMore = lastPage?.links && "next" in lastPage.links
    ? linkedNextPage
    : (lastPage?.data?.length ?? 0) > 0;
  const nextPage = startPage + ARBEITNOW_PAGES_PER_BATCH;
  return { jobs, nextArbeitnowPage: hasMore && nextPage <= ARBEITNOW_MAX_START_PAGE ? nextPage : null, pageErrors, state: pageErrors.length === requests.length ? "failed" as const : pageErrors.length ? "partial" as const : "success" as const };
}

async function remotiveJobs(retrievedAt: string) {
  const page = await getJson<RemotivePage>("https://remotive.com/api/remote-jobs", 21600);
  return (page.jobs ?? []).map((posting) => mapRemotive(posting, retrievedAt)).filter((job): job is Job => job !== null);
}

type JobicyCursorState = Record<string, string>;
function decodeJobicyCursor(cursor?: string): JobicyCursorState {
  if (!cursor) return {};
  try {
    const decoded = JSON.parse(Buffer.from(cursor.replace(/^jp1\./, ""), "base64url").toString("utf8")) as unknown;
    if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
      return Object.fromEntries(Object.entries(decoded).filter(([key, value]) => key.length <= 100 && typeof value === "string" && value.length <= 4096)) as JobicyCursorState;
    }
  } catch { /* An old single-feed cursor is handled below. */ }
  return { europe: cursor };
}

function encodeJobicyCursor(cursors: JobicyCursorState) {
  return Object.keys(cursors).length ? `jp1.${Buffer.from(JSON.stringify(cursors)).toString("base64url")}` : null;
}

async function jobicyJobs(retrievedAt: string, geographies: ProviderGeography[], cursor?: string) {
  const priorCursors = decodeJobicyCursor(cursor);
  const outcomes = await Promise.allSettled(geographies.map(async (geo) => {
    // Jobicy documents a maximum of 200 results per cursor page. Requesting
    // that limit widens the local candidate pool without adding API calls.
    const params = new URLSearchParams({ count: "200", geo: geo.slug });
    if (priorCursors[geo.slug]) params.set("cursor", priorCursors[geo.slug]);
    const page = await getJson<JobicyPage>(`https://jobicy.com/api/v2/remote-jobs?${params}`, 3600);
    if (page.success === false) throw new Error(typeof page.error === "string" ? page.error : "Jobicy rejected the request.");
    return { geo, page };
  }));
  const cursors: JobicyCursorState = {};
  const jobs: Job[] = [];
  const errors: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") { errors.push("Jobicy failed for one selected region; results from other regions and feeds are retained."); continue; }
    const { geo, page } = outcome.value;
    jobs.push(...(page.jobs ?? []).map((posting) => mapJobicy(posting, retrievedAt, geo.slug)).filter((job): job is Job => job !== null));
    if (page.hasMore === true && typeof page.nextCursor === "string" && page.nextCursor.length > 0) cursors[geo.slug] = page.nextCursor;
    else if (page.hasMore === true) errors.push("Jobicy reported more listings without a continuation cursor; this page loaded, but further pages cannot be requested.");
  }
  return { jobs, nextJobicyCursor: encodeJobicyCursor(cursors), errors, state: outcomes.length > 0 && outcomes.every((outcome) => outcome.status === "rejected") ? "failed" as const : errors.length ? "partial" as const : "success" as const };
}

function canonicalUrl(value?: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|source$|gh_src$|trk$)/i.test(key)) url.searchParams.delete(key);
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch { return value.trim().toLowerCase(); }
}

function normalizedIdentity(value: string) {
  return value.toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function mergeDuplicate(previous: Job, current: Job): Job {
  const preferred = (current.description?.length ?? 0) > (previous.description?.length ?? 0) ? current : previous;
  return {
    ...preferred,
    ...(preferred.description ? {} : previous.description || current.description ? { description: previous.description || current.description } : {}),
    ...(preferred.postedAt || !previous.postedAt && !current.postedAt ? {} : { postedAt: previous.postedAt ?? current.postedAt }),
    sourceAliases: [...new Set([...(previous.sourceAliases ?? [previous.source]), ...(current.sourceAliases ?? [current.source])])],
  };
}

export async function searchPublicJobs(options: { arbeitnowStartPage?: number; jobicyCursor?: string; locations?: string; roles?: string } = {}) {
  const retrievedAt = new Date().toISOString();
  const startPage = options.arbeitnowStartPage ?? 1;
  const loadingMore = options.arbeitnowStartPage !== undefined || options.jobicyCursor !== undefined;
  const requestArbeitnow = !loadingMore || options.arbeitnowStartPage !== undefined;
  const requestRemotive = !loadingMore;
  const requestJobicy = !loadingMore || options.jobicyCursor !== undefined;
  const [geoOutcome, arbeitnowResult, remotiveResult] = await Promise.all([
    requestJobicy ? getJson<JobicyLocationsPage>("https://jobicy.com/api/v2/remote-jobs?get=locations", 86400)
      .then((data) => ({ state: "success" as const, value: resolveProviderGeographies(options.locations ?? "", (data.locations ?? []).flatMap((item) => item.geoName && item.geoSlug ? [{ name: item.geoName, slug: item.geoSlug }] : [])) }))
      .catch(() => ({ state: "failed" as const, error: "Jobicy's public location list is unavailable; its feed was skipped." })) : Promise.resolve(null),
    requestArbeitnow ? arbeitnowJobs(retrievedAt, startPage).then((result) => ({ status: "fulfilled" as const, value: result }), (reason) => ({ status: "rejected" as const, reason })) : Promise.resolve(null),
    requestRemotive ? remotiveJobs(retrievedAt).then((value) => ({ status: "fulfilled" as const, value }), (reason) => ({ status: "rejected" as const, reason })) : Promise.resolve(null),
  ]);
  const geoResult = geoOutcome?.state === "success" ? geoOutcome.value : null;
  const jobicyResult = requestJobicy && geoResult
    ? await jobicyJobs(retrievedAt, geoResult.geographies, options.jobicyCursor).then((value) => ({ status: "fulfilled" as const, value }), (reason) => ({ status: "rejected" as const, reason }))
    : requestJobicy && geoOutcome?.state === "failed" ? { status: "rejected" as const, reason: new Error(geoOutcome.error) }
    : null;
  const jobsBySource = new Map<string, Job[]>();
  const errors: string[] = [];
  const skipped = new Set<string>();
  let nextArbeitnowPage: number | null = loadingMore ? options.arbeitnowStartPage ?? null : null;
  let nextJobicyCursor: string | null = loadingMore ? options.jobicyCursor ?? null : null;
  if (geoResult?.warning) errors.push(geoResult.warning);
  if (geoOutcome?.state === "failed") { errors.push(geoOutcome.error); skipped.add("Jobicy"); }
  if (geoResult?.geographies.length === 0) skipped.add("Jobicy");
  if (arbeitnowResult) {
    if (arbeitnowResult.status === "fulfilled") {
      jobsBySource.set("Arbeitnow", arbeitnowResult.value.jobs);
      if (arbeitnowResult.value.state !== "success") errors.push(arbeitnowResult.value.state === "failed" ? "Arbeitnow is temporarily unavailable." : "Arbeitnow had partial page failures; successfully fetched pages remain available.");
      errors.push(...arbeitnowResult.value.pageErrors);
      nextArbeitnowPage = arbeitnowResult.value.nextArbeitnowPage;
    } else errors.push("Arbeitnow is temporarily unavailable.");
  }
  if (remotiveResult) {
    if (remotiveResult.status === "fulfilled") jobsBySource.set("Remotive", remotiveResult.value);
    else errors.push("Remotive is temporarily unavailable.");
  }
  if (jobicyResult) {
    if (jobicyResult.status === "fulfilled") {
      jobsBySource.set("Jobicy", jobicyResult.value.jobs);
      if (jobicyResult.value.state !== "success") errors.push(jobicyResult.value.state === "failed" ? "Jobicy is temporarily unavailable." : "Jobicy had partial region failures; successful regions remain available.");
      errors.push(...jobicyResult.value.errors);
      nextJobicyCursor = jobicyResult.value.nextJobicyCursor;
    } else errors.push("Jobicy is temporarily unavailable.");
  }
  const candidates = [...jobsBySource.values()].flat();
  const unique = new Map<string, Job>();
  for (const job of candidates) {
    const key = canonicalUrl(job.sourceUrl) || [normalizedIdentity(job.role), normalizedIdentity(job.company), normalizedIdentity(job.location)].join("|");
    unique.set(key, unique.has(key) ? mergeDuplicate(unique.get(key)!, job) : { ...job, sourceAliases: [job.source] });
  }
  const discoveredJobs = [...unique.values()];
  const jobs = discoveredJobs.filter((job) =>
    matchesPreferredLocation(job.location, options.locations ?? "", job.mode, job.source, job.sourceLocationScope)
    && (!(options.roles ?? "").trim() || matchesTargetRole(job, options.roles ?? "")));
  const sourceStatuses: SearchSourceStatus[] = PUBLIC_JOB_SOURCES.filter((source) => jobsBySource.has(source.name) || errors.some((error) => error.startsWith(source.name)) || skipped.has(source.name)).map((source) => {
    const sourceJobs = jobs.filter((job) => job.sourceAliases?.includes(source.name) || job.source === source.name);
    const failed = skipped.has(source.name) ? true
      : source.name === "Arbeitnow" && arbeitnowResult?.status === "fulfilled" ? arbeitnowResult.value.state === "failed"
      : source.name === "Jobicy" && jobicyResult?.status === "fulfilled" ? jobicyResult.value.state === "failed"
        : errors.some((error) => error.startsWith(source.name) && !/page \d+ failed|failed for one selected region|had partial/.test(error));
    const partial = source.name === "Arbeitnow" && arbeitnowResult?.status === "fulfilled" ? arbeitnowResult.value.state === "partial"
      : source.name === "Jobicy" && jobicyResult?.status === "fulfilled" ? jobicyResult.value.state === "partial"
        : errors.some((error) => error.startsWith(source.name) && !failed);
    return { source: source.name, state: skipped.has(source.name) ? "failed" : failed ? sourceJobs.length ? "partial" : "failed" : partial ? "partial" : "success", count: sourceJobs.length, fetchedCount: jobsBySource.get(source.name)?.length ?? 0, checkedAt: retrievedAt, ...(errors.find((error) => error.startsWith(source.name)) ? { message: errors.find((error) => error.startsWith(source.name)) } : geoResult?.warning && source.name === "Jobicy" ? { message: geoResult.warning } : {}) };
  });
  return { jobs, discoveredJobs, errors, retrievedAt, nextArbeitnowPage, nextJobicyCursor, sourceStatuses };
}
