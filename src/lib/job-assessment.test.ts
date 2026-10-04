import { describe, expect, it } from "vitest";
import { jobsToAssess } from "./job-assessment";
import type { Job } from "./types";

function job(index: number): Job {
  return {
    id: `job-${index}`,
    company: `Company ${index}`,
    role: "Software Engineer",
    location: "Vienna",
    mode: "Hybrid",
    posted: "Today",
    source: "Example feed",
    summary: "Build software.",
  };
}

describe("jobsToAssess", () => {
  it("keeps every unique eligible job instead of stopping at the former 60-job limit", () => {
    const jobs = Array.from({ length: 75 }, (_, index) => job(index));
    expect(jobsToAssess(jobs)).toHaveLength(75);
  });

  it("skips jobs already assessed and duplicate source listings", () => {
    const first = { ...job(1), sourceUrl: "https://example.com/jobs/1" };
    const duplicate = { ...job(2), sourceUrl: "https://example.com/jobs/1" };
    const next = { ...job(3), sourceUrl: "https://example.com/jobs/3" };

    expect(jobsToAssess([first, duplicate, next], ["https://example.com/jobs/3"])).toEqual([first]);
  });
});
