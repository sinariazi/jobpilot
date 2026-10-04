import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPLICATION_EXTENSION_ORIGIN } from "../../../../lib/application-extension";
import { loadLocalState } from "../../../../lib/local-state";
import { GET, OPTIONS } from "./route";

vi.mock("../../../../lib/local-state", () => ({ loadLocalState: vi.fn() }));

const savedPosting = "https://jobs.ashbyhq.com/example/role-1";

beforeEach(() => {
  vi.mocked(loadLocalState).mockResolvedValue({
    initialized: true,
    profile: { name: "Sina Riazi", roles: "Engineer", locations: "Austria", skills: "TypeScript", email: "sina@example.test", phone: "+431234", linkedin: "https://linkedin.example/sina", portfolio: "https://sina.example", workAuthorization: "Eligible to work in Austria" },
    saved: [], status: {}, applicationNotes: {}, applicationFollowUps: {},
    liveJobs: [{ id: "job-1", company: "Example", role: "Engineer", location: "Vienna", mode: "Hybrid", posted: "Today", source: "Feed", sourceUrl: savedPosting, summary: "Role" }],
    coverLetterDrafts: { "job-1": { interest: "", evidence: "", draft: "Dear hiring team", updatedAt: new Date(0).toISOString() } },
  });
});

afterEach(() => vi.clearAllMocks());

function request(path: string, origin = APPLICATION_EXTENSION_ORIGIN) {
  return new Request(`http://localhost:3000/api/application/prefill${path}`, { headers: { origin } });
}

describe("local ATS form prefill endpoint", () => {
  it("returns only candidate form fields and a draft for the exact local job", async () => {
    const response = await GET(request(`?postingUrl=${encodeURIComponent(`${savedPosting}#application`)}`));
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(APPLICATION_EXTENSION_ORIGIN);
    expect(result).toEqual({
      candidate: {
        name: "Sina Riazi", email: "sina@example.test", phone: "+431234",
        linkedin: "https://linkedin.example/sina", portfolio: "https://sina.example",
        workAuthorization: "Eligible to work in Austria", coverLetter: "Dear hiring team",
      },
      matchedSavedJob: true,
    });
    expect(JSON.stringify(result)).not.toContain("TypeScript");
    expect(JSON.stringify(result)).not.toContain("liveJobs");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not return an unrelated cover letter for a different ATS posting", async () => {
    const response = await GET(request("?postingUrl=https%3A%2F%2Fjobs.ashbyhq.com%2Fother%2Frole"));
    expect(await response.json()).toMatchObject({ candidate: { coverLetter: "" }, matchedSavedJob: false });
  });

  it("rejects web pages and unauthenticated callers before reading local state", async () => {
    const response = await GET(request(`?postingUrl=${encodeURIComponent(savedPosting)}`, "https://example.com"));
    expect(response.status).toBe(403);
    expect(loadLocalState).not.toHaveBeenCalled();
  });

  it("accepts only supported HTTPS ATS URLs", async () => {
    const response = await GET(request("?postingUrl=http%3A%2F%2Fjobs.ashbyhq.com%2Fexample%2Frole"));
    expect(response.status).toBe(400);
    expect(loadLocalState).not.toHaveBeenCalled();
  });

  it("limits preflight access to the packaged extension origin", async () => {
    const allowed = await OPTIONS(request("", APPLICATION_EXTENSION_ORIGIN));
    const denied = await OPTIONS(request("", "https://example.com"));
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(APPLICATION_EXTENSION_ORIGIN);
    expect(denied.status).toBe(403);
  });

  it("requires Jobpilot to have saved profile state", async () => {
    vi.mocked(loadLocalState).mockResolvedValueOnce({ initialized: false } as Awaited<ReturnType<typeof loadLocalState>>);
    const response = await GET(request(`?postingUrl=${encodeURIComponent(savedPosting)}`));
    expect(response.status).toBe(409);
  });
});
