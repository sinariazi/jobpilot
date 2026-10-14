import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultState } from "@/lib/local-state";
import { PUT } from "./route";

let temporaryDirectory = "";

afterEach(async () => {
  vi.unstubAllEnvs();
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = "";
});

async function useTemporaryStateDirectory() {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "jobpilot-state-route-"));
  vi.stubEnv("JOBPILOT_DATA_DIR", temporaryDirectory);
}

describe("local state API", () => {
  it("returns a compact acknowledgement instead of echoing the full job pool", async () => {
    await useTemporaryStateDirectory();
    const state = {
      ...defaultState(),
      liveJobs: [{
        id: "job-1", company: "Example", role: "Engineer", location: "Vienna", mode: "Hybrid",
        posted: "Today", source: "Public feed", summary: "Build software",
        sourceUrl: "https://example.com/jobs/1",
      }],
    };
    const response = await PUT(new Request("http://localhost/api/state", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ initialized: true, saved: true });
  });

  it("skips one malformed listing without blocking the rest of a state save", async () => {
    const state = {
      ...defaultState(),
      liveJobs: [{
        id: "job-1", company: "Example", role: "", location: "Vienna", mode: "Hybrid",
        posted: "Today", source: "Public feed", summary: "Build software",
      }],
    };
    const response = await PUT(new Request("http://localhost/api/state", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      initialized: true,
      saved: true,
      warning: "1 malformed job listing was skipped; the other jobs and scores were saved.",
    });
  });
});
