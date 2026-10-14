import { describe, expect, it } from "vitest";
import { addSearchMatches, hasSearchMatch, snapshotSearchMatches } from "./search-match-snapshot";
import type { Job } from "./types";

const job: Job = {
  id: "himalayas-one", role: "Solution Architect", company: "Example", location: "Remote · Austria", mode: "Remote",
  posted: "Today", source: "Himalayas", sourceUrl: "https://himalayas.app/jobs/one", summary: "Cloud architecture",
};

describe("search match snapshots", () => {
  it("retains the API's title and location matches even when the broad discovery pool is re-filtered", () => {
    const snapshot = snapshotSearchMatches("Vienna, Austria;", "solution architect", [job]);
    expect(hasSearchMatch(job, "Vienna, Austria;", "solution architect", snapshot)).toBe(true);
    expect(hasSearchMatch(job, "Vienna, Austria;", "product manager", snapshot)).toBe(false);
  });

  it("adds paginated matches without duplicating canonical listing URLs", () => {
    const duplicate = { ...job, id: "duplicate-id" };
    const snapshot = snapshotSearchMatches("Austria", "Solution Architect", [job]);
    const extended = addSearchMatches(snapshot, "Austria", "Solution Architect", [duplicate]);
    expect(extended.listingKeys).toEqual([job.sourceUrl]);
  });
});
