import { describe, expect, it } from "vitest";
import { scoreJob } from "./matcher";
import type { Job } from "./types";

const role: Job = {
  id: "test", company: "Example", role: "Engineer", location: "Vienna", mode: "Hybrid", posted: "Today", source: "Test",
  skills: ["TypeScript", "Node.js", "React"], required: ["TypeScript", "Node.js"], summary: "Test role",
};

describe("scoreJob", () => {
  it("returns a transparent score with matched and missing requirements", () => {
    expect(scoreJob(role, ["TypeScript", "React"])).toEqual({ score: 59, matched: ["TypeScript", "React"], missing: ["Node.js"] });
  });

  it("matches case-insensitively and treats JS suffixes consistently", () => {
    expect(scoreJob(role, ["TYPESCRIPT", "node.js", "react"]).score).toBe(100);
  });

  it("handles jobs with no skill data without dividing by zero", () => {
    expect(scoreJob({ ...role, skills: [], required: [] }, []).score).toBe(0);
  });
});
