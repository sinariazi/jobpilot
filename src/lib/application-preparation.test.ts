import { describe, expect, it } from "vitest";
import { createApplicationPacket, detectAtsPlatform } from "./application-preparation";
import type { CandidateProfile, Job } from "./types";

const job: Job = {
  id: "job-1", company: "Example", role: "Engineer", location: "Vienna", mode: "Hybrid", posted: "Today", source: "Feed",
  sourceUrl: "https://jobs.ashbyhq.com/example/role-id", summary: "Build software",
};

describe("application preparation", () => {
  it.each([
    ["https://boards.greenhouse.io/example/jobs/1", "greenhouse"],
    ["https://jobs.lever.co/example/role", "lever"],
    ["https://jobs.ashbyhq.com/example/role", "ashby"],
    ["https://example.wd5.myworkdayjobs.com/careers", "workday"],
    ["https://jobs.smartrecruiters.com/example/role", "smartrecruiters"],
    ["https://apply.workable.com/example/j/1", "workable"],
  ])("recognizes %s", (url, platform) => {
    expect(detectAtsPlatform(url).platform).toBe(platform);
  });

  it("treats unsupported, malformed, and non-https URLs as an unknown employer form", () => {
    expect(detectAtsPlatform("https://careers.example.com/role").platform).toBe("unknown");
    expect(detectAtsPlatform("javascript:alert(1)").platform).toBe("unknown");
    expect(detectAtsPlatform(undefined).label).toBe("Employer application form");
  });

  it("creates a copy packet from explicitly provided data and leaves absent details out", () => {
    const profile: CandidateProfile = {
      name: "Taylor Candidate", roles: "Engineer", locations: "Austria", skills: "TypeScript",
      email: "taylor@example.test", workAuthorization: "Eligible to work in Austria",
    };
    const packet = createApplicationPacket(job, profile, "Dear Example team");
    expect(packet).toContain("Application site: Ashby");
    expect(packet).toContain("Posting: https://jobs.ashbyhq.com/example/role-id");
    expect(packet).toContain("Email: taylor@example.test");
    expect(packet).toContain("Work authorization / eligibility: Eligible to work in Austria");
    expect(packet).toContain("Dear Example team");
    expect(packet).not.toContain("Phone:");
  });
});
