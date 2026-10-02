import { describe, expect, it } from "vitest";
import type { Job } from "./types";
import { matchesDepartment, matchesPostedWithin, matchesWorkMode } from "./job-filters";

const baseJob: Job = {
  id: "role-1",
  company: "Example",
  role: "Engineer",
  location: "Europe",
  mode: "Remote · Full-time",
  posted: "1 Oct 2026",
  postedAt: "2026-10-01T12:00:00.000Z",
  source: "Example Feed",
  department: "Engineering",
  summary: "Build software",
};

describe("job filters", () => {
  it("filters dated listings by age and keeps undated jobs when no date filter is selected", () => {
    const now = Date.parse("2026-10-02T12:00:00.000Z");
    expect(matchesPostedWithin(baseJob, "7", now)).toBe(true);
    expect(matchesPostedWithin({ ...baseJob, postedAt: "2026-08-01T00:00:00.000Z" }, "30", now)).toBe(false);
    expect(matchesPostedWithin({ ...baseJob, postedAt: undefined }, "any", now)).toBe(true);
    expect(matchesPostedWithin({ ...baseJob, postedAt: undefined }, "7", now)).toBe(false);
  });

  it("classifies remote, hybrid, and on-site listings from feed-provided details", () => {
    expect(matchesWorkMode(baseJob, "remote")).toBe(true);
    expect(matchesWorkMode({ ...baseJob, mode: "Hybrid" }, "hybrid")).toBe(true);
    expect(matchesWorkMode({ ...baseJob, mode: "On-site" }, "onsite")).toBe(true);
    expect(matchesWorkMode(baseJob, "onsite")).toBe(false);
  });

  it("matches department names without case sensitivity", () => {
    expect(matchesDepartment(baseJob, "engineering")).toBe(true);
    expect(matchesDepartment({ ...baseJob, department: undefined }, "engineering")).toBe(false);
    expect(matchesDepartment(baseJob, "")).toBe(true);
  });
});
