import { afterEach, describe, expect, it, vi } from "vitest";
import { searchPublicJobs } from "./job-search";

afterEach(() => vi.unstubAllGlobals());

describe("searchPublicJobs", () => {
  it("combines listings from the public feeds and preserves attribution URLs", async () => {
    const requests: Array<{ url: string; options?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      const url = String(input);
      requests.push({ url, options });
      if (url.includes("arbeitnow")) return Response.json({ data: [{ slug: "role-a", company_name: "Example A", title: "Product Manager", description: "<p>Build a product</p>", remote: false, url: "https://employer.example/jobs/a", location: "Vienna" }] });
      if (url.includes("remotive")) return Response.json({ jobs: [{ id: 22, url: "https://remotive.com/remote-jobs/role-b", title: "Product Designer", company_name: "Example B", candidate_required_location: "Worldwide", job_type: "full_time", publication_date: "2026-10-01", description: "<p>Design products</p>" }] });
      return Response.json({ jobs: [{ id: 33, url: "https://jobicy.com/jobs/role-c", jobTitle: "Product Lead", companyName: "Example C", jobGeo: "Europe", jobType: ["full-time"], pubDate: "2026-10-01", jobDescription: "<p>Lead a team</p>", jobIndustry: ["Management"] }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchPublicJobs();
    expect(result.jobs.map((job) => job.source).sort()).toEqual(["Arbeitnow", "Jobicy", "Remotive"]);
    expect(result.jobs.find((job) => job.source === "Arbeitnow")?.sourceAttributionUrl).toBe("https://www.arbeitnow.com/");
    expect(result.jobs.find((job) => job.source === "Remotive")?.sourceUrl).toBe("https://remotive.com/remote-jobs/role-b");
    expect(result.jobs.find((job) => job.source === "Remotive")?.mode).toBe("Remote · full_time");
    expect(result.jobs.find((job) => job.source === "Jobicy")?.mode).toBe("Remote · full-time");
    expect(result.jobs.find((job) => job.source === "Jobicy")?.description).toBe("Lead a team");
    expect(result.errors).toEqual([]);
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
});
