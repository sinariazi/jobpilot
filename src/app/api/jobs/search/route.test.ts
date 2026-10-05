import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllGlobals());

describe("public job search pagination API", () => {
  it("rejects an invalid Jobicy cursor before calling a provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/jobs/search?jobicyCursor="));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid Jobicy continuation cursor." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests only the supplied Jobicy continuation page", async () => {
    const cursor = "opaque+cursor/with=reserved&characters";
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("get=locations")) return Response.json({ locations: [{ geoName: "Austria", geoSlug: "austria" }, { geoName: "Europe", geoSlug: "europe" }] });
      return Response.json({ jobs: [{ id: 120, url: "https://jobicy.com/jobs/next", jobTitle: "Next role", companyName: "Example" }], nextCursor: null, hasMore: false });
    }));

    const response = await GET(new Request(`http://localhost/api/jobs/search?jobicyCursor=${encodeURIComponent(cursor)}`));
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.jobs).toHaveLength(1);
    expect(result.nextJobicyCursor).toBeNull();
    expect(requests).toHaveLength(2);
    const feed = requests.find((url) => !url.includes("get=locations"))!;
    expect(new URL(feed).searchParams.get("cursor")).toBe(cursor);
    expect(new URL(feed).searchParams.get("geo")).toBe("europe");
  });

  it("returns a partial zero-match search as success when a feed returned listings", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("get=locations")) return Response.json({ locations: [{ geoName: "Austria", geoSlug: "austria" }, { geoName: "Europe", geoSlug: "europe" }] });
      if (url.includes("remotive")) return Response.json({ jobs: [] });
      if (url.includes("arbeitnow")) {
        const page = Number(new URL(url).searchParams.get("page"));
        if (page === 2) return new Response("temporarily unavailable", { status: 503 });
        return Response.json({ data: [{ slug: `role-${page}`, company_name: "Example", title: "Solution Architect", url: `https://employer.example/jobs/${page}`, location: "Berlin" }], links: { next: `https://www.arbeitnow.com/api/job-board-api?page=${page + 1}` } });
      }
      return Response.json({ jobs: [] });
    }));

    const response = await GET(new Request("http://localhost/api/jobs/search?locations=Vienna%2C%20Austria&roles=solution%20architect"));
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.jobs).toHaveLength(0);
    expect(result.sourceStatuses.find((source: { source: string }) => source.source === "Arbeitnow").fetchedCount).toBe(4);
    expect(result.errors).toContain("Arbeitnow had partial page failures; successfully fetched pages remain available.");
  });

  it("returns the next continuation cursor when every requested page is temporarily unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.includes("arbeitnow")) throw new Error("Only Arbeitnow should be requested for a continuation batch");
      return new Response("temporarily unavailable", { status: 503 });
    }));

    const response = await GET(new Request("http://localhost/api/jobs/search?locations=Vienna%2C%20Austria&arbeitnowStartPage=16"));
    const result = await response.json();

    expect(response.status).toBe(503);
    expect(result.nextArbeitnowPage).toBe(21);
    expect(result.sourceStatuses.find((source: { source: string }) => source.source === "Arbeitnow").state).toBe("failed");
  });

});
