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
  // Pool copies carry screening and detailed-analysis fields, so prefer them
  // when an API-confirmed listing is present in both collections.
  pool.forEach((job) => unique.set(listingKey(job), job));
  return [...unique.values()];
}
