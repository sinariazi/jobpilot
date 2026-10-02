import type { Job } from "./types";

export function normalizeSkill(value: string) {
  return value.toLowerCase().replace(/\.js/g, "js").trim();
}

export function scoreJob(job: Job, candidateSkills: string[]) {
  const skills = candidateSkills.map(normalizeSkill);
  const matched = job.skills.filter((skill) => skills.includes(normalizeSkill(skill)));
  const missing = job.required.filter((skill) => !skills.includes(normalizeSkill(skill)));
  const requiredMatches = job.required.length - missing.length;
  const score = Math.round((matched.length / Math.max(job.skills.length, 1)) * 55 + (requiredMatches / Math.max(job.required.length, 1)) * 45);
  return { score, matched, missing };
}
