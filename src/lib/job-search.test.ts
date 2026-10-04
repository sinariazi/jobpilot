import { afterEach, describe, expect, it, vi } from "vitest";
import { searchPublicJobs } from "./job-search";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("searchPublicJobs", () => {
  it("requires credentials when optional Adzuna search is selected", async () => {
    vi.stubEnv("ADZUNA_APP_ID", "");
    vi.stubEnv("ADZUNA_APP_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("arbeitnow")) return Response.json({ data: [] });
      if (url.includes("remotive")) return Response.json({ jobs: [] });
      return Response.json({ jobs: [] });
    }));

    const result = await searchPublicJobs({ adzunaSearch: { roles: "Software Engineer", locations: "Austria" } });
    expect(result.jobs).toEqual([]);
    expect(result.errors).toContain("Adzuna is enabled but not configured. Add ADZUNA_APP_ID and ADZUNA_APP_KEY to .env.local, then restart Jobpilot.");
  });

  it("uses opt-in target role and supported location with server-side credentials", async () => {
    vi.stubEnv("ADZUNA_APP_ID", "test-id");
    vi.stubEnv("ADZUNA_APP_KEY", "test-secret");
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("api.adzuna.com")) return Response.json({ results: [{ id: 123, title: "Senior Engineer", company: { display_name: "Example" }, location: { display_name: "Vienna, Austria" }, description: "<p>Build systems</p>", created: "2026-10-03T10:00:00Z", redirect_url: "https://www.adzuna.at/jobs/land/ad/123" }] });
      if (url.includes("arbeitnow")) return Response.json({ data: [], links: { next: null } });
      if (url.includes("remotive")) return Response.json({ jobs: [] });
      return Response.json({ jobs: [] });
    }));

    const result = await searchPublicJobs({ adzunaSearch: { roles: "Senior Engineer", locations: "Vienna, Austria" } });
    const requestUrl = new URL(requests.find((url) => url.includes("api.adzuna.com"))!);

    expect(result.jobs.map((job) => job.source)).toContain("Adzuna");
    expect(result.jobs.find((job) => job.source === "Adzuna")?.sourceAttributionUrl).toBe("https://www.adzuna.at/");
    expect(requestUrl.pathname).toBe("/v1/api/jobs/at/search/1");
    expect(requestUrl.searchParams.get("what")).toBe("Senior Engineer");
    expect(requestUrl.searchParams.get("where")).toBe("Vienna, Austria");
    expect(requestUrl.searchParams.get("app_id")).toBe("test-id");
    expect(requestUrl.searchParams.get("app_key")).toBe("test-secret");
    expect(requests.filter((url) => url.includes("api.adzuna.com"))).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it("exposes Adzuna continuation when a full results page is returned", async () => {
    vi.stubEnv("ADZUNA_APP_ID", "test-id");
    vi.stubEnv("ADZUNA_APP_KEY", "test-secret");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("api.adzuna.com")) return Response.json({ results: Array.from({ length: 50 }, (_, index) => ({ id: index + 1, title: "Engineer", company: { display_name: "Example" }, redirect_url: `https://www.adzuna.at/jobs/${index + 1}` })) });
      if (url.includes("arbeitnow")) return Response.json({ data: [], links: { next: null } });
      if (url.includes("remotive")) return Response.json({ jobs: [] });
      return Response.json({ jobs: [] });
    }));

    const result = await searchPublicJobs({ adzunaSearch: { roles: "Engineer", locations: "Austria" } });
    expect(result.jobs.filter((job) => job.source === "Adzuna")).toHaveLength(50);
    expect(result.nextAdzunaPage).toBe(2);
  });

  it("combines listings from the public feeds and preserves attribution URLs", async () => {
    const requests: Array<{ url: string; options?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      const url = String(input);
      requests.push({ url, options });
      if (url.includes("arbeitnow")) return Response.json({ data: [{ slug: "role-a", company_name: "Example A", title: "Product Manager", description: "<p>Build a product</p>", remote: false, url: "https://employer.example/jobs/a", location: "Vienna" }] });
      if (url.includes("remotive")) return Response.json({ jobs: [{ id: 22, url: "https://remotive.com/remote-jobs/role-b", title: "Product Designer", company_name: "Example B", candidate_required_location: "Worldwide", job_type: "full_time", publication_date: "2026-10-01", description: "<p>Design products</p>" }] });
      return Response.json({ jobs: [{ id: 33, url: "https://jobicy.com/jobs/role-c", jobTitle: "Product Lead", companyName: "Example C", jobGeo: "Europe", jobType: ["full-time"], pubDate: "2026-10-01", jobDescription: "<p>Lead a team</p>", jobIndustry: ["Management"] }], nextCursor: "next-jobicy-page", hasMore: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchPublicJobs();
    expect(result.jobs.map((job) => job.source).sort()).toEqual(["Arbeitnow", "Jobicy", "Remotive"]);
    expect(result.jobs.find((job) => job.source === "Arbeitnow")?.sourceAttributionUrl).toBe("https://www.arbeitnow.com/");
    expect(result.jobs.find((job) => job.source === "Remotive")?.sourceUrl).toBe("https://remotive.com/remote-jobs/role-b");
    expect(result.jobs.find((job) => job.source === "Remotive")?.mode).toBe("Remote · full_time");
    expect(result.jobs.find((job) => job.source === "Remotive")?.postedAt).toBe("2026-10-01T00:00:00.000Z");
    expect(result.jobs.find((job) => job.source === "Jobicy")?.mode).toBe("Remote · full-time");
    expect(result.jobs.find((job) => job.source === "Jobicy")?.department).toBe("Management");
    expect(result.jobs.find((job) => job.source === "Jobicy")?.description).toBe("Lead a team");
    expect(result.errors).toEqual([]);
    expect(result.nextJobicyCursor).toBe("next-jobicy-page");
    expect(requests.filter(({ url }) => url.includes("arbeitnow")).every(({ options }) => options?.cache === "no-store" && !("next" in (options ?? {})))).toBe(true);
  });

  it("returns available feed results and identifies a failed feed", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("remotive")) throw new Error("offline");
      if (String(input).includes("arbeitnow")) return Response.json({ data: [] });
      return Response.json({ jobs: [] });
    }));

    const result = await searchPublicJobs();
    expect(result.jobs).toEqual([]);
    expect(result.errors).toEqual(["Remotive is temporarily unavailable."]);
  });

  it("loads only the requested subsequent Arbeitnow batch and reports the next page", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      const page = Number(new URL(url).searchParams.get("page"));
      return Response.json({
        data: [{ slug: `role-${page}`, company_name: "Example", title: "Engineer", url: `https://employer.example/jobs/${page}` }],
        links: { next: `https://www.arbeitnow.com/api/job-board-api?page=${page + 1}` },
      });
    }));

    const result = await searchPublicJobs({ arbeitnowStartPage: 6 });
    expect(requests.map((url) => Number(new URL(url).searchParams.get("page")))).toEqual([6, 7, 8, 9, 10]);
    expect(requests.every((url) => url.includes("arbeitnow"))).toBe(true);
    expect(result.jobs).toHaveLength(5);
    expect(result.nextArbeitnowPage).toBe(11);
    expect(result.nextJobicyCursor).toBeNull();
  });

  it("uses Jobicy's opaque cursor for later pages without re-fetching complete feeds", async () => {
    const requests: string[] = [];
    const token = "opaque+cursor/with=reserved&characters";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("arbeitnow")) return Response.json({ data: [], links: { next: null } });
      if (url.includes("remotive")) return Response.json({ jobs: [] });
      const cursor = new URL(url).searchParams.get("cursor");
      return cursor === null
        ? Response.json({ jobs: [{ id: 101, url: "https://jobicy.com/jobs/first", jobTitle: "First role", companyName: "Example" }], nextCursor: token, hasMore: true })
        : Response.json({ jobs: [{ id: 102, url: "https://jobicy.com/jobs/second", jobTitle: "Second role", companyName: "Example" }], nextCursor: null, hasMore: false });
    }));

    const firstPage = await searchPublicJobs();
    expect(firstPage.nextJobicyCursor).toBe(token);
    const secondPage = await searchPublicJobs({ jobicyCursor: firstPage.nextJobicyCursor! });

    expect(secondPage.jobs.map((job) => job.sourceUrl)).toEqual(["https://jobicy.com/jobs/second"]);
    expect(secondPage.nextJobicyCursor).toBeNull();
    const jobicyRequests = requests.filter((url) => url.includes("jobicy.com/api/v2/remote-jobs"));
    expect(new URL(jobicyRequests[0]).searchParams.get("cursor")).toBeNull();
    expect(new URL(jobicyRequests[1]).searchParams.get("cursor")).toBe(token);
    expect(requests.filter((url) => url.includes("remotive.com"))).toHaveLength(1);
    expect(requests.filter((url) => url.includes("arbeitnow.com"))).toHaveLength(5);
  });

  it("keeps Jobicy page listings when a continuation token is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("arbeitnow")) return Response.json({ data: [] });
      if (url.includes("remotive")) return Response.json({ jobs: [] });
      return Response.json({ jobs: [{ id: 103, url: "https://jobicy.com/jobs/loaded", jobTitle: "Loaded role", companyName: "Example" }], hasMore: true, nextCursor: null });
    }));

    const result = await searchPublicJobs();

    expect(result.jobs.map((job) => job.sourceUrl)).toContain("https://jobicy.com/jobs/loaded");
    expect(result.nextJobicyCursor).toBeNull();
    expect(result.errors).toContain("Jobicy reported more listings without a continuation cursor; this page loaded, but further pages cannot be requested.");
  });

  it("loads the next page from both pageable feeds in one request", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("arbeitnow")) {
        const page = Number(new URL(url).searchParams.get("page"));
        return Response.json({ data: [{ slug: `role-${page}`, company_name: "Example", title: "Engineer", url: `https://employer.example/jobs/${page}` }], links: { next: page === 10 ? null : `https://www.arbeitnow.com/api/job-board-api?page=${page + 1}` } });
      }
      if (url.includes("remotive")) return Response.json({ jobs: [] });
      expect(new URL(url).searchParams.get("cursor")).toBe("jobicy-next");
      return Response.json({ jobs: [{ id: 121, url: "https://jobicy.com/jobs/page", jobTitle: "Jobicy role", companyName: "Example" }], nextCursor: "jobicy-after", hasMore: true });
    }));

    const result = await searchPublicJobs({ arbeitnowStartPage: 6, jobicyCursor: "jobicy-next" });

    expect(result.jobs).toHaveLength(6);
    expect(result.nextArbeitnowPage).toBeNull();
    expect(result.nextJobicyCursor).toBe("jobicy-after");
    expect(requests.filter((url) => url.includes("arbeitnow"))).toHaveLength(5);
    expect(requests.filter((url) => url.includes("jobicy.com/api/v2/remote-jobs"))).toHaveLength(1);
    expect(requests.some((url) => url.includes("remotive.com"))).toBe(false);
  });

  it("stops Arbeitnow pagination when the provider explicitly returns no next link", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const page = Number(new URL(url).searchParams.get("page"));
      return Response.json({ data: [{ slug: `role-${page}`, company_name: "Example", title: "Engineer", url: `https://employer.example/jobs/${page}` }], links: { next: null } });
    }));

    const result = await searchPublicJobs({ arbeitnowStartPage: 6 });

    expect(result.jobs).toHaveLength(5);
    expect(result.nextArbeitnowPage).toBeNull();
  });
});
