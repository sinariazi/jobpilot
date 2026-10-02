export type CoverLetterDraftInput = {
  candidateName: string;
  role: string;
  company: string;
  matchedSkills: string[];
  reason: string;
  evidence: string;
};

function clean(value: string) {
  return value.replace(/\r/g, "").trim();
}

export function createCoverLetterDraft(input: CoverLetterDraftInput) {
  const name = clean(input.candidateName) || "[Your name]";
  const role = clean(input.role) || "[Role title]";
  const company = clean(input.company) || "[Company]";
  const skills = [...new Set(input.matchedSkills.map(clean).filter(Boolean))];
  const reason = clean(input.reason) || "[Add a specific reason this role or employer interests you.]";
  const evidence = clean(input.evidence) || "[Add a relevant example from your work, including your contribution and the outcome.]";
  const skillsParagraph = skills.length
    ? `Your posting highlights ${skills.join(", ")}, which align with skills I have listed in my profile.`
    : "[No exact profile skill overlap was detected. Replace this sentence with relevant skills you can substantiate, or remove it.]";

  return [
    "Dear Hiring Team,",
    `I am applying for the ${role} position at ${company}. ${reason}`,
    skillsParagraph,
    `A relevant example from my work is: ${evidence}`,
    "I would welcome the opportunity to discuss how my experience could contribute to your team.",
    `Kind regards,\n${name}`,
  ].join("\n\n");
}
