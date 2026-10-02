import { describe, expect, it } from "vitest";
import { matchesTargetRole, scoreJob } from "./matcher";
import type { Job } from "./types";

const role: Job = {
  id: "test", company: "Example", role: "Engineer", location: "Vienna", mode: "Hybrid", posted: "Today", source: "Test",
  summary: "Seeking TypeScript and Node.js experience. React is helpful.",
};

describe("scoreJob", () => {
  it("scores only profile skills explicitly mentioned in the job text", () => {
    expect(scoreJob(role, ["TypeScript", "React", "Java"])).toEqual({ score: 67, matched: ["TypeScript", "React"], missing: ["Java"], titleMatched: [] });
  });

  it("matches case-insensitively and ignores punctuation differences", () => {
    expect(scoreJob(role, ["TYPESCRIPT", "nodejs", "react"]).score).toBe(100);
  });

  it("handles an empty candidate profile without dividing by zero", () => {
    expect(scoreJob(role, [])).toEqual({ score: 0, matched: [], missing: [], titleMatched: [] });
  });

  it("marks profile skills mentioned in the job title so they can rank ahead of description-only matches", () => {
    const result = scoreJob({ ...role, role: "Senior TypeScript Engineer" }, ["TypeScript", "React"]);
    expect(result).toEqual({ score: 100, matched: ["TypeScript", "React"], missing: [], titleMatched: ["TypeScript"] });
  });
});

describe("matchesTargetRole", () => {
  it("matches one of the user's entered target titles without partial-word matches", () => {
    expect(matchesTargetRole({ ...role, role: "Senior Product Manager" }, "Product Manager; Data Analyst")).toBe(true);
    expect(matchesTargetRole({ ...role, role: "Product Management Intern" }, "Product Manager")).toBe(false);
  });

  it("does not mark roles when no target roles are configured", () => {
    expect(matchesTargetRole(role, "  ")).toBe(false);
  });
});
