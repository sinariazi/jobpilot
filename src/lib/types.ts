export type Job = {
  id: string;
  company: string;
  role: string;
  location: string;
  mode: string;
  posted: string;
  source: string;
  department?: string;
  sourceUrl?: string;
  retrievedAt?: string;
  summary: string;
  description?: string;
};

export type CandidateProfile = {
  name: string;
  roles: string;
  locations: string;
  skills: string;
};

export type ApplicationStatus = "Needs review" | "Approved to prepare" | "Applied" | "Rejected";

export type PersistedState = {
  profile: CandidateProfile;
  saved: string[];
  status: Record<string, ApplicationStatus>;
  liveJobs: Job[];
};

export const defaultProfile: CandidateProfile = {
  name: "Candidate",
  roles: "",
  locations: "",
  skills: "",
};
