import { describe, expect, it } from "vitest";
import { extractCvSuggestionsFromText, parseCvFile } from "./cv-parser";

describe("extractCvSuggestionsFromText", () => {
  it("extracts skill-section items and dated experience lines for review", () => {
    const result = extractCvSuggestionsFromText(`
      Sina Riazi
      TECHNICAL SKILLS
      TypeScript, React, PostgreSQL
      AWS | Docker | Kubernetes
      PROFESSIONAL EXPERIENCE
      Senior Full-Stack Engineer | Zooplus | 2021 - 2024
      Product Lead | Example Company | 2018 - 2021
      EDUCATION
      MSc Software Engineering
    `);

    expect(result.skills).toBe("TypeScript, React, PostgreSQL, AWS, Docker, Kubernetes");
    expect(result.roles).toContain("Senior Full-Stack Engineer");
    expect(result.roles).toContain("Product Lead");
    expect(result.notes).toContain("Role suggestions are taken from past experience, not inferred job-search goals.");
    expect(result.notes).toContain("Your CV address is not used as a preferred job location.");
  });

  it("does not invent profile content when CV sections are missing", () => {
    const result = extractCvSuggestionsFromText("A short CV without recognizable sections.");
    expect(result.skills).toBe("");
    expect(result.roles).toBe("");
    expect(result.notes).toContain("No skills section was detected. You can still enter skills manually.");
  });

  it("keeps extracted text available in memory for local model matching", async () => {
    const text = "Professional experience\nSenior Engineer at Example Company from 2021 to 2025. Built TypeScript applications for customers.\nTechnical skills\nTypeScript, React, AWS.";
    const parsed = await parseCvFile(new File([text], "candidate-cv.txt", { type: "text/plain" }));
    expect(parsed.sourceText).toBe(text);
    expect(parsed.skills).toContain("TypeScript");
  });
});
