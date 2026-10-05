import { describe, expect, it } from "vitest";
import { compareDecisionScores, passesMinimumDecisionScore } from "./job-ranking";

describe("decision-score sorting and filters", () => {
  it("keeps unscored listings in the default all-score view", () => {
    expect(passesMinimumDecisionScore(null, 0)).toBe(true);
  });

  it("does not treat keyword mentions or a pending state as a numeric decision score", () => {
    expect(passesMinimumDecisionScore(null, 40)).toBe(false);
    expect(passesMinimumDecisionScore(39, 40)).toBe(false);
    expect(passesMinimumDecisionScore(40, 40)).toBe(true);
  });

  it("sorts assessed estimates before unscored jobs without fabricating a score", () => {
    expect([null, 62, 91].sort(compareDecisionScores)).toEqual([91, 62, null]);
  });
});
