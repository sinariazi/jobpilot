import { afterEach, describe, expect, it, vi } from "vitest";
import { searchPublicJobs } from "./job-search";

afterEach(() => vi.unstubAllGlobals());

const locations = [{ geoName: "Austria", geoSlug: "austria" }, { geoName: "Europe", geoSlug: "europe" }, { geoName: "Anywhere", geoSlug: "anywhere" }];
function emptySourceResponse(url: string) {
  if (url.includes("get=locations")) return Response.json({ locations });
  if (url.includes("remotive")) return Response.json({ jobs: [] });
  if (url.includes("arbeitnow")) return Response.json({ data: [] });
  return Response.json({ jobs: [] });
}

describe("searchPublicJobs", () => {
  it("normalizes the public feeds with original source details and retrieval metadata", async () => {
    const requests: Array<{ url: string; options?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      const url = String(input); requests.push({ url, options });
      if (url.includes("get=locations")) return Response.json({ locations });
      if (url.includes("arbeitnow")) return Response.json({ data: [{ slug: "role-a", company_name: "Example A", title: "Product Manager", description: "<p>Build a product</p>", remote: false, url: "https://employer.example/jobs/a", location: "Vienna", created_at: "2026-10-02" }] });
      if (url.includes("remotive")) return Response.json({ jobs: [{ id: 22, url: "https://remotive.com/remote-jobs/role-b", title: "Product Designer", company_name: "Example B", candidate_required_location: "Worldwide", job_type: "full_time", publication_date: "2026-10-01", description: "<p>Design products</p>" }] });
      return Response.json({ jobs: [{ id: 33, url: "https://jobicy.com/jobs/role-c", jobTitle: "Product Lead", companyName: "Example C", jobGeo: "Europe", jobType: ["full-time"], pubDate: "2026-10-01", jobDescription: "<p>Lead a team</p>", jobIndustry: ["Management"] }], nextCursor: "next-jobicy-page", hasMore: true });
    }));
    const result = await searchPublicJobs();
    expect(result.jobs.map((job) => job.source).sort()).toEqual(["Arbeitnow", "Jobicy", "Remotive"]);
    expect(result.jobs.find((job) => job.source === "Arbeitnow")?.sourceAttributionUrl).toBe("https://www.arbeitnow.com/");
    expect(result.jobs.find((job) => job.source === "Remotive")?.sourceUrl).toBe("https://remotive.com/remote-jobs/role-b");
    expect(result.jobs.find((job) => job.source === "Remotive")?.mode).toBe("Remote · full_time");
    expect(result.jobs.find((job) => job.source === "Jobicy")?.department).toBe("Management");
    expect(result.jobs.find((job) => job.source === "Jobicy")?.description).toBe("Lead a team");
    expect(result.jobs.find((job) => job.source === "Jobicy")?.sourceLocationScope).toBe("europe");
    expect(result.nextJobicyCursor).toMatch(/^jp1\./);
    expect(result.sourceStatuses).toHaveLength(3);
    expect(result.sourceStatuses.every((source) => source.fetchedCount === 1 && source.count === 1)).toBe(true);
    expect(result.errors).toContain("No location preference was supplied; the remote-job feed uses its Europe-wide public feed.");
    expect(requests.filter(({ url }) => url.includes("arbeitnow")).every(({ options }) => options?.cache === "no-store")).toBe(true);
  });

  it("retains successful source results and reports a failed feed", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("remotive")) throw new Error("offline");
      return emptySourceResponse(url);
    }));
    const result = await searchPublicJobs({ locations: "Austria" });
    expect(result.errors).toContain("Remotive is temporarily unavailable.");
    expect(result.sourceStatuses.find((source) => source.source === "Remotive")?.state).toBe("failed");
  });

  it("loads only the requested Arbeitnow page batch and validates pagination", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input); requests.push(url);
      const page = Number(new URL(url).searchParams.get("page"));
      return Response.json({ data: [{ slug: `role-${page}`, company_name: "Example", title: "Engineer", url: `https://employer.example/jobs/${page}`, location: "Vienna" }], links: { next: `https://www.arbeitnow.com/api/job-board-api?page=${page + 1}` } });
    }));
    const result = await searchPublicJobs({ arbeitnowStartPage: 6, locations: "Austria" });
    expect(requests.map((url) => Number(new URL(url).searchParams.get("page")))).toEqual([6, 7, 8, 9, 10]);
    expect(requests.every((url) => url.includes("arbeitnow"))).toBe(true);
    expect(result.jobs).toHaveLength(5);
    expect(result.nextArbeitnowPage).toBe(11);
    expect(result.nextJobicyCursor).toBeNull();
  });

  it("uses a provider cursor without re-fetching the complete feeds", async () => {
    const requests: string[] = [];
    const token = "opaque+cursor/with=reserved&characters";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input); requests.push(url);
      if (url.includes("get=locations")) return Response.json({ locations });
      if (url.includes("arbeitnow")) return Response.json({ data: [], links: { next: null } });
      if (url.includes("remotive")) return Response.json({ jobs: [] });
      const cursor = new URL(url).searchParams.get("cursor");
      return cursor === null
        ? Response.json({ jobs: [{ id: 101, url: "https://jobicy.com/jobs/first", jobTitle: "First role", companyName: "Example", jobGeo: "Europe" }], nextCursor: token, hasMore: true })
        : Response.json({ jobs: [{ id: 102, url: "https://jobicy.com/jobs/second", jobTitle: "Second role", companyName: "Example", jobGeo: "Europe" }], nextCursor: null, hasMore: false });
    }));
    const first = await searchPublicJobs({ locations: "Remote Europe" });
    const second = await searchPublicJobs({ jobicyCursor: first.nextJobicyCursor!, locations: "Remote Europe" });
    expect(first.nextJobicyCursor).toMatch(/^jp1\./);
    expect(second.jobs.map((job) => job.sourceUrl)).toEqual(["https://jobicy.com/jobs/second"]);
    expect(second.nextJobicyCursor).toBeNull();
    const jobicyRequests = requests.filter((url) => url.includes("jobicy.com/api/v2/remote-jobs") && !url.includes("get=locations"));
    expect(new URL(jobicyRequests[0]).searchParams.get("cursor")).toBeNull();
    expect(new URL(jobicyRequests[0]).searchParams.get("count")).toBe("200");
    expect(new URL(jobicyRequests[1]).searchParams.get("cursor")).toBe(token);
    expect(requests.filter((url) => url.includes("remotive.com"))).toHaveLength(1);
    expect(requests.filter((url) => url.includes("arbeitnow.com"))).toHaveLength(5);
  });

  it("keeps page listings when Jobicy fails to return a continuation cursor", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("get=locations")) return Response.json({ locations });
      if (url.includes("arbeitnow")) return Response.json({ data: [] });
      if (url.includes("remotive")) return Response.json({ jobs: [] });
      return Response.json({ jobs: [{ id: 103, url: "https://jobicy.com/jobs/loaded", jobTitle: "Loaded role", companyName: "Example", jobGeo: "Europe" }], hasMore: true, nextCursor: null });
    }));
    const result = await searchPublicJobs({ locations: "Remote Europe" });
    expect(result.jobs.map((job) => job.sourceUrl)).toContain("https://jobicy.com/jobs/loaded");
    expect(result.nextJobicyCursor).toBeNull();
    expect(result.errors).toContain("Jobicy reported more listings without a continuation cursor; this page loaded, but further pages cannot be requested.");
  });

  it("loads both pageable sources while preserving bounded next-page state", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input); requests.push(url);
      if (url.includes("get=locations")) return Response.json({ locations });
      if (url.includes("arbeitnow")) {
        const page = Number(new URL(url).searchParams.get("page"));
        return Response.json({ data: [{ slug: `role-${page}`, company_name: "Example", title: "Engineer", url: `https://employer.example/jobs/${page}`, location: "Vienna" }], links: { next: page === 10 ? null : `https://www.arbeitnow.com/api/job-board-api?page=${page + 1}` } });
      }
      if (url.includes("remotive")) return Response.json({ jobs: [] });
      expect(new URL(url).searchParams.get("cursor")).toBe("jobicy-next");
      return Response.json({ jobs: [{ id: 121, url: "https://jobicy.com/jobs/page", jobTitle: "Jobicy role", companyName: "Example", jobGeo: "Europe", jobDescription: "role details" }], nextCursor: "jobicy-after", hasMore: true });
    }));
    const result = await searchPublicJobs({ arbeitnowStartPage: 6, jobicyCursor: "jobicy-next", locations: "Austria; Remote Europe" });
    expect(result.jobs).toHaveLength(6);
    expect(result.nextArbeitnowPage).toBeNull();
    expect(result.nextJobicyCursor).toMatch(/^jp1\./);
    expect(requests.filter((url) => url.includes("arbeitnow"))).toHaveLength(5);
    expect(requests.filter((url) => url.includes("jobicy.com/api/v2/remote-jobs") && !url.includes("get=locations"))).toHaveLength(2);
    expect(requests.some((url) => url.includes("remotive.com"))).toBe(false);
  });

  it("filters by location and title consistently, deduplicates canonical URLs, and keeps better descriptions", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("get=locations")) return Response.json({ locations });
      if (url.includes("arbeitnow")) return Response.json({ data: [
        { slug: "one", company_name: "Example", title: "Senior Software Engineer", url: "https://jobs.example/role?utm_source=board", location: "Vienna", description: "Long employer description with evidence." },
        { slug: "two", company_name: "Elsewhere", title: "Software Engineer", url: "https://jobs.example/other", location: "Berlin" },
      ] });
      if (url.includes("remotive")) return Response.json({ jobs: [{ id: 5, url: "https://jobs.example/role", title: "Software Engineer", company_name: "Example", candidate_required_location: "Austria", description: "Short" }] });
      const geo = new URL(url).searchParams.get("geo");
      return Response.json({ jobs: geo === "austria" ? [{ id: 6, url: "https://jobs.example/architect", jobTitle: "Solution Architect", companyName: "Example", jobGeo: "Austria", jobDescription: "Architecture role" }] : [] });
    }));
    const result = await searchPublicJobs({ locations: "Austria", roles: "Software Engineer; Solution Architect" });
    expect(result.jobs).toHaveLength(2);
    const merged = result.jobs.find((job) => job.sourceUrl?.includes("jobs.example/role"));
    expect(merged?.description).toContain("Long employer description");
    expect(merged?.sourceAliases).toEqual(expect.arrayContaining(["Arbeitnow", "Remotive"]));
    expect(result.jobs.some((job) => job.location === "Berlin")).toBe(false);
    expect(result.jobs.some((job) => job.role === "Solution Architect")).toBe(true);
  });

  it("keeps successful pages when one public source page fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("get=locations")) return Response.json({ locations });
      if (url.includes("remotive")) return Response.json({ jobs: [] });
      if (url.includes("arbeitnow")) {
        if (new URL(url).searchParams.get("page") === "2") throw new Error("offline");
        return Response.json({ data: [{ slug: "kept", company_name: "Example", title: "Engineer", url: "https://example.test/job", location: "Vienna" }], links: { next: "https://www.arbeitnow.com/api/job-board-api?page=6" } });
      }
      return Response.json({ jobs: [] });
    }));
    const result = await searchPublicJobs({ locations: "Austria" });
    expect(result.jobs.map((job) => job.id)).toContain("arbeitnow-kept");
    expect(result.errors.some((error) => error.includes("partial page failures"))).toBe(true);
    expect(result.sourceStatuses.find((source) => source.source === "Arbeitnow")?.state).toBe("partial");
  });

  it("reports when Jobicy cannot provide its location taxonomy", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("get=locations")) throw new Error("offline");
      if (url.includes("arbeitnow")) return Response.json({ data: [] });
      if (url.includes("remotive")) return Response.json({ jobs: [] });
      throw new Error("Jobicy feed should not be called without taxonomy");
    }));
    const result = await searchPublicJobs({ locations: "Austria" });
    expect(result.errors).toContain("Jobicy's public location list is unavailable; its feed was skipped.");
    expect(result.sourceStatuses.find((source) => source.source === "Jobicy")?.state).toBe("failed");
  });

  it("stops Arbeitnow pagination when the provider explicitly returns no next link", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const page = Number(new URL(url).searchParams.get("page"));
      return Response.json({ data: [{ slug: `role-${page}`, company_name: "Example", title: "Engineer", url: `https://employer.example/jobs/${page}`, location: "Vienna" }], links: { next: null } });
    }));
    const result = await searchPublicJobs({ arbeitnowStartPage: 6, locations: "Austria" });
    expect(result.jobs).toHaveLength(5);
    expect(result.nextArbeitnowPage).toBeNull();
  });

  it("continues after a failed last page instead of requesting the same batch forever", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("get=locations")) return Response.json({ locations });
      if (url.includes("remotive")) return Response.json({ jobs: [] });
      if (url.includes("arbeitnow")) {
        const page = Number(new URL(url).searchParams.get("page"));
        if (page === 10) return new Response("temporarily unavailable", { status: 503 });
        return Response.json({ data: [], links: { next: `https://www.arbeitnow.com/api/job-board-api?page=${page + 1}` } });
      }
      return Response.json({ jobs: [] });
    }));

    const result = await searchPublicJobs({ arbeitnowStartPage: 6, locations: "Vienna, Austria" });

    expect(result.jobs).toHaveLength(0);
    expect(result.sourceStatuses.find((source) => source.source === "Arbeitnow")?.state).toBe("partial");
    expect(result.nextArbeitnowPage).toBe(11);
  });
});
