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

  it("recognizes numbered German section headings and inline skill headings", () => {
    const result = extractCvSuggestionsFromText(`
      01 BERUFLICHER WERDEGANG
      Senior Software Engineer
      Example GmbH | Wien
      2021–2024
      02 FACHLICHE KOMPETENZEN
      TypeScript
      Cloud Engineering
      IT-Kenntnisse: AWS, PostgreSQL, Docker
      03 AUSBILDUNG
      MSc Informatik
    `);

    expect(result.roles).toBe("Senior Software Engineer");
    expect(result.skills).toBe("TypeScript, Cloud Engineering, AWS, PostgreSQL, Docker");
  });

  it("extracts the role segment from dated lines that also contain the employer", () => {
    const result = extractCvSuggestionsFromText(`
      Professional Experience
      2021–2024 | Senior Product Engineer | Example GmbH
      2018–2021 | Technical Project Manager | Sample AG
    `);
    expect(result.roles).toBe("Senior Product Engineer; Technical Project Manager");
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

  it("keeps a full-width page heading ahead of two columns and does not mix the columns", () => {
    const text = joinPdfTextItems([
      { str: "Sina Riazi — CV", transform: [1, 0, 0, 1, 30, 780], width: 520 },
      { str: "Technical skills", transform: [1, 0, 0, 1, 20, 730], width: 120 },
      { str: "Professional experience", transform: [1, 0, 0, 1, 350, 730], width: 170 },
      { str: "TypeScript, React", transform: [1, 0, 0, 1, 20, 710], width: 130 },
      { str: "Senior Software Engineer", transform: [1, 0, 0, 1, 350, 710], width: 180 },
      { str: "AWS, PostgreSQL", transform: [1, 0, 0, 1, 20, 690], width: 130 },
      { str: "2021–2024", transform: [1, 0, 0, 1, 350, 690], width: 80 },
      { str: "Education", transform: [1, 0, 0, 1, 30, 650], width: 80 },
    ], 600);

    expect(text).toBe("Sina Riazi — CV\nTechnical skills\nTypeScript, React\nAWS, PostgreSQL\nProfessional experience\nSenior Software Engineer\n2021–2024\nEducation");
    const suggestions = extractCvSuggestionsFromText(text);
    expect(suggestions.skills).toBe("TypeScript, React, AWS, PostgreSQL");
    expect(suggestions.roles).toBe("Senior Software Engineer");
  });
});
