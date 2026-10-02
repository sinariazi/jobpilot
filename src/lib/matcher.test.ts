import { describe, expect, it } from "vitest";
import { scoreJob } from "./matcher";
import type { Job } from "./types";

const role: Job = {
  id: "test", company: "Example", role: "Engineer", location: "Vienna", mode: "Hybrid", posted: "Today", source: "Test",
  summary: "Seeking TypeScript and Node.js experience. React is helpful.",
};

describe("scoreJob", () => {
  it("scores only profile skills explicitly mentioned in the job text", () => {
    expect(scoreJob(role, ["TypeScript", "React", "Java"])).toEqual({ score: 67, matched: ["TypeScript", "React"], missing: ["Java"] });
  });

  it("matches case-insensitively and ignores punctuation differences", () => {
    expect(scoreJob(role, ["TYPESCRIPT", "nodejs", "react"]).score).toBe(100);
  });

  it("handles an empty candidate profile without dividing by zero", () => {
    expect(scoreJob(role, []).score).toBe(0);
  });
});
