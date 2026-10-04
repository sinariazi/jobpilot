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

});
