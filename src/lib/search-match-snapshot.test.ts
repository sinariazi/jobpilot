import { describe, expect, it } from "vitest";
import { addSearchMatches, applyScreeningsToSearchMatches, hasSearchMatch, mergeSearchMatchesIntoPool, snapshotSearchMatches } from "./search-match-snapshot";
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
    expect(snapshot.jobs).toEqual([job]);
  });

  it("adds paginated matches without duplicating canonical listing URLs", () => {
    const duplicate = { ...job, id: "duplicate-id" };
    const snapshot = snapshotSearchMatches("Austria", "Solution Architect", [job]);
    const extended = addSearchMatches(snapshot, "Austria", "Solution Architect", [duplicate]);
    expect(extended.listingKeys).toEqual([job.sourceUrl]);
    expect(extended.jobs).toHaveLength(1);
  });

  it("keeps server-filtered matches visible when the bounded discovery pool omits them", () => {
    const score = { ...job, screening: { model: "decision-model", score: 84, confidence: 80, breakdown: { skills: 90, experience: 80, domain: 70 }, disqualifierRisk: 0, informationStatus: "sufficient" as const } };
    const snapshot = snapshotSearchMatches("Vienna, Austria", "solution architect", [job]);
    expect(mergeSearchMatchesIntoPool([], snapshot)).toEqual([job]);
    expect(mergeSearchMatchesIntoPool([score], snapshot)).toEqual([score]);
  });

  it("attaches successful local scores to API matches outside the saved job pool", () => {
    const screening = { model: "decision-model", score: 84, confidence: 80, breakdown: { skills: 90, experience: 80, domain: 70 }, disqualifierRisk: 0, informationStatus: "sufficient" as const };
    const snapshot = snapshotSearchMatches("Vienna, Austria", "solution architect", [job]);
    const updated = applyScreeningsToSearchMatches(snapshot, new Map([[job.id, screening]]));
    expect(updated?.jobs[0]?.screening).toEqual(screening);
    expect(mergeSearchMatchesIntoPool([], updated)[0]?.screening?.score).toBe(84);
    expect(mergeSearchMatchesIntoPool([job], updated)[0]?.screening?.score).toBe(84);
  });
});
