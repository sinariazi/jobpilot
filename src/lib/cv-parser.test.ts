import { describe, expect, it } from "vitest";
import { extractCvSuggestionsFromText, joinPdfTextItems, parseCvFile } from "./cv-parser";

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

describe("joinPdfTextItems", () => {
  it("preserves PDF visual lines and orders text from left to right", () => {
    const text = joinPdfTextItems([
      { str: "TypeScript, React", transform: [1, 0, 0, 1, 30, 700] },
      { str: "Skills", transform: [1, 0, 0, 1, 30, 720] },
      { str: "Experience", transform: [1, 0, 0, 1, 30, 680] },
    ]);
    expect(text).toBe("Skills\nTypeScript, React\nExperience");
    const suggestions = extractCvSuggestionsFromText(text);
    expect(suggestions.skills).toBe("TypeScript, React");
  });

  it("keeps two PDF columns in reading order so skill and experience sections do not interleave", () => {
    const text = joinPdfTextItems([
      { str: "Skills", transform: [1, 0, 0, 1, 20, 720], width: 60 },
      { str: "TypeScript, React", transform: [1, 0, 0, 1, 20, 700], width: 110 },
      { str: "AWS", transform: [1, 0, 0, 1, 20, 680], width: 30 },
      { str: "Experience", transform: [1, 0, 0, 1, 350, 720], width: 90 },
      { str: "Senior Engineer", transform: [1, 0, 0, 1, 350, 700], width: 130 },
      { str: "2020–2024", transform: [1, 0, 0, 1, 350, 680], width: 70 },
    ], 600);
    expect(text).toBe("Skills\nTypeScript, React\nAWS\nExperience\nSenior Engineer\n2020–2024");
    const suggestions = extractCvSuggestionsFromText(text);
    expect(suggestions.skills).toBe("TypeScript, React, AWS");
    expect(suggestions.roles).toBe("Senior Engineer");
  });
});
