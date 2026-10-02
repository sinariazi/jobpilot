import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const input = {
  job: { company: "Example GmbH", role: "Product Engineer", location: "Vienna", description: "Build reliable product features." },
  candidate: { name: "Candidate", skills: "TypeScript, React" },
  interest: "I want to work on the product.",
  evidence: "I shipped a verified feature.",
};

describe("application draft API", () => {
  it("reports AI unavailable without server credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_MODEL", "");
    const response = await GET();
    expect(await response.json()).toEqual({ available: false });
  });

  it("requires a server-side API key and model", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_MODEL", "configured-model");
    const response = await POST(new Request("http://localhost/api/application/draft", { method: "POST", body: JSON.stringify(input) }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("OPENAI_API_KEY");
  });

  it("validates requests before sending source text to the provider", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_MODEL", "configured-model");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const invalid = { ...input, job: { ...input.job, role: "" } };
    const response = await POST(new Request("http://localhost/api/application/draft", { method: "POST", body: JSON.stringify(invalid) }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the configured model server-side and returns an editable letter", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_MODEL", "configured-model");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "Dear Hiring Team,\n\nI am applying." } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(new Request("http://localhost/api/application/draft", { method: "POST", body: JSON.stringify(input) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ draft: "Dear Hiring Team,\n\nI am applying." });
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer test-key");
    expect(String(options.body)).toContain("Do not infer or invent");
  });
});
