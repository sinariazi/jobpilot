import { describe, expect, it } from "vitest";
import { searchGreenhouseCompanies } from "./company-directory";

describe("searchGreenhouseCompanies", () => {
  const directory = [
    { name: "Example Systems", ats_links: ["https://boards.greenhouse.io/example-systems"] },
    { name: "Example Labs", ats_links: ["https://job-boards.greenhouse.io/example-labs/jobs/123"] },
    { name: "Other Example", ats_links: ["https://jobs.lever.co/other-example"] },
    { name: "Example Systems", ats_links: ["https://job-boards.greenhouse.io/example-systems"] },
    { name: "Invalid", ats_links: ["https://example.com/careers"] },
  ];

  it("returns matching Greenhouse companies and deduplicates their boards", () => {
    expect(searchGreenhouseCompanies(directory, "example")).toEqual([
      { name: "Example Labs", slug: "example-labs" },
      { name: "Example Systems", slug: "example-systems" },
    ]);
  });

  it("ignores non-Greenhouse entries and short queries", () => {
    expect(searchGreenhouseCompanies(directory, "e")).toEqual([]);
    expect(searchGreenhouseCompanies(null, "example")).toEqual([]);
  });

  it("limits results", () => {
    expect(searchGreenhouseCompanies(directory, "example", 1)).toHaveLength(1);
  });
});
