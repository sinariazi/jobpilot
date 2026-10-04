import type { CandidateProfile, Job } from "./types";

export type AtsPlatform = "greenhouse" | "lever" | "ashby" | "workday" | "smartrecruiters" | "workable" | "unknown";

export type AtsGuide = {
  platform: AtsPlatform;
  label: string;
  preparation: string[];
};

const guides: Record<AtsPlatform, AtsGuide> = {
  greenhouse: { platform: "greenhouse", label: "Greenhouse", preparation: ["Have your CV ready to upload; review parsed contact and experience fields.", "Check any employer-specific questions and required links before continuing.", "Review each uploaded file and answer before manually submitting."] },
  lever: { platform: "lever", label: "Lever", preparation: ["Have your CV ready and confirm your contact details.", "Check the application for portfolio, profile-link, and employer-specific questions.", "Review the final application page before manually submitting."] },
  ashby: { platform: "ashby", label: "Ashby", preparation: ["Have your CV ready and confirm your contact details.", "Review any role-specific questions and requested profile links.", "Check the completed application before manually submitting."] },
  workday: { platform: "workday", label: "Workday", preparation: ["Allow time for the employer's account and multi-step application flow.", "Keep your CV and work-history dates available for the form.", "Review imported work-history fields and the final application before submitting."] },
  smartrecruiters: { platform: "smartrecruiters", label: "SmartRecruiters", preparation: ["Have your CV ready and confirm your contact details.", "Check required profile links and employer-specific questions.", "Review the application before manually submitting."] },
  workable: { platform: "workable", label: "Workable", preparation: ["Have your CV ready and confirm your contact details.", "Check any employer-specific questions and required links.", "Review the application before manually submitting."] },
  unknown: { platform: "unknown", label: "Employer application form", preparation: ["Review the employer's required fields and prepare your CV.", "Use the application packet below to copy your details and cover letter.", "Check every answer on the employer site before manually submitting."] },
};

const hostMatchers: Array<[AtsPlatform, RegExp]> = [
  ["greenhouse", /(^|\.)((boards|job-boards)\.greenhouse\.io|grnh\.se)$/i],
  ["lever", /(^|\.)jobs\.lever\.co$/i],
  ["ashby", /(^|\.)jobs\.ashbyhq\.com$/i],
  ["workday", /(^|\.)myworkdayjobs\.com$/i],
  ["smartrecruiters", /(^|\.)jobs\.smartrecruiters\.com$/i],
  ["workable", /(^|\.)(apply\.workable\.com|jobs\.workable\.com)$/i],
];

/** Best-effort recognition from the employer posting URL; an unrecognized URL stays usable. */
export function detectAtsPlatform(sourceUrl?: string): AtsGuide {
  if (!sourceUrl) return guides.unknown;
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== "https:") return guides.unknown;
    const platform = hostMatchers.find(([, matcher]) => matcher.test(url.hostname))?.[0];
    return guides[platform ?? "unknown"];
  } catch {
    return guides.unknown;
  }
}

export function createApplicationPacket(job: Job, profile: CandidateProfile, coverLetter = ""): string {
  const guide = detectAtsPlatform(job.sourceUrl);
  const fields: Array<[string, string | undefined]> = [
    ["Name", profile.name],
    ["Email", profile.email],
    ["Phone", profile.phone],
    ["LinkedIn", profile.linkedin],
    ["Portfolio", profile.portfolio],
    ["Work authorization / eligibility", profile.workAuthorization],
    ["Target roles", profile.roles],
    ["Preferred location", profile.locations],
    ["Skills", profile.skills],
  ];
  return [
    `${job.role} — ${job.company}`,
    `Application site: ${guide.label}`,
    ...(job.sourceUrl ? [`Posting: ${job.sourceUrl}`] : []),
    "",
    "Candidate details",
    ...fields.filter(([, value]) => Boolean(value?.trim())).map(([label, value]) => `${label}: ${value?.trim()}`),
    ...(coverLetter.trim() ? ["", "Cover letter", coverLetter.trim()] : []),
  ].join("\n");
}
