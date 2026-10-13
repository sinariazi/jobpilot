import { describe, expect, it } from "vitest";
import { composeTailoredCvText, renderTailoredCvHtml, tailoredCvFilename, verifyCvTailoringSections } from "./cv-tailoring";

const cvText = "Senior Software Engineer\nBuilt a payment service handling 2 million transactions.\nTypeScript, PostgreSQL\nBSc Computer Science";

describe("verified CV tailoring", () => {
  it("keeps exact CV excerpts and excludes model claims not found in the source", () => {
    const result = verifyCvTailoringSections({
      profile: ["Senior Software Engineer", "Senior engineer with ten years' experience"],
      skills: ["TypeScript, PostgreSQL"],
      experience: ["Built a payment service handling 2 million transactions."],
      education: ["BSc Computer Science"],
    }, cvText);
    expect(result).toEqual({
      profile: ["Senior Software Engineer"],
      skills: ["TypeScript, PostgreSQL"],
      experience: ["Built a payment service handling 2 million transactions."],
      education: ["BSc Computer Science"],
      checkedCount: 5,
      rejectedCount: 1,
    });
  });

  it("accepts line-break whitespace changes but not invented numbers or skills", () => {
    expect(verifyCvTailoringSections({ profile: [], skills: ["TypeScript,\nPostgreSQL"], experience: ["Built a payment service handling 3 million transactions."], education: [] }, cvText))
      .toMatchObject({ skills: ["TypeScript, PostgreSQL"], experience: [], rejectedCount: 1 });
  });

  it("refuses an empty or malformed model selection", () => {
    expect(verifyCvTailoringSections({ profile: [], skills: [], experience: [], education: [] }, cvText)).toBeNull();
    expect(verifyCvTailoringSections({ profile: "not a list", skills: [], experience: [], education: [] }, cvText)).toBeNull();
  });

  it("composes a role-specific document using supplied profile contact details and selected excerpts", () => {
    const text = composeTailoredCvText({
      name: "Sina Riazi", contact: { email: "sina@example.test", linkedin: "https://linkedin.example/sina" },
      targetRole: "Solution Architect", sections: { profile: ["Senior Software Engineer"], skills: ["TypeScript, PostgreSQL"], experience: [], education: [] },
    });
    expect(text).toContain("Sina Riazi");
    expect(text).toContain("Solution Architect");
    expect(text).toContain("sina@example.test · https://linkedin.example/sina");
    expect(text).toContain("## SKILLS\n\nTypeScript, PostgreSQL");
  });

  it("renders escaped print-ready HTML and a safe role-based filename", () => {
    const html = renderTailoredCvHtml("Sina <Riazi>\ncontact@example.test\nSolution Architect\n\n## PROFILE\n\nBuilt & shipped products");
    expect(html).toContain("<h1>Sina &lt;Riazi&gt;</h1>");
    expect(html).toContain("Built &amp; shipped products");
    expect(html).toContain("Print / Save as PDF");
    expect(tailoredCvFilename("Solution Architect / AI", new Date("2026-10-13T12:00:00Z"))).toBe("cv-solution-architect-ai-2026-10-13.html");
  });

  it("renders documents without a name without treating the target role as contact details", () => {
    const html = renderTailoredCvHtml("Solution Architect\n\n## PROFILE\n\nSenior Software Engineer");
    expect(html).toContain('<h1>Solution Architect</h1>');
    expect(html).not.toContain('class="contact">Solution Architect');
  });
});
