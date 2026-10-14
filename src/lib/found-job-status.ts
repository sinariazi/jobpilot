import { matchesEligibleRemoteLocation, matchesPreferredLocation } from "./locations";
import { hasSearchMatch, type SearchMatchSnapshot } from "./search-match-snapshot";
import { matchesTargetRole } from "./matcher";
import type { Job } from "./types";

export function getFoundJobPreferenceStatus(job: Job, locations: string, roles: string, snapshot: SearchMatchSnapshot | null) {
  const serverMatched = hasSearchMatch(job, locations, roles, snapshot);
  const locationMatches = matchesPreferredLocation(job.location, locations, job.mode, job.source, job.sourceLocationScope)
    || matchesEligibleRemoteLocation(job.location, locations, job.mode);
  const roleMatches = !roles.trim() || matchesTargetRole(job, roles);
  const included = serverMatched || locationMatches && roleMatches;
  const excludedBy = [!roleMatches ? "title" : "", !locationMatches ? "location" : ""].filter(Boolean).join(" and ");
  return { included, excludedBy, locationMatches, roleMatches };
}
