import type { JobScreening, MatchWeights, MatchingSettings } from "./types";

export const DEFAULT_MATCH_WEIGHTS: MatchWeights = { skills: 40, experience: 30, domain: 20, disqualifier: 10 };
export const DEFAULT_MATCHING_SETTINGS: MatchingSettings = {
  decisionModel: "",
  weights: DEFAULT_MATCH_WEIGHTS,
  detailedScoreThreshold: 65,
  detailedConfidenceThreshold: 60,
};

export type LocalScreeningReadiness = {
  hasCv: boolean;
  isLocalPage: boolean;
  ollamaConnected: boolean | null;
  systemOneAvailable: boolean;
  decisionModelInstalled: boolean;
  analysisModelInstalled: boolean;
};

/** Returns a user-actionable explanation when local screening cannot start. */
export function localScreeningReadinessMessage(readiness: LocalScreeningReadiness): string | null {
  if (!readiness.hasCv) return "Upload and analyze your CV before requesting match scores.";
  if (!readiness.isLocalPage) return "Open Jobpilot at http://localhost:3000 so CV and job text stay on this laptop.";
  if (readiness.ollamaConnected === null) return "Checking Ollama on this laptop. Refresh Local AI status, then try again.";
  if (!readiness.ollamaConnected) return "Start Ollama on this laptop, then refresh Local AI status.";
  if (!readiness.systemOneAvailable) return "Update Ollama to version 0.35 or newer to use the local decision API.";
  if (!readiness.decisionModelInstalled) return "Choose an installed decision model in Local AI status.";
  if (!readiness.analysisModelInstalled) return "Choose an installed Ollama chat model for detailed analysis in Local AI status.";
  return null;
}

export function normalizeMatchingSettings(value: unknown): MatchingSettings {
  if (!value || typeof value !== "object") return DEFAULT_MATCHING_SETTINGS;
  const raw = value as Partial<MatchingSettings>;
  const weights = raw.weights;
  const isValidWeights = weights && Object.values(DEFAULT_MATCH_WEIGHTS).every((_, index) => {
    const key = (Object.keys(DEFAULT_MATCH_WEIGHTS) as Array<keyof MatchWeights>)[index];
    return Number.isInteger(weights[key]) && weights[key] >= 0 && weights[key] <= 100;
  }) && Object.values(weights).reduce((sum, item) => sum + item, 0) === 100;
  return {
    decisionModel: typeof raw.decisionModel === "string" && raw.decisionModel.length <= 200 ? raw.decisionModel.trim() : "",
    weights: isValidWeights ? { ...weights } : DEFAULT_MATCH_WEIGHTS,
    detailedScoreThreshold: Number.isInteger(raw.detailedScoreThreshold) && raw.detailedScoreThreshold! >= 0 && raw.detailedScoreThreshold! <= 100 ? raw.detailedScoreThreshold! : DEFAULT_MATCHING_SETTINGS.detailedScoreThreshold,
    detailedConfidenceThreshold: Number.isInteger(raw.detailedConfidenceThreshold) && raw.detailedConfidenceThreshold! >= 0 && raw.detailedConfidenceThreshold! <= 100 ? raw.detailedConfidenceThreshold! : DEFAULT_MATCHING_SETTINGS.detailedConfidenceThreshold,
  };
}

type Answer = { type?: unknown; score?: unknown; confidence?: unknown; noul?: unknown; choice?: unknown };
type SystemOneResponse = { answers?: unknown };
const answerNames = ["skills", "experience", "domain"] as const;

function unit(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

/** Ollama System One score values are probability-weighted rubric indexes: 0..N-1. */
function rubricScore(value: unknown, criteriaCount: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > criteriaCount - 1 || criteriaCount < 2) return null;
  return value / (criteriaCount - 1);
}

export function normalizeSystemOneScreenResult(payload: unknown, model: string, weights: MatchWeights): JobScreening | null {
  if (!payload || typeof payload !== "object" || !("answers" in payload)) return null;
  const answers = (payload as SystemOneResponse).answers;
  if (!answers || typeof answers !== "object") return null;
  const record = answers as Record<string, Answer>;
  const scores = Object.fromEntries(answerNames.map((name) => [name, rubricScore(record[name]?.score, 5)])) as Record<(typeof answerNames)[number], number | null>;
  const disqualifierRisk = unit(record.disqualifier?.noul);
  const information = record.information?.choice;
  if (answerNames.some((name) => scores[name] === null) || disqualifierRisk === null
    || !["sufficient", "cv_missing", "job_missing", "both_missing"].includes(String(information))) return null;
  const confidenceValues = [...answerNames.map((name) => unit(record[name]?.confidence)), unit(record.information?.confidence)].filter((value): value is number => value !== null);
  const weighted = ((scores.skills ?? 0) * weights.skills + (scores.experience ?? 0) * weights.experience + (scores.domain ?? 0) * weights.domain + (1 - disqualifierRisk) * weights.disqualifier) / 100;
  return {
    model,
    score: Math.round(weighted * 100),
    confidence: confidenceValues.length ? Math.round(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length * 100) : null,
    breakdown: { skills: scores.skills === null ? null : Math.round(scores.skills * 100), experience: scores.experience === null ? null : Math.round(scores.experience * 100), domain: scores.domain === null ? null : Math.round(scores.domain * 100) },
    disqualifierRisk: Math.round(disqualifierRisk * 100),
    informationStatus: information as JobScreening["informationStatus"],
  };
}

export function shouldRunDetailedAnalysis(screening: JobScreening | undefined, settings: MatchingSettings) {
  if (!screening || screening.confidence === null || screening.confidence < settings.detailedConfidenceThreshold) return true;
  if (screening.informationStatus !== "sufficient") return true;
  return screening.score >= settings.detailedScoreThreshold;
}
