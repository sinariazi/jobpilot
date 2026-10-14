import { describe, expect, it } from "vitest";
import { mergeJobPool } from "./job-pool";
import type { Job } from "./types";

const job: Job = {
  id: "one", role: "Solution Architect", company: "Example", location: "Vienna, Austria", mode: "Hybrid",
  posted: "Today", source: "Arbeitnow", sourceUrl: "https://example.com/jobs/one", summary: "Short summary",
  screening: { model: "decision:latest", score: 78, confidence: 82, breakdown: { skills: 80, experience: 75, domain: 70 }, disqualifierRisk: 0, informationStatus: "sufficient" },
};

describe("mergeJobPool", () => {
  it("keeps scores and details when a feed refresh omits them", () => {
    const refreshed = { ...job, id: "new-id", summary: "Updated summary", screening: undefined };
    const merged = mergeJobPool([job], [refreshed]);
    expect(merged).toHaveLength(1);
    expect(merged[0].screening?.score).toBe(78);
    expect(merged[0].summary).toBe("Updated summary");
    expect(merged[0].sourceUrl).toBe(job.sourceUrl);
  });

  it("adds new listings and respects the pool bound", () => {
    const second = { ...job, id: "two", sourceUrl: "https://example.com/jobs/two" };
    expect(mergeJobPool([job], [second], 1)).toEqual([second]);
  });
});
