import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const input = {
  model: "local-model:latest",
  job: { company: "Example GmbH", role: "Product Engineer", location: "Vienna", description: "Build reliable product features." },
  candidate: { name: "Candidate", skills: "TypeScript, React" },
  interest: "I want to work on the product.",
  evidence: "I shipped a verified feature.",
  preferences: { tone: "warm", language: "German", length: "standard" },
};

describe("local application draft API", () => {
  it("lists models installed in the local Ollama service", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: "local-model:latest", size: 1_000, digest: "abc", details: { family: "llama", parameter_size: "8B", quantization_level: "Q4_K_M" } }, { name: "another-model" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: "0.12.3" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET();
    expect(await response.json()).toMatchObject({
      connected: true,
      available: true,
      runtimeVersion: "0.12.3",
      models: [{ name: "local-model:latest", size: 1_000, digest: "abc", details: { family: "llama", parameterSize: "8B", quantizationLevel: "Q4_K_M" } }, { name: "another-model" }],
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["http://127.0.0.1:11434/api/tags", "http://127.0.0.1:11434/api/version"]);
  });

  it("distinguishes a running Ollama service without an installed model", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: "0.12.3" }), { status: 200 })));
    const response = await GET();
    expect(await response.json()).toMatchObject({ connected: true, available: false, models: [], runtimeVersion: "0.12.3" });
  });

  it("reports the local model service unavailable when Ollama is stopped", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ connected: false, available: false, models: [] });
  });

  it("refuses non-loopback inference endpoints", async () => {
    vi.stubEnv("OLLAMA_BASE_URL", "http://example.com");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(new Request("http://localhost/api/application/draft", { method: "POST", body: JSON.stringify(input) }));
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates requests before invoking the local model", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const invalid = { ...input, job: { ...input.job, role: "" } };
    const response = await POST(new Request("http://localhost/api/application/draft", { method: "POST", body: JSON.stringify(invalid) }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    const invalidPreferences = { ...input, preferences: { ...input.preferences, language: "French" } };
    const preferencesResponse = await POST(new Request("http://localhost/api/application/draft", { method: "POST", body: JSON.stringify(invalidPreferences) }));
    expect(preferencesResponse.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends drafting only to local Ollama and returns the editable letter", async () => {
    const generated = {
      letter: "Dear Hiring Team,\n\nI have built with TypeScript and React.",
      claims: [
        { claim: "I have built with TypeScript and React.", source: "profile-skills", sourceQuote: "TypeScript" },
        { claim: "I led a team of 40 engineers.", source: "none", sourceQuote: "" },
      ],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: input.model }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: JSON.stringify(generated) } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(new Request("http://localhost/api/application/draft", { method: "POST", body: JSON.stringify(input) }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      draft: generated.letter,
      claimAudit: {
        verifiedClaims: [{ claim: generated.claims[0].claim, source: "profile-skills", sourceQuote: "TypeScript" }],
        unverifiedClaims: ["I led a team of 40 engineers."],
      },
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:11434/api/tags",
      "http://127.0.0.1:11434/api/chat",
    ]);
    const ollamaRequest = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as { format: string; messages: Array<{ content: string }> };
    expect(ollamaRequest.messages[0].content).toContain("Do not invent");
    expect(ollamaRequest.format).toBe("json");
    expect(ollamaRequest.messages[1].content).toContain('"language":"German"');
  });

  it("rejects malformed structured output instead of silently accepting a plain-text letter", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: input.model }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: "Dear Hiring Team, I am applying." } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(new Request("http://localhost/api/application/draft", { method: "POST", body: JSON.stringify(input) }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("invalid structured draft") });
  });
});
