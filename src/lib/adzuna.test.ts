import { describe, expect, it } from "vitest";
import { adzunaLocationForMarket, adzunaMarketsForLocations, mapAdzunaPosting } from "./adzuna";

describe("Adzuna mapping", () => {
  it("uses only Adzuna markets explicitly named in preferred locations", () => {
    expect(adzunaMarketsForLocations("Vienna, Austria; Zürich, Switzerland").map((market) => market.code)).toEqual(["at", "ch"]);
    expect(adzunaMarketsForLocations("Vienna, Austria; remote Europe").map((market) => market.code)).toEqual(["at"]);
    expect(adzunaMarketsForLocations("Some Australian client in Vienna")).toEqual([]);
    const austria = adzunaMarketsForLocations("Vienna, Austria; remote Europe")[0];
    expect(adzunaLocationForMarket("Vienna, Austria; remote Europe", austria)).toBe("Vienna, Austria");
    expect(adzunaLocationForMarket("Austria", austria)).toBe("Austria");
  });

  it("normalizes a valid listing and keeps its Adzuna attribution link", () => {
    const job = mapAdzunaPosting({
      id: 42,
      title: "Senior Engineer",
      company: { display_name: "Example" },
      location: { display_name: "Vienna, Austria" },
      created: "2026-10-03T10:00:00Z",
      description: "<p>Build reliable services.</p>",
      redirect_url: "http://www.adzuna.at/jobs/land/ad/42",
      contract_time: "full_time",
      category: { label: "IT Jobs" },
    }, adzunaMarketsForLocations("Austria")[0], "2026-10-04T12:00:00Z");

    expect(job).toMatchObject({
      id: "adzuna-at-42",
      source: "Adzuna",
      sourceUrl: "https://www.adzuna.at/jobs/land/ad/42",
      sourceAttributionUrl: "https://www.adzuna.at/",
      location: "Vienna, Austria",
      mode: "full_time",
      description: "Build reliable services.",
    });
  });

  it("drops incomplete postings and unsafe redirect URLs", () => {
    const market = adzunaMarketsForLocations("Austria")[0];
    expect(mapAdzunaPosting({ id: 1, title: "Engineer", company: { display_name: "Example" }, redirect_url: "javascript:alert(1)" }, market, "now")).toBeNull();
    expect(mapAdzunaPosting({ id: 1, company: { display_name: "Example" }, redirect_url: "https://www.adzuna.at/jobs/1" }, market, "now")).toBeNull();
  });
});
