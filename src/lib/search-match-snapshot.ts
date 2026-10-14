import type { Job } from "./types";

export type SearchMatchSnapshot = { preferenceKey: string; listingKeys: string[]; jobs: Job[] };

export function searchPreferenceKey(locations: string, roles: string) {
  return JSON.stringify({ locations: locations.trim(), roles: roles.trim() });
}

export function listingKey(job: Job) {
  return job.sourceUrl ?? job.id;
}

export function snapshotSearchMatches(locations: string, roles: string, jobs: Job[]): SearchMatchSnapshot {
  const uniqueJobs = new Map<string, Job>();
  for (const job of jobs) uniqueJobs.set(listingKey(job), job);
  return { preferenceKey: searchPreferenceKey(locations, roles), listingKeys: [...uniqueJobs.keys()], jobs: [...uniqueJobs.values()] };
}

export function addSearchMatches(snapshot: SearchMatchSnapshot | null, locations: string, roles: string, jobs: Job[]): SearchMatchSnapshot {
  const key = searchPreferenceKey(locations, roles);
  const previousJobs = snapshot?.preferenceKey === key ? snapshot.jobs : [];
  const uniqueJobs = new Map(previousJobs.map((job) => [listingKey(job), job]));
  for (const job of jobs) uniqueJobs.set(listingKey(job), job);
  return { preferenceKey: key, listingKeys: [...uniqueJobs.keys()], jobs: [...uniqueJobs.values()] };
}

export function hasSearchMatch(job: Job, locations: string, roles: string, snapshot: SearchMatchSnapshot | null) {
  return snapshot?.preferenceKey === searchPreferenceKey(locations, roles)
    && snapshot.listingKeys.includes(listingKey(job));
}

export function mergeSearchMatchesIntoPool(pool: Job[], snapshot: SearchMatchSnapshot | null) {
  const unique = new Map<string, Job>();
  snapshot?.jobs.forEach((job) => unique.set(listingKey(job), job));
  // Pool copies may be stale or lack a score when the matched row was only
  // retained in the API snapshot. Prefer current provider fields while keeping
  // whichever copy has screening and detailed-analysis results.
  pool.forEach((job) => {
    const key = listingKey(job);
    const previous = unique.get(key);
    unique.set(key, previous ? {
      ...previous,
      ...job,
      screening: job.screening ?? previous.screening,
      aiMatch: job.aiMatch ?? previous.aiMatch,
      detailedAnalysis: job.detailedAnalysis ?? previous.detailedAnalysis,
      description: job.description || previous.description,
      summary: job.summary.length >= previous.summary.length ? job.summary : previous.summary,
    } : job);
  });
  return [...unique.values()];
}

export function applyScreeningsToSearchMatches(
  snapshot: SearchMatchSnapshot | null,
  screeningsById: Map<string, NonNullable<Job["screening"]>>,
) {
  if (!snapshot || screeningsById.size === 0) return snapshot;
  return {
    ...snapshot,
    jobs: snapshot.jobs.map((job) => {
      const screening = screeningsById.get(job.id);
      return screening ? { ...job, screening, aiMatch: undefined, detailedAnalysis: undefined } : job;
    }),
  };
}
