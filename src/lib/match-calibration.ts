import type { MatchReview } from "./types";

export const MAX_MATCH_REVIEWS = 2_000;
export const MIN_MATCH_REVIEWS_FOR_CALIBRATION = 20;
export const MIN_MATCH_REVIEWS_PER_BAND = 5;

const SCORE_BANDS = [
  { low: 0, high: 19 },
  { low: 20, high: 39 },
  { low: 40, high: 59 },
  { low: 60, high: 79 },
  { low: 80, high: 100 },
];

export type CalibrationBand = {
  low: number;
  high: number;
  count: number;
  meanModelScore: number | null;
  observedRelevantRate: number | null;
  calibratedEstimate: number | null;
};

export type MatchReviewMetrics = {
  total: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
  precision: number | null;
  recall: number | null;
  falsePositiveRate: number | null;
  falseNegativeRate: number | null;
  bands: CalibrationBand[];
};

export async function createMatchCohortKey(cvText: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cvText));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function bandIndex(score: number) {
  return SCORE_BANDS.findIndex((band) => score >= band.low && score <= band.high);
}

export function summarizeMatchReviews(reviews: MatchReview[]): MatchReviewMetrics {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;
  const groups = SCORE_BANDS.map(() => ({ count: 0, positives: 0, totalScore: 0 }));

  for (const review of reviews) {
    if (review.predictedRelevant && review.reviewedRelevant) truePositive += 1;
    else if (review.predictedRelevant) falsePositive += 1;
    else if (review.reviewedRelevant) falseNegative += 1;
    else trueNegative += 1;
    const group = groups[bandIndex(review.score)];
    if (group) {
      group.count += 1;
      group.positives += Number(review.reviewedRelevant);
      group.totalScore += review.score;
    }
  }

  const total = reviews.length;
  const globalRate = (reviews.filter((review) => review.reviewedRelevant).length + 1) / (total + 2);
  const blocks: Array<{ first: number; last: number; weight: number; rate: number }> = [];
  if (total >= MIN_MATCH_REVIEWS_FOR_CALIBRATION) {
    groups.forEach((group, index) => {
      if (group.count < MIN_MATCH_REVIEWS_PER_BAND) return;
      const weight = group.count + 4;
      const rate = (group.positives + globalRate * 4) / weight;
      blocks.push({ first: index, last: index, weight, rate });
      while (blocks.length > 1 && blocks[blocks.length - 2].rate > blocks[blocks.length - 1].rate) {
        const right = blocks.pop()!;
        const left = blocks.pop()!;
        const mergedWeight = left.weight + right.weight;
        blocks.push({
          first: left.first,
          last: right.last,
          weight: mergedWeight,
          rate: (left.rate * left.weight + right.rate * right.weight) / mergedWeight,
        });
      }
    });
  }

  const calibratedRates: Array<number | null> = SCORE_BANDS.map(() => null);
  for (const block of blocks) {
    for (let index = block.first; index <= block.last; index += 1) calibratedRates[index] = block.rate;
  }

  const bands = SCORE_BANDS.map((band, index): CalibrationBand => {
    const group = groups[index];
    return {
      ...band,
      count: group.count,
      meanModelScore: group.count ? group.totalScore / group.count : null,
      observedRelevantRate: group.count ? group.positives / group.count : null,
      calibratedEstimate: group.count >= MIN_MATCH_REVIEWS_PER_BAND ? calibratedRates[index] : null,
    };
  });

  const safeRate = (numerator: number, denominator: number) => denominator ? numerator / denominator : null;
  return {
    total,
    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,
    precision: safeRate(truePositive, truePositive + falsePositive),
    recall: safeRate(truePositive, truePositive + falseNegative),
    falsePositiveRate: safeRate(falsePositive, falsePositive + trueNegative),
    falseNegativeRate: safeRate(falseNegative, falseNegative + truePositive),
    bands,
  };
}

export function calibratedFitScore(score: number, reviews: MatchReview[]) {
  if (reviews.length < MIN_MATCH_REVIEWS_FOR_CALIBRATION) return null;
  const index = bandIndex(score);
  if (index < 0) return null;
  const metrics = summarizeMatchReviews(reviews);
  const band = metrics.bands[index];
  return band.count >= MIN_MATCH_REVIEWS_PER_BAND && band.calibratedEstimate !== null
    ? Math.round(band.calibratedEstimate * 100)
    : null;
}
