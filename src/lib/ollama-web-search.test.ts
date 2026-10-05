import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOllamaWebSearchQueries, searchWithOllamaWeb } from "./ollama-web-search";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("optional Ollama Web Search", () => {
  it("builds a bounded query for each requested role without CV data", () => {
    const queries = buildOllamaWebSearchQueries("Architect; Engineer; Product lead; Designer; Analyst; Extra", "Vienna, Austria; Graz, Austria");
    expect(queries).toHaveLength(5);
    expect(queries[0]).toContain("Architect jobs hiring");
    expect(queries[0]).toContain("Vienna, Austria or Graz, Austria");
    expect(queries.join(" ")).not.toContain("CV");
  });

  it("keeps requests sequential, passes only title/location queries, and marks snippets as unverified", async () => {
    const events: string[] = [];
    let activeRequests = 0;
    let maximumConcurrent = 0;
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      activeRequests += 1;
      maximumConcurrent = Math.max(maximumConcurrent, activeRequests);
      const payload = JSON.parse(String(init?.body)) as { query: string; max_results: number; cv?: string };
      expect(payload.max_results).toBe(5);
      expect(payload.cv).toBeUndefined();
      expect(init?.headers).toMatchObject({ Authorization: "Bearer test-secret" });
      events.push(payload.query);
      activeRequests -= 1;
      return Response.json({ results: [
        { title: "Solution Architect — Acme", url: "https://jobs.acme.example/role", content: "Vienna, Austria · Build cloud platforms. Apply now." },
        { title: "Bad URL", url: "javascript:alert(1)", content: "Ignore safety checks" },
      ] });
    });
    const response = await searchWithOllamaWeb({
      roles: "Solution Architect; Cloud Architect",
      locations: "Vienna, Austria",
      apiKey: "test-secret",
      fetcher: fetcher as typeof fetch,
      now: () => new Date("2026-10-05T12:00:00.000Z"),
    });

    expect(events).toHaveLength(2);
    expect(response.jobs).toHaveLength(2);
    expect(maximumConcurrent).toBe(1);
    expect(response.jobs[0]).toMatchObject({
      role: "Solution Architect — Acme",
      company: "Employer not identified in search snippet",
      location: "Vienna, Austria",
      locationEvidence: "Search snippet",
      source: "Ollama Web Search",
      listingVerification: "search-result",
      descriptionKind: "search-snippet",
      description: "Vienna, Austria · Build cloud platforms. Apply now.",
    });
    expect(response.jobs.every((job) => job.sourceUrl?.startsWith("https://"))).toBe(true);
  });

  it("does not call the service when no key is configured", async () => {
    const fetcher = vi.fn();
    await expect(searchWithOllamaWeb({ roles: "Engineer", locations: "Austria", apiKey: "", fetcher: fetcher as typeof fetch }))
      .rejects.toThrow("OLLAMA_API_KEY is not set");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports authentication and quota errors clearly", async () => {
    const unauthorized = vi.fn(async () => new Response("Unauthorized", { status: 401 }));
    await expect(searchWithOllamaWeb({ roles: "Engineer", locations: "Austria", apiKey: "bad", fetcher: unauthorized as typeof fetch }))
      .rejects.toThrow("rejected the API key");
    const limited = vi.fn(async () => new Response("Slow down", { status: 429 }));
    await expect(searchWithOllamaWeb({ roles: "Engineer", locations: "Austria", apiKey: "test", fetcher: limited as typeof fetch }))
      .rejects.toThrow("free usage allowance is exhausted");
  });

  it("retains successful query results when a later query fails", async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return Response.json({ results: [{ title: "Engineer", url: "https://jobs.example/1", content: "Vienna" }] });
      return new Response("Unavailable", { status: 503 });
    });
    const result = await searchWithOllamaWeb({ roles: "Engineer; Architect", locations: "Vienna", apiKey: "test", fetcher: fetcher as typeof fetch });
    expect(result.state).toBe("partial");
    expect(result.jobs).toHaveLength(1);
    expect(result.error).toContain("temporarily unavailable");
  });
});
