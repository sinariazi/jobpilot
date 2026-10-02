import { describe, expect, it } from "vitest";
import { parseGreenhouseBoardReference } from "./greenhouse-input";

describe("parseGreenhouseBoardReference", () => {
  it("accepts a board ID or a full board URL", () => {
    expect(parseGreenhouseBoardReference("Example-Company")).toBe("example-company");
    expect(parseGreenhouseBoardReference("https://boards.greenhouse.io/Example-Company"))
      .toBe("example-company");
  });

  it("extracts the company board from job and embed links", () => {
    expect(parseGreenhouseBoardReference("https://job-boards.greenhouse.io/example-company/jobs/123"))
      .toBe("example-company");
    expect(parseGreenhouseBoardReference("boards.greenhouse.io/embed/job_board?for=example-company"))
      .toBe("example-company");
  });

  it("rejects unrelated hosts and malformed values", () => {
    expect(parseGreenhouseBoardReference("https://example.com/jobs")).toBeNull();
    expect(parseGreenhouseBoardReference("company careers page")).toBeNull();
    expect(parseGreenhouseBoardReference("")).toBeNull();
  });
});
