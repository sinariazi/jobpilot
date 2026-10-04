import type { Job } from "./types";

export function normalizeSkill(value: string) {
  return value.toLocaleLowerCase().replace(/\.js\b/g, "js").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function scoreJob(job: Job, candidateSkills: string[]) {
  const skills = [...new Set(candidateSkills.map((skill) => skill.trim()).filter(Boolean))];
  const title = normalizeSkill(job.role);
  const posting = normalizeSkill(`${job.summary} ${job.description ?? ""}`);
  const containsPhrase = (text: string, skill: string) => {
    const phrase = normalizeSkill(skill);
    return phrase.length > 0 && ` ${text} `.includes(` ${phrase} `);
  };
  const titleMatched = skills.filter((skill) => containsPhrase(title, skill));
  const matched = skills.filter((skill) => titleMatched.includes(skill) || containsPhrase(posting, skill));
  const missing = skills.filter((skill) => !matched.includes(skill));
  const score = Math.round((matched.length / Math.max(skills.length, 1)) * 100);
  return { score, matched, missing, titleMatched };
}

export function matchesTargetRole(job: Job, targetRoles: string) {
  const roles = targetRoles.split(/[,;\n|]+/).map(normalizeSkill).filter(Boolean);
  if (roles.length === 0) return false;
  const title = normalizeSkill(job.role);
  return roles.some((role) => ` ${title} `.includes(` ${role} `) || ` ${role} `.includes(` ${title} `));
}


export function isRelevantToProfile(job: Job, candidateSkills: string[], targetRoles: string) {
  if (matchesTargetRole(job, targetRoles)) return true;
  const match = scoreJob(job, candidateSkills);
  if (match.titleMatched.length > 0) return true;
  const minimumSkillMatches = candidateSkills.length < 3 ? 1 : 2;
  return match.matched.length >= minimumSkillMatches;
}
