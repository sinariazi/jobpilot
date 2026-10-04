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
};

export type CandidateProfile = {
  name: string;
  roles: string;
  locations: string;
  skills: string;
};

export type ApplicationStatus = "Needs review" | "Approved to prepare" | "Applied" | "Rejected";

export type CoverLetterDraftRecord = {
  interest: string;
  evidence: string;
  draft: string;
  updatedAt: string;
};

export type MatchReview = {
  jobId: string;
  company: string;
  role: string;
  model: string;
  cohortKey: string;
  score: number;
  predictedRelevant: boolean;
  reviewedRelevant: boolean;
  reviewedAt: string;
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
  liveJobs: Job[];
};

export const defaultProfile: CandidateProfile = {
  name: "Candidate",
  roles: "",
  locations: "",
  skills: "",
};
