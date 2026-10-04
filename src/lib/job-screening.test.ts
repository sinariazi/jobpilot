import { describe, expect, it } from "vitest";
import { DEFAULT_MATCHING_SETTINGS, normalizeMatchingSettings, normalizeSystemOneScreenResult, shouldRunDetailedAnalysis } from "./job-screening";

const weights = { skills: 40, experience: 30, domain: 20, disqualifier: 10 };
const valid = { answers: {
  skills: { score: 0.8, confidence: 0.9 }, experience: { score: 0.6, confidence: 0.7 }, domain: { score: 0.5, confidence: 0.8 },
  disqualifier: { noul: 0.25 }, information: { choice: "sufficient", confidence: 0.6 },
} };

describe("local job screening", () => {
  it("normalizes scores and applies configured weights with the disqualifier penalty", () => {
    expect(normalizeSystemOneScreenResult(valid, "decision:tag", weights)).toEqual({ model: "decision:tag", score: 68, confidence: 75, breakdown: { skills: 80, experience: 60, domain: 50 }, disqualifierRisk: 25, informationStatus: "sufficient" });
  });
  it("uses documented defaults and keeps valid configured weights and thresholds", () => {
    expect(normalizeMatchingSettings(undefined)).toEqual({ decisionModel: "", weights: weights, detailedScoreThreshold: 65, detailedConfidenceThreshold: 60 });
    expect(normalizeMatchingSettings({ decisionModel: "tag", weights: { skills: 50, experience: 20, domain: 20, disqualifier: 10 }, detailedScoreThreshold: 72, detailedConfidenceThreshold: 48 })).toEqual({ decisionModel: "tag", weights: { skills: 50, experience: 20, domain: 20, disqualifier: 10 }, detailedScoreThreshold: 72, detailedConfidenceThreshold: 48 });
    expect(normalizeMatchingSettings({ weights: { skills: 50, experience: 20, domain: 20, disqualifier: 20 } }).weights).toEqual(weights);
  });
  it("rejects missing and out-of-range model answers instead of silently scoring them", () => {
    expect(normalizeSystemOneScreenResult({ answers: {} }, "decision:tag", weights)).toBeNull();
    expect(normalizeSystemOneScreenResult({ answers: { ...valid.answers, skills: { score: 1.1 } } }, "decision:tag", weights)).toBeNull();
  });
  it("preserves an explicit missing-CV signal in the screening result", () => {
    const result = normalizeSystemOneScreenResult({ answers: { ...valid.answers, information: { choice: "cv_missing" } } }, "decision:tag", weights);
    expect(result?.informationStatus).toBe("cv_missing");
    expect(result?.confidence).toBe(80);
  });
  it("routes threshold, low-confidence and missing-information cases to detailed analysis", () => {
    const screening = normalizeSystemOneScreenResult(valid, "decision:tag", weights)!;
    expect(shouldRunDetailedAnalysis(screening, { ...DEFAULT_MATCHING_SETTINGS, detailedScoreThreshold: 70, detailedConfidenceThreshold: 60 })).toBe(false);
    expect(shouldRunDetailedAnalysis({ ...screening, score: 65 }, DEFAULT_MATCHING_SETTINGS)).toBe(true);
    expect(shouldRunDetailedAnalysis({ ...screening, confidence: 40 }, DEFAULT_MATCHING_SETTINGS)).toBe(true);
    expect(shouldRunDetailedAnalysis({ ...screening, informationStatus: "job_missing" }, DEFAULT_MATCHING_SETTINGS)).toBe(true);
    expect(shouldRunDetailedAnalysis(undefined, DEFAULT_MATCHING_SETTINGS)).toBe(true);
  });
});
