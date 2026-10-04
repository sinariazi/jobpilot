import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const body = {
  model: "decision:latest", cvText: "Product engineer, five years, TypeScript and AWS.", weights: { skills: 40, experience: 30, domain: 20, disqualifier: 10 },
  job: { company: "Example", role: "Product Engineer", location: "Vienna", mode: "Hybrid", description: "Build TypeScript products with AWS." },
};
const answer = { answers: {
  skills: { score: 0.9, confidence: 0.8 }, experience: { score: 0.7, confidence: 0.8 }, domain: { score: 0.6, confidence: 0.7 },
  disqualifier: { noul: 0.1 }, information: { choice: "sufficient", confidence: 0.9 },
} };
function request(value: unknown = body, url = "http://localhost/api/jobs/screen") {
  return new Request(url, { method: "POST", body: JSON.stringify(value) });
}

describe("local Ollama decision screening endpoint", () => {
  it("sends parsed CV and job data only to loopback systemone and normalizes the result", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: "0.35.1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: body.model }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(answer), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ screening: { model: body.model, score: 78, confidence: 80, breakdown: { skills: 90, experience: 70, domain: 60 }, disqualifierRisk: 10, informationStatus: "sufficient" } });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["http://127.0.0.1:11434/api/version", "http://127.0.0.1:11434/api/tags", "http://127.0.0.1:11434/v1/systemone"]);
    const payload = JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body)) as { state: { cv: string; job: { description: string } }; questions: Record<string, unknown> };
    expect(payload.state.cv).toContain(body.cvText);
    expect(payload.state.job.description).toContain(body.job.description);
    expect(Object.keys(payload.questions)).toEqual(["skills", "experience", "domain", "disqualifier", "information"]);
  });

  it("returns an actionable version error without calling an unsupported endpoint", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: "0.34.9" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: body.model }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("0.35 or newer");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports missing model, malformed output, and endpoint errors clearly", async () => {
    const missing = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: "0.35.0" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [] }), { status: 200 }));
    vi.stubGlobal("fetch", missing);
    expect((await POST(request())).status).toBe(400);
    const invalid = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: "0.35.0" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: body.model }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ answers: {} }), { status: 200 }));
    vi.stubGlobal("fetch", invalid);
    expect((await POST(request())).status).toBe(502);
    const unsupported = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: "0.35.0" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: body.model }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }));
    vi.stubGlobal("fetch", unsupported);
    expect((await POST(request())).status).toBe(503);
  });

  it("returns a useful timeout message when the local decision model stalls", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: "0.35.0" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: body.model }] }), { status: 200 }))
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request());
    expect(response.status).toBe(504);
    expect((await response.json()).error).toContain("timed out");
  });

  it("rejects remote app hosts and non-loopback Ollama servers", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect((await POST(request(body, "https://hosted.example/api/jobs/screen"))).status).toBe(403);
    vi.stubEnv("OLLAMA_BASE_URL", "https://hosted.example");
    expect((await POST(request())).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
