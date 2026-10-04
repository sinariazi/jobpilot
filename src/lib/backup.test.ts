import { describe, expect, it } from "vitest";
import { createBackup, parseBackup } from "./backup";
import type { PersistedState } from "./types";

const state: PersistedState = {
  profile: { name: "Candidate", roles: "Engineer", locations: "Vienna", skills: "TypeScript" },
  saved: ["job-1"],
  status: { "job-1": "Applied" },
  applicationNotes: { "job-1": "Interview scheduled" },
  applicationFollowUps: { "job-1": "2026-10-14" },
  coverLetterDrafts: { "job-1": { interest: "The mission", evidence: "Shipped a feature", draft: "Dear Hiring Team", updatedAt: "2026-10-02T12:00:00.000Z" } },
  liveJobs: [],
};

describe("local state backup", () => {
  it("round-trips a versioned backup", () => {
    const fixedDate = new Date("2026-10-02T12:00:00.000Z");
    const backup = createBackup(state, fixedDate);
    expect(parseBackup(backup)).toEqual(state);
    expect(JSON.parse(backup).exportedAt).toBe(fixedDate.toISOString());
  });

  it("rejects malformed JSON, unknown versions, and incomplete state", () => {
    expect(parseBackup("not json")).toBeNull();
    expect(parseBackup(JSON.stringify({ format: "jobpilot-backup", version: 2, exportedAt: "2026-10-02", state }))).toBeNull();
    expect(parseBackup(JSON.stringify({ format: "jobpilot-backup", version: 1, exportedAt: "2026-10-02", state: {} }))).toBeNull();
  });
});
