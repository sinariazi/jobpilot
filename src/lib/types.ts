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
