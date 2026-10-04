import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const requestBody = {
  model: "local-model:latest",
  cvText: "Senior engineer with TypeScript, React, and AWS experience.",
  jobs: [{ id: "job-1", company: "Example GmbH", role: "Frontend Engineer", location: "Vienna", mode: "Hybrid", description: "Build React applications with TypeScript." }],
};

describe("local CV-to-job matching API", () => {
  it("validates the request before contacting Ollama", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(new Request("http://localhost/api/jobs/match", { method: "POST", body: JSON.stringify({ ...requestBody, jobs: [] }) }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps CV analysis local and returns validated match explanations", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: requestBody.model }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: JSON.stringify({ matches: [{ id: "job-1", relevant: true, score: 86, reason: "The role uses frontend engineering skills demonstrated in your CV.", cvEvidence: "TypeScript and React experience" }] }) } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(new Request("http://localhost/api/jobs/match", { method: "POST", body: JSON.stringify(requestBody) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ matches: [{ id: "job-1", relevant: true, score: 86, reason: "The role uses frontend engineering skills demonstrated in your CV.", cvEvidence: "TypeScript and React experience" }] });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["http://127.0.0.1:11434/api/tags", "http://127.0.0.1:11434/api/chat"]);
    const payload = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as { think: boolean; messages: Array<{ content: string }> };
    expect(payload.think).toBe(false);
    expect(payload.messages[1]?.content).toContain(requestBody.cvText);
  });

  it("returns a clear error when the model omits requested matches", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: requestBody.model }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: JSON.stringify({ matches: [] }) } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(new Request("http://localhost/api/jobs/match", { method: "POST", body: JSON.stringify(requestBody) }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "The local model did not assess every listing. Try another installed model." });
  });

  it("surfaces a short local Ollama error when inference is rejected", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: requestBody.model }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "model requires more system memory (4.2 GiB) than is available (3.8 GiB)" }), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(new Request("http://localhost/api/jobs/match", { method: "POST", body: JSON.stringify(requestBody) }));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("more system memory");
  });

  it("refuses a non-loopback Ollama destination", async () => {
    vi.stubEnv("OLLAMA_BASE_URL", "http://example.com");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(new Request("http://localhost/api/jobs/match", { method: "POST", body: JSON.stringify(requestBody) }));
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to receive CV text when Jobpilot is opened from a hosted address", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(new Request("https://jobpilot.example/api/jobs/match", { method: "POST", body: JSON.stringify(requestBody) }));
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
