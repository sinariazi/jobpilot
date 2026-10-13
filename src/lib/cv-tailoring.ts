export type CvTailoringSections = {
  profile: string[];
  skills: string[];
  experience: string[];
  education: string[];
};

export type VerifiedCvTailoring = CvTailoringSections & {
  checkedCount: number;
  rejectedCount: number;
};

export type CvTailoringContact = {
  email?: string;
  phone?: string;
  linkedin?: string;
  portfolio?: string;
};

const SECTION_LIMITS = {
  profile: { items: 4, chars: 900 },
  skills: { items: 12, chars: 240 },
  experience: { items: 12, chars: 1_200 },
  education: { items: 8, chars: 500 },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeExcerpt(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function verifyCvTailoringSections(value: unknown, cvText: string): VerifiedCvTailoring | null {
  if (!isRecord(value)) return null;
  const sections: CvTailoringSections = { profile: [], skills: [], experience: [], education: [] };
  let checkedCount = 0;
  let rejectedCount = 0;
  const source = normalizeExcerpt(cvText);
  for (const key of Object.keys(SECTION_LIMITS) as Array<keyof CvTailoringSections>) {
    const definition = SECTION_LIMITS[key];
    const excerpts = value[key];
    if (!Array.isArray(excerpts) || excerpts.length > definition.items * 2) return null;
    for (const excerpt of excerpts) {
      if (typeof excerpt !== "string" || excerpt.trim().length === 0 || excerpt.length > definition.chars) {
        rejectedCount += 1;
        continue;
      }
      checkedCount += 1;
      const quote = normalizeExcerpt(excerpt);
      if (!quote || !source.includes(quote)) {
        rejectedCount += 1;
        continue;
      }
      if (!sections[key].some((item) => normalizeExcerpt(item) === quote) && sections[key].length < definition.items) {
        sections[key].push(excerpt.replace(/\s+/g, " ").trim());
      }
    }
  }
  if (Object.values(sections).every((items) => items.length === 0)) return null;
  return { ...sections, checkedCount, rejectedCount };
}

export function composeTailoredCvText(input: {
  name: string;
  contact: CvTailoringContact;
  targetRole: string;
  sections: CvTailoringSections;
}) {
  const contact = [input.contact.email, input.contact.phone, input.contact.linkedin, input.contact.portfolio]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const output = [input.name.trim(), contact.join(" · "), input.targetRole.trim()];
  const headings: Array<[keyof CvTailoringSections, string]> = [
    ["profile", "PROFILE"],
    ["skills", "SKILLS"],
    ["experience", "RELEVANT EXPERIENCE"],
    ["education", "EDUCATION & CERTIFICATIONS"],
  ];
  for (const [key, heading] of headings) {
    const excerpts = input.sections[key].map((value) => value.trim()).filter(Boolean);
    if (excerpts.length) output.push(`## ${heading}`, ...excerpts);
  }
  return output.filter(Boolean).join("\n\n");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function renderTailoredCvHtml(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const nonEmptyLines = lines.filter(Boolean);
  const firstLine = nonEmptyLines[0] ?? "CV";
  const body = nonEmptyLines.map((line, index) => {
    if (index === 0) return `<h1>${escapeHtml(line)}</h1>`;
    if (index === 1) return `<p class="contact">${escapeHtml(line)}</p>`;
    if (line.startsWith("## ")) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
    return `<p>${escapeHtml(line)}</p>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(firstLine)} — CV</title>
<style>
*{box-sizing:border-box}body{max-width:800px;margin:40px auto;padding:0 44px;color:#202a23;font:15px/1.55 Arial,Helvetica,sans-serif}h1{margin:0;color:#193b28;font-size:30px;line-height:1.2}h2{margin:26px 0 8px;padding-bottom:5px;border-bottom:1px solid #aab9ae;color:#28543a;font-size:15px;letter-spacing:.08em}p{margin:6px 0;white-space:pre-wrap}.contact{margin:7px 0 15px;color:#56645b;font-size:12px}button{position:fixed;top:14px;right:14px;padding:10px 14px;border:0;border-radius:5px;background:#286c43;color:#fff;font-weight:700;cursor:pointer}@media print{body{max-width:none;margin:0;padding:0;font-size:10.5pt}button{display:none}h2{break-after:avoid}p{orphans:2;widows:2}}
</style></head><body><button onclick="window.print()">Print / Save as PDF</button>${body}</body></html>`;
}

export function tailoredCvFilename(role: string, date = new Date()) {
  const slug = role.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "tailored";
  return `cv-${slug}-${date.toISOString().slice(0, 10)}.html`;
}
