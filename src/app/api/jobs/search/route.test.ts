import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

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
      return Response.json({ jobs: [{ id: 120, url: "https://jobicy.com/jobs/next", jobTitle: "Next role", companyName: "Example" }], nextCursor: null, hasMore: false });
    }));

    const response = await GET(new Request(`http://localhost/api/jobs/search?jobicyCursor=${encodeURIComponent(cursor)}`));
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.jobs).toHaveLength(1);
    expect(result.nextJobicyCursor).toBeNull();
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]).searchParams.get("cursor")).toBe(cursor);
    expect(new URL(requests[0]).searchParams.get("geo")).toBe("europe");
  });

  it("rejects malformed opt-in search preferences without querying providers", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(new Request("http://localhost/api/jobs/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includeAdzuna: true, roles: ["Engineer"], locations: "Austria" }),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid Adzuna search preferences." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an Adzuna continuation without explicit opt-in", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(new Request("http://localhost/api/jobs/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includeAdzuna: false, roles: "Engineer", locations: "Austria", adzunaPage: 2 }),
    }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the Adzuna configuration action when selected without credentials", async () => {
    vi.stubEnv("ADZUNA_APP_ID", "");
    vi.stubEnv("ADZUNA_APP_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("arbeitnow")) return Response.json({ data: [], links: { next: null } });
      if (url.includes("remotive")) return Response.json({ jobs: [] });
      return Response.json({ jobs: [] });
    }));

    const response = await POST(new Request("http://localhost/api/jobs/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includeAdzuna: true, roles: "Engineer", locations: "Austria" }),
    }));

    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("ADZUNA_APP_ID and ADZUNA_APP_KEY");
  });
});
