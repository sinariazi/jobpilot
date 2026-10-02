import { describe, expect, it } from "vitest";
import { createCoverLetterDraft } from "./cover-letter";

describe("createCoverLetterDraft", () => {
  it("uses the selected role, company, profile skill overlaps, and candidate-provided evidence", () => {
    const draft = createCoverLetterDraft({
      candidateName: "Sina Riazi",
      role: "Senior Engineer",
      company: "Example GmbH",
      matchedSkills: ["TypeScript", "React", "TypeScript"],
      reason: "I am interested in your customer platform.",
      evidence: "I delivered a checkout improvement used by several teams.",
    });
    expect(draft).toContain("Senior Engineer position at Example GmbH");
    expect(draft).toContain("TypeScript, React");
    expect(draft).toContain("customer platform");
    expect(draft).toContain("checkout improvement");
    expect(draft).toContain("Kind regards,\nSina Riazi");
    expect(draft).not.toContain("[Add");
  });

  it("marks unsupported details as placeholders instead of inventing achievements", () => {
    const draft = createCoverLetterDraft({ candidateName: "", role: "Engineer", company: "Example", matchedSkills: [], reason: "", evidence: "" });
    expect(draft).toContain("[Your name]");
    expect(draft).toContain("[Add a specific reason");
    expect(draft).toContain("[No exact profile skill overlap was detected");
    expect(draft).toContain("[Add a relevant example from your work");
  });
});
