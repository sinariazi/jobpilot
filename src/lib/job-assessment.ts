import type { Job } from "./types";

function assessmentKey(job: Job) {
  return job.sourceUrl ?? job.id;
}

export function jobsToAssess(jobs: Job[], alreadyAssessedKeys: string[] = []) {
  const completed = new Set(alreadyAssessedKeys);
  const included = new Set<string>();
  return jobs.filter((job) => {
    const key = assessmentKey(job);
    if (completed.has(key) || included.has(key)) return false;
    included.add(key);
    return true;
  });
}
