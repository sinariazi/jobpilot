import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultState, loadLocalState, parsePersistedState, saveLocalState } from "./local-state";
import type { Job, PersistedState } from "./types";

let directory = "";

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = "";
});

async function temporaryDirectory() {
  directory = await mkdtemp(join(tmpdir(), "jobpilot-state-"));
  return directory;
}

const exampleJob: Job = {
  id: "gh-demo-1",
  company: "Example Co",
  role: "Full-Stack Engineer",
  location: "Remote — Europe",
  mode: "Remote",
  posted: "Today",
  source: "Greenhouse",
  sourceUrl: "https://boards.greenhouse.io/example/jobs/1",
  retrievedAt: "2026-10-02T09:00:00.000Z",
  skills: ["TypeScript", "React"],
  required: ["TypeScript"],
  summary: "Build a product feature.",
  isLive: true,
};

describe("local state storage", () => {
  it("returns demo defaults before a local state file exists", async () => {
    const state = await loadLocalState(await temporaryDirectory());
    expect(state).toEqual(defaultState());
  });

  it("persists profile, reviews, saved jobs, and fetched listings between reads", async () => {
    const dataDirectory = await temporaryDirectory();
    const state: PersistedState = {
      profile: { name: "Demo Candidate", roles: "Engineer", locations: "Vienna", skills: "TypeScript" },
      saved: [exampleJob.id],
      status: { [exampleJob.id]: "Approved to prepare" },
      liveJobs: [exampleJob],
    };

    await saveLocalState(state, dataDirectory);
    expect(await loadLocalState(dataDirectory)).toEqual({ ...state, initialized: true });
    if (process.platform !== "win32") {
      expect((await stat(join(dataDirectory, "state.json"))).mode & 0o777).toBe(0o600);
    }
  });

  it("persists Greenhouse result batches larger than 500 jobs", async () => {
    const manyJobs = Array.from({ length: 711 }, (_, index) => ({
      ...exampleJob,
      id: `gh-demo-${index}`,
      sourceUrl: `https://boards.greenhouse.io/example/jobs/${index}`,
    }));
    const dataDirectory = await temporaryDirectory();
    const state: PersistedState = {
      profile: defaultState().profile,
      saved: [],
      status: {},
      liveJobs: manyJobs,
    };
    await saveLocalState(state, dataDirectory);
    const restored = await loadLocalState(dataDirectory);
    expect(restored.liveJobs).toHaveLength(711);
  });

  it("rejects invalid review states and unsafe job posting URLs", () => {
    const base = {
      ...defaultState(),
      initialized: undefined,
      status: { "gh-demo-1": "Submitted without confirmation" },
    };
    expect(parsePersistedState(base)).toBeNull();

    expect(parsePersistedState({
      ...defaultState(),
      liveJobs: [{ ...exampleJob, sourceUrl: "javascript:alert(1)" }],
    })).toBeNull();
  });
});
