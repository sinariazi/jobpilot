import { describe, expect, it } from "vitest";
import { getFoundJobPreferenceStatus } from "./found-job-status";
import { snapshotSearchMatches } from "./search-match-snapshot";
import type { Job } from "./types";

const job: Job = {
  id: "job-1", company: "Example", role: "Solution Architect", location: "Vienna, Austria", mode: "Hybrid",
  posted: "Today", source: "Arbeitnow", sourceUrl: "https://example.com/job-1", summary: "Architecture role",
};

describe("found job preference status", () => {
  it("classifies broader discoveries without removing them from the discovered pool", () => {
    const pool = [job, { ...job, id: "job-2", role: "Graphic Designer", location: "Berlin, Germany", sourceUrl: "https://example.com/job-2" }];
    const statuses = pool.map((item) => getFoundJobPreferenceStatus(item, "Vienna, Austria", "solution architect", null));
    expect(pool).toHaveLength(2);
    expect(statuses.map((status) => status.included)).toEqual([true, false]);
    expect(statuses[1]?.excludedBy).toBe("title and location");
  });

  it("keeps a server-confirmed search result included even if local heuristics are narrower", () => {
    const snapshot = snapshotSearchMatches("Austria", "solution architect", [job]);
    expect(getFoundJobPreferenceStatus(job, "Austria", "solution architect", snapshot).included).toBe(true);
  });
});
