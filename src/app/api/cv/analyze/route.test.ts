import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const input = { model: "qwen3:4b", cvText: "Full stack engineer with TypeScript, React, AWS, and product leadership experience." };
const analysis = {
  summary: "Full-stack engineer and product leader with cloud SaaS experience.",
  roles: ["Senior Full-Stack Engineer", "Technical Product Manager"],
  skills: ["TypeScript", "React", "AWS", "Product Management"],
  seniority: "Senior",
  domains: ["SaaS", "E-commerce"],
  highlights: ["Led delivery of a cloud SaaS product."],
};

describe("local CV analysis API", () => {
  it("keeps analysis on the laptop and returns structured profile evidence", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: input.model }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: JSON.stringify(analysis) } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(new Request("http://localhost/api/cv/analyze", { method: "POST", body: JSON.stringify(input) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(analysis);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["http://127.0.0.1:11434/api/tags", "http://127.0.0.1:11434/api/chat"]);
    const payload = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as { think: boolean; messages: Array<{ content: string }> };
    expect(payload.think).toBe(false);
    expect(payload.messages[1]?.content).toContain(input.cvText);
  });

  it("rejects a hosted Jobpilot address before sending CV text anywhere", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(new Request("https://jobpilot.example/api/cv/analyze", { method: "POST", body: JSON.stringify(input) }));
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates CV input before contacting Ollama", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(new Request("http://localhost/api/cv/analyze", { method: "POST", body: JSON.stringify({ ...input, cvText: "x".repeat(30_001) }) }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
