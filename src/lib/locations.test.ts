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

  it("normalizes common English and German city names", () => {
    expect(matchesPreferredLocation("Wien, Österreich", "Vienna, Austria")).toBe(true);
    expect(matchesPreferredLocation("Vienna", "Austria")).toBe(true);
    expect(matchesPreferredLocation("Vienna, Austria", "Wien; Remote Europe")).toBe(true);
    expect(matchesPreferredLocation("München, Germany", "Munich")).toBe(true);
    expect(matchesPreferredLocation("Zürich, Switzerland", "Zurich")).toBe(true);
    expect(matchesPreferredLocation("Genève, Switzerland", "Geneva")).toBe(true);
  });

  it("matches remote Europe against a Europe-wide remote listing", () => {
    expect(matchesPreferredLocation("Europe", "Vienna, Austria; Remote Europe", "Remote", "Jobicy")).toBe(true);
    expect(matchesPreferredLocation("Vienna, Austria", "Vienna, Austria; Remote Europe", "Remote", "Arbeitnow")).toBe(true);
    expect(matchesPreferredLocation("Remote", "Vienna, Austria; Remote Europe", "Remote", "Remotive")).toBe(false);
  });

  it("does not match a remote listing with an explicit conflicting region", () => {
    expect(matchesPreferredLocation("United States", "Vienna, Austria; Remote Europe", "Remote", "Remotive")).toBe(false);
  });

  it("does not treat an ambiguous remote listing as available in Austria", () => {
    expect(matchesPreferredLocation("Remote", "Austria", "Remote", "Remotive")).toBe(false);
    expect(matchesPreferredLocation("Remote", "Austria", "Remote", "Arbeitnow")).toBe(false);
  });

  it("allows worldwide remote roles and only allows plain remote when requested", () => {
    expect(matchesPreferredLocation("Worldwide", "Austria", "Remote", "Remotive")).toBe(true);
    expect(matchesPreferredLocation("Remote", "Austria; Remote", "Remote", "Remotive")).toBe(true);
    expect(matchesPreferredLocation("Remote", "Austria; Remote Europe", "Remote", "Remotive")).toBe(false);
    expect(matchesPreferredLocation("Remote", "Austria; Remote Europe", "Remote", "Jobicy")).toBe(true);
  });
});
