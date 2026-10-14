import type { Job, MatchingSettings } from "./types";

export type FitAssessment = "potential_fit" | "needs_review" | "low_fit" | "not_scored" | "detailed_poor_fit" | "detailed_potential_fit";

/**
 * Keep title/location discovery separate from CV fit. A score is a potential fit
 * only when it clears both user-set cutoffs and the evidence is assessable.
 */
export function assessJobFit(job: Job, settings: MatchingSettings): FitAssessment {
  if (job.detailedAnalysis && job.aiMatch) {
    return job.aiMatch.relevant ? "detailed_potential_fit" : "detailed_poor_fit";
  }
  const screening = job.screening;
  if (!screening) return "not_scored";
  if (screening.informationStatus !== "sufficient" || screening.confidence === null
    || screening.confidence < settings.minimumFitConfidence
    || job.descriptionKind === "search-snippet" || !job.description?.trim()) {
    return "needs_review";
  }
  return screening.score >= settings.minimumFitScore ? "potential_fit" : "low_fit";
}

export function fitAssessmentLabel(assessment: FitAssessment) {
  switch (assessment) {
    case "potential_fit": return "Potential fit · estimate";
    case "needs_review": return "Needs review · evidence/confidence";
    case "low_fit": return "Low estimated fit";
    case "detailed_poor_fit": return "Detailed review · poor fit";
    case "detailed_potential_fit": return "Detailed review · potential fit";
    case "not_scored": return "Not scored";
  }
}
