import { describe, expect, it } from "vitest";
import { matchesPreferredLocation, resolveProviderGeographies } from "./locations";

describe("preferred job locations", () => {
  it("maps user preferences to the current public provider taxonomy", () => {
    const available = [{ name: "Austria", slug: "austria" }, { name: "Europe", slug: "europe" }, { name: "Anywhere", slug: "anywhere" }];
    expect(resolveProviderGeographies("Austria", available).geographies).toEqual([{ name: "Austria", slug: "austria" }]);
    expect(resolveProviderGeographies("Remote Europe", available).geographies).toEqual([{ name: "Europe", slug: "europe" }]);
  });

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

  it("matches regional remote listings only when the user chose that region", () => {
    expect(matchesPreferredLocation("Europe", "Vienna, Austria; Remote Europe", "Remote", "Jobicy")).toBe(true);
    expect(matchesPreferredLocation("Europe", "Vienna, Austria", "Remote", "Remotive")).toBe(false);
    expect(matchesPreferredLocation("Europe", "Wien", "Remote", "Remotive")).toBe(false);
    expect(matchesPreferredLocation("Vienna, Austria", "Vienna, Austria; Remote Europe", "Remote", "Arbeitnow")).toBe(true);
    expect(matchesPreferredLocation("Remote", "Vienna, Austria; Remote Europe", "Remote", "Remotive")).toBe(false);
  });

  it("does not treat a provider query scope or broad EMEA label as job eligibility", () => {
    expect(matchesPreferredLocation("Remote", "Austria", "Remote", "Jobicy", "Austria")).toBe(false);
    expect(matchesPreferredLocation("EMEA", "Vienna, Austria", "Remote", "Jobicy", "Europe")).toBe(false);
    expect(matchesPreferredLocation("Americas, Europe, Israel", "Vienna, Austria", "Remote", "Remotive")).toBe(false);
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
    expect(matchesPreferredLocation("Remote", "Austria; Remote Europe", "Remote", "Jobicy")).toBe(false);
  });
});
