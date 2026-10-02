export type Job = {
  id: string;
  company: string;
  role: string;
  location: string;
  mode: string;
  posted: string;
  source: string;
  sourceUrl?: string;
  retrievedAt?: string;
  skills: string[];
  required: string[];
  summary: string;
  isLive?: boolean;
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
  name: "Demo Candidate",
  roles: "Full-Stack Engineer, AI Engineer, Solution Architect",
  locations: "Remote Europe",
  skills: "TypeScript, React, Next.js, Node.js, PostgreSQL, AWS, Docker, Kubernetes, CI/CD, REST APIs, System design, Playwright",
};
