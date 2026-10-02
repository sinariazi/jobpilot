import type { Job } from "./types";

export type PostedWithin = "any" | "7" | "30";
export type WorkMode = "any" | "remote" | "hybrid" | "onsite";

export function matchesPostedWithin(job: Job, within: PostedWithin, now = Date.now()) {
  if (within === "any") return true;
  if (!job.postedAt) return false;
  const timestamp = Date.parse(job.postedAt);
  if (!Number.isFinite(timestamp)) return false;
  const cutoff = now - Number(within) * 24 * 60 * 60 * 1000;
  return timestamp >= cutoff && timestamp <= now + 24 * 60 * 60 * 1000;
}

export function matchesWorkMode(job: Job, mode: WorkMode) {
  if (mode === "any") return true;
  const posting = `${job.mode} ${job.location}`.toLocaleLowerCase();
  if (mode === "remote") return /\bremote\b|work\s+from\s+home|home\s+office/.test(posting);
  if (mode === "hybrid") return /\bhybrid\b/.test(posting);
  return /\bon[- ]?site\b|\bon[- ]?premises\b|\bin[- ]office\b|\boffice[- ]based\b/.test(posting);
}

export function matchesDepartment(job: Job, department: string) {
  return !department || job.department?.toLocaleLowerCase() === department.toLocaleLowerCase();
}
