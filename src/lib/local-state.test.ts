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
  id: "gh-example-1",
  company: "Example Co",
  role: "Full-Stack Engineer",
  location: "Remote — Europe",
  mode: "Remote",
  posted: "Today",
  postedAt: "2026-10-02T09:00:00.000Z",
  source: "Greenhouse",
  sourceUrl: "https://boards.greenhouse.io/example/jobs/1",
  retrievedAt: "2026-10-02T09:00:00.000Z",
  department: "Engineering",
  summary: "Build a product feature.",
  description: "What you will do:\n\nBuild and ship product features.",
  aiMatch: { model: "local-model:latest", relevant: true, score: 84, reason: "Your experience building product software fits this role.", cvEvidence: "Full-stack product engineering experience" },
  screening: { model: "decision:latest", score: 82, confidence: 74, breakdown: { skills: 90, experience: 80, domain: 70 }, disqualifierRisk: 10, informationStatus: "sufficient" },
  detailedAnalysis: { model: "local-model:latest", summary: "Evidence supports the core requirements.", matchedRequirements: ["TypeScript"], gaps: ["Unclear cloud scope"], evidence: [{ requirement: "TypeScript", cvQuote: "TypeScript", jobQuote: "Build with TypeScript" }] },
};

describe("local state storage", () => {
  it("returns default profile data before a local state file exists", async () => {
    const state = await loadLocalState(await temporaryDirectory());
    expect(state).toEqual(defaultState());
  });

  it("persists profile, reviews, saved jobs, and fetched listings between reads", async () => {
    const dataDirectory = await temporaryDirectory();
    const state: PersistedState = {
      profile: { name: "Candidate", roles: "Engineer", locations: "Vienna", skills: "TypeScript" },
      saved: [exampleJob.id],
      status: { [exampleJob.id]: "Approved to prepare" },
      applicationNotes: { [exampleJob.id]: "Follow up with the hiring manager" },
      applicationFollowUps: { [exampleJob.id]: "2026-10-14" },
      coverLetterDrafts: { [exampleJob.id]: { interest: "The product", evidence: "Shipped a feature", draft: "Dear team", updatedAt: "2026-10-02T12:00:00.000Z" } },
      matchReviews: [{ jobId: exampleJob.id, company: exampleJob.company, role: exampleJob.role, model: "local-model:latest", cohortKey: "a".repeat(64), score: 84, predictedRelevant: true, reviewedRelevant: true, reviewedAt: "2026-10-02T12:00:00.000Z" }],
      matchCohortKey: "a".repeat(64),
      matchingSettings: { decisionModel: "decision:latest", weights: { skills: 40, experience: 30, domain: 20, disqualifier: 10 }, detailedScoreThreshold: 65, detailedConfidenceThreshold: 60 },
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
      id: `gh-example-${index}`,
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
      status: { "gh-example-1": "Submitted without confirmation" },
    };
    expect(parsePersistedState(base)).toBeNull();

    expect(parsePersistedState({
      ...defaultState(),
      liveJobs: [{ ...exampleJob, sourceUrl: "javascript:alert(1)" }],
    })).toBeNull();

    expect(parsePersistedState({
      ...defaultState(),
      applicationNotes: { "gh-example-1": "x".repeat(2001) },
    })).toBeNull();

    expect(parsePersistedState({
      ...defaultState(),
      applicationFollowUps: { "gh-example-1": "2026-02-30" },
    })).toBeNull();

    expect(parsePersistedState({
      ...defaultState(),
      coverLetterDrafts: { "gh-example-1": { interest: "", evidence: "", draft: "x".repeat(20_001), updatedAt: "2026-10-02T12:00:00.000Z" } },
    })).toBeNull();

    expect(parsePersistedState({
      ...defaultState(),
      matchReviews: [{ jobId: "job-1", company: "Example", role: "Engineer", model: "local:latest", cohortKey: "invalid", score: 80, predictedRelevant: true, reviewedRelevant: false, reviewedAt: "2026-10-02T12:00:00.000Z" }],
    })).toBeNull();

    expect(parsePersistedState({
      ...defaultState(),
      liveJobs: [{ ...exampleJob, aiMatch: { model: "local-model:latest", relevant: true, score: 101, reason: "Invalid score", cvEvidence: "Evidence" } }],
    })).toBeNull();
  });

  it("accepts older saved states without optional tracker fields", () => {
    const olderState = { profile: defaultState().profile, saved: [], status: {}, liveJobs: [] };
    expect(parsePersistedState(olderState)).toEqual({ ...olderState, applicationNotes: {}, applicationFollowUps: {}, coverLetterDrafts: {}, matchReviews: [], matchCohortKey: "", matchingSettings: defaultState().matchingSettings });
  });
});
