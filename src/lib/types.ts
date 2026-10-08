export type Job = {
  id: string;
  company: string;
  role: string;
  location: string;
  mode: string;
  posted: string;
  postedAt?: string;
  source: string;
  department?: string;
  sourceUrl?: string;
  sourceAttributionUrl?: string;
  sourceLocationScope?: string;
  locationEvidence?: string;
  listingVerification?: "search-result";
  descriptionKind?: "search-snippet";
  sourceAliases?: string[];
  retrievedAt?: string;
  summary: string;
  description?: string;
  aiMatch?: {
    model: string;
    relevant: boolean;
    score: number;
    reason: string;
    cvEvidence: string;
  };
  screening?: JobScreening;
  detailedAnalysis?: DetailedJobAnalysis;
};

export type MatchWeights = { skills: number; experience: number; domain: number; disqualifier: number };
export type MatchingSettings = {
  decisionModel: string;
  weights: MatchWeights;
  relevanceScoreThreshold: number;
};
export type JobScreening = {
  model: string;
  score: number;
  confidence: number | null;
  evidenceTruncated?: boolean;
  breakdown: { skills: number | null; experience: number | null; domain: number | null };
  disqualifierRisk: number | null;
  informationStatus: "sufficient" | "cv_missing" | "job_missing" | "both_missing";
};
export type DetailedJobAnalysis = {
  model: string;
  summary: string;
  matchedRequirements: string[];
  gaps: string[];
  evidence: Array<{ requirement: string; cvQuote: string; jobQuote: string }>;
};

export type CandidateProfile = {
  name: string;
  roles: string;
  locations: string;
  skills: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  portfolio?: string;
  workAuthorization?: string;
};

export type ApplicationStatus = "Needs review" | "Approved to prepare" | "Applied" | "Rejected";

export type CoverLetterClaimAudit = {
  verifiedClaims: Array<{ claim: string; source: "profile-name" | "profile-skills" | "candidate-interest" | "candidate-experience"; sourceQuote: string }>;
  unverifiedClaims: string[];
  checkedAt: string;
};

export type CoverLetterDraftPreferences = {
  tone: "professional" | "warm" | "direct";
  language: "English" | "German";
  length: "concise" | "standard";
};

export type CoverLetterDraftRecord = {
  interest: string;
  evidence: string;
  draft: string;
  preferences?: CoverLetterDraftPreferences;
  claimAudit?: CoverLetterClaimAudit;
  updatedAt: string;
};

export type MatchReview = {
  jobId: string;
  company: string;
  role: string;
  model: string;
  configurationKey?: string;
  cohortKey: string;
  score: number;
  predictedRelevant: boolean;
  reviewedRelevant: boolean;
  reviewedAt: string;
};

export type PersistedCvAnalysis = {
  summary?: string;
  seniority?: string;
  domains?: string[];
  highlights?: string[];
  strengths?: string[];
  improvements?: string[];
  topRecommendation?: string;
  notes?: string[];
};

export type PersistedState = {
  profile: CandidateProfile;
  saved: string[];
  status: Record<string, ApplicationStatus>;
  applicationNotes?: Record<string, string>;
  applicationFollowUps?: Record<string, string>;
  coverLetterDrafts?: Record<string, CoverLetterDraftRecord>;
  matchReviews?: MatchReview[];
  matchCohortKey?: string;
  matchingSettings?: MatchingSettings;
  webSearchEnabled?: boolean;
  /** A short extracted-text excerpt and analysis, stored locally for rescreening after reload. */
  cvText?: string;
  cvFileName?: string;
  cvAnalysis?: PersistedCvAnalysis;
  liveJobs: Job[];
};

export const defaultProfile: CandidateProfile = {
  name: "Candidate",
  roles: "",
  locations: "Austria",
  skills: "",
};
