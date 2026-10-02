import type { Job } from "./types";

export function normalizeSkill(value: string) {
  return value.toLocaleLowerCase().replace(/\.js\b/g, "js").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function scoreJob(job: Job, candidateSkills: string[]) {
  const skills = [...new Set(candidateSkills.map((skill) => skill.trim()).filter(Boolean))];
  const posting = normalizeSkill(`${job.role} ${job.summary} ${job.description ?? ""}`);
  const containsPhrase = (skill: string) => {
    const phrase = normalizeSkill(skill);
    return phrase.length > 0 && ` ${posting} `.includes(` ${phrase} `);
  };
  const matched = skills.filter(containsPhrase);
  const missing = skills.filter((skill) => !containsPhrase(skill));
  const score = Math.round((matched.length / Math.max(skills.length, 1)) * 100);
  return { score, matched, missing };
}
