import type { Job } from "./types";

export type SearchMatchSnapshot = { preferenceKey: string; listingKeys: string[] };

export function searchPreferenceKey(locations: string, roles: string) {
  return JSON.stringify({ locations: locations.trim(), roles: roles.trim() });
}

export function listingKey(job: Job) {
  return job.sourceUrl ?? job.id;
}

export function snapshotSearchMatches(locations: string, roles: string, jobs: Job[]): SearchMatchSnapshot {
  return { preferenceKey: searchPreferenceKey(locations, roles), listingKeys: [...new Set(jobs.map(listingKey))] };
}

export function addSearchMatches(snapshot: SearchMatchSnapshot | null, locations: string, roles: string, jobs: Job[]): SearchMatchSnapshot {
  const key = searchPreferenceKey(locations, roles);
  const previousKeys = snapshot?.preferenceKey === key ? snapshot.listingKeys : [];
  return { preferenceKey: key, listingKeys: [...new Set([...previousKeys, ...jobs.map(listingKey)])] };
}

export function hasSearchMatch(job: Job, locations: string, roles: string, snapshot: SearchMatchSnapshot | null) {
  return snapshot?.preferenceKey === searchPreferenceKey(locations, roles)
    && snapshot.listingKeys.includes(listingKey(job));
}
