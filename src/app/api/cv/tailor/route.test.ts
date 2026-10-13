import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const input = {
  model: "local-chat:latest",
  cvText: "Senior Software Engineer\nBuilt a payment service handling 2 million transactions.\nTypeScript, PostgreSQL\nBSc Computer Science",
  targetRole: "Solution Architect",
  company: "Example GmbH",
  jobDescription: "Design secure distributed systems and payment services.",
};

describe("local CV tailoring API", () => {
  it("keeps CV and job information on loopback Ollama and returns source-checked excerpts", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ models: [{ name: input.model }] }))
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify({
        profile: ["Senior Software Engineer"], skills: ["TypeScript, PostgreSQL", "Expert in Kubernetes"],
        experience: ["Built a payment service handling 2 million transactions."], education: ["BSc Computer Science"],
      }) } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(new Request("http://localhost/api/cv/tailor", { method: "POST", body: JSON.stringify(input) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      profile: ["Senior Software Engineer"], skills: ["TypeScript, PostgreSQL"],
      experience: ["Built a payment service handling 2 million transactions."], education: ["BSc Computer Science"],
      checkedCount: 5, rejectedCount: 1,
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["http://127.0.0.1:11434/api/tags", "http://127.0.0.1:11434/api/chat"]);
    const request = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as { messages: Array<{ content: string }> };
    expect(request.messages[0].content).toContain("verbatim contiguous excerpt");
    expect(request.messages[1].content).toContain(JSON.stringify(input.cvText));
    expect(request.messages[1].content).toContain(JSON.stringify(input.jobDescription));
  });

  it("rejects non-local access and invalid input before contacting Ollama", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const remote = await POST(new Request("https://jobpilot.example/api/cv/tailor", { method: "POST", body: JSON.stringify(input) }));
    const invalid = await POST(new Request("http://localhost/api/cv/tailor", { method: "POST", body: JSON.stringify({ ...input, jobDescription: "" }) }));
    expect(remote.status).toBe(403);
    expect(invalid.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports when Ollama is unavailable or the model is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const offline = await POST(new Request("http://localhost/api/cv/tailor", { method: "POST", body: JSON.stringify(input) }));
    expect(offline.status).toBe(503);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ models: [] })));
    const missing = await POST(new Request("http://localhost/api/cv/tailor", { method: "POST", body: JSON.stringify(input) }));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: expect.stringContaining("not installed") });
  });

  it("rejects malformed model output rather than exporting unchecked prose", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ models: [{ name: input.model }] }))
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify({ profile: ["Invented product executive"], skills: [], experience: [], education: [] }) } })));
    const response = await POST(new Request("http://localhost/api/cv/tailor", { method: "POST", body: JSON.stringify(input) }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("no verifiable CV excerpts") });
  });
});
