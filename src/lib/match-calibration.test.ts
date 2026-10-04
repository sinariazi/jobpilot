import { describe, expect, it } from "vitest";
import { calibratedFitScore, MIN_MATCH_REVIEWS_FOR_CALIBRATION, summarizeMatchReviews } from "./match-calibration";
import type { MatchReview } from "./types";

function review(index: number, score: number, predictedRelevant: boolean, reviewedRelevant: boolean): MatchReview {
  return {
    jobId: `job-${index}`,
    company: "Example",
    role: "Engineer",
    model: "local-model:latest",
    cohortKey: "a".repeat(64),
    score,
    predictedRelevant,
    reviewedRelevant,
    reviewedAt: "2026-10-04T12:00:00.000Z",
  };
}

describe("local match calibration", () => {
  it("calculates false-positive and false-negative rates only from reviewed model decisions", () => {
    const metrics = summarizeMatchReviews([
      review(1, 90, true, true),
      review(2, 70, true, false),
      review(3, 50, false, true),
      review(4, 10, false, false),
    ]);

    expect(metrics).toMatchObject({
      total: 4,
      truePositive: 1,
      falsePositive: 1,
      falseNegative: 1,
      trueNegative: 1,
      precision: 0.5,
      recall: 0.5,
      falsePositiveRate: 0.5,
      falseNegativeRate: 0.5,
    });
  });

  it("does not calibrate scores until there is enough reviewed evidence per band", () => {
    const scoreBands = [10, 30, 50, 70, 90];
    const sparse = Array.from({ length: MIN_MATCH_REVIEWS_FOR_CALIBRATION }, (_, index) => review(index, scoreBands[index % scoreBands.length], true, index % 2 === 0));
    expect(calibratedFitScore(90, sparse)).toBeNull();
    expect(summarizeMatchReviews(sparse).bands[4].calibratedEstimate).toBeNull();
  });

  it("calibrates score bands from reviewed outcomes and keeps corrections monotonic", () => {
    const samples: MatchReview[] = [];
    let id = 0;
    const positivesByBand = [0, 5, 0, 5, 5];
    [10, 30, 50, 70, 90].forEach((score, band) => {
      for (let sample = 0; sample < 5; sample += 1) {
        samples.push(review(id++, score, score >= 50, sample < positivesByBand[band]));
      }
    });

    const low = calibratedFitScore(30, samples);
    const middle = calibratedFitScore(50, samples);
    const high = calibratedFitScore(90, samples);
    expect(low).not.toBeNull();
    expect(middle).toBe(low);
    expect(high).not.toBeNull();
    expect(high!).toBeGreaterThanOrEqual(low!);
  });

  it("keeps different models and CV cohorts separate when the caller scopes reviews", () => {
    const rows = [review(1, 80, true, true), { ...review(2, 20, false, false), cohortKey: "c".repeat(64) }];
    const currentCohort = rows.filter((row) => row.cohortKey === "a".repeat(64) && row.model === "local-model:latest");
    expect(summarizeMatchReviews(currentCohort).total).toBe(1);
  });
});
