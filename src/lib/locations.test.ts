import { describe, expect, it } from "vitest";
import { matchesPreferredLocation } from "./locations";

describe("preferred job locations", () => {
  it("matches all words in a preferred location and supports several preferences", () => {
    expect(matchesPreferredLocation("Vienna, Austria", "Austria")).toBe(true);
    expect(matchesPreferredLocation("Remote — Europe", "Austria; Remote Europe")).toBe(true);
    expect(matchesPreferredLocation("Zurich, Switzerland", "Austria; Remote Europe")).toBe(false);
  });

  it("does not match partial country names", () => {
    expect(matchesPreferredLocation("Remote Australia", "Austria")).toBe(false);
  });
});
