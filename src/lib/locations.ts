function locationWords(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]+/g) ?? [];
}

const LOCATION_ALIASES: Record<string, string> = {
  austria: "austria",
  osterreich: "austria",
  vienna: "wien",
  wien: "wien",
  zurich: "zurich",
  zürich: "zurich",
  geneva: "geneve",
  geneve: "geneve",
  munich: "munchen",
  munchen: "munchen",
  cologne: "koln",
  koln: "koln",
  prague: "praha",
  praha: "praha",
};

const CITY_COUNTRIES: Record<string, string> = {
  wien: "austria",
  graz: "austria",
  linz: "austria",
  salzburg: "austria",
  innsbruck: "austria",
  klagenfurt: "austria",
  bregenz: "austria",
  stpolten: "austria",
  munchen: "germany",
  koln: "germany",
  zurich: "switzerland",
  geneve: "switzerland",
  praha: "czechia",
};

function canonicalLocationWords(value: string): string[] {
  const words = locationWords(value).map((word) => LOCATION_ALIASES[word] ?? word);
  return [...new Set(words.flatMap((word) => [word, ...(CITY_COUNTRIES[word] ? [CITY_COUNTRIES[word]] : [])]))];
}

export type ProviderGeography = { name: string; slug: string };

export function resolveProviderGeographies(preferences: string, available: ProviderGeography[]) {
  const alternatives = preferences.split(/[;\n|]+/).map((value) => value.trim()).filter(Boolean);
  if (alternatives.length === 0) return { geographies: available.filter((geo) => geo.slug === "europe").slice(0, 1), warning: "No location preference was supplied; the remote-job feed uses its Europe-wide public feed." };
  const selected = new Map<string, ProviderGeography>();
  const warnings: string[] = [];
  for (const preference of alternatives) {
    const words = canonicalLocationWords(preference);
    const lower = preference.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const remote = words.includes("remote");
    const requestedRegion = words.find((word) => ["europe", "emea", "apac", "latam"].includes(word));
    const cityCountry = words.map((word) => CITY_COUNTRIES[word]).find(Boolean);
    const countryName = words.includes("austria") ? "Austria" : cityCountry?.replace(/^([a-z])/, (letter) => letter.toUpperCase());
    const candidates = available
      .filter((geo) => {
        const geoWords = canonicalLocationWords(geo.name);
        const geoName = geo.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        if (requestedRegion) return geo.slug === requestedRegion;
        if (remote && words.includes("europe")) return geo.slug === "europe";
        if (remote && words.length === 1) return geo.slug === "anywhere";
        if (countryName && geo.name.toLowerCase() === countryName.toLowerCase()) return true;
        return geoWords.length > 0 && geoWords.every((word) => words.includes(word))
          || geoName.length > 0 && new RegExp(`(^|\\W)${geoName.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}(?=$|\\W)`).test(lower);
      })
      .sort((a, b) => b.name.length - a.name.length);
    if (candidates[0]) selected.set(candidates[0].slug, candidates[0]);
    else warnings.push(`Jobicy could not map “${preference}” to its current location list; its Europe feed will be filtered locally.`);
  }
  const geographies = [...selected.values()].slice(0, 5);
  if (selected.size > geographies.length) warnings.push("Only the first five selected regions were queried to keep provider requests bounded.");
  if (geographies.length === 0) {
    const europe = available.find((geo) => geo.slug === "europe");
    if (europe) geographies.push(europe);
  }
  return { geographies, ...(warnings.length ? { warning: warnings.join(" ") } : {}) };
}

export function matchesPreferredLocation(jobLocation: string, preferences: string, jobMode = "", _source = "", _sourceLocationScope = "") {
  void _source;
  void _sourceLocationScope;
  const actual = new Set(canonicalLocationWords(jobLocation));
  const alternatives: string[][] = preferences.split(/[;\n|]+/).map((part) => canonicalLocationWords(part)).filter((words) => words.length > 0);
  if (alternatives.length === 0) return true;
  if (alternatives.some((words) => words.every((word) => actual.has(word)))) return true;

  const remoteListing = /remote/i.test(jobMode) || actual.has("remote");
  if (!remoteListing) return false;
  if (["worldwide", "anywhere", "global"].some((word) => actual.has(word))) return true;

  const asksForAnyRemote = alternatives.some((words) => words.length === 1 && words[0] === "remote");
  if (asksForAnyRemote) return true;

  const asksForEuropeRemote = alternatives.some((words) => words.includes("remote") && ["europe", "emea"].some((region) => words.includes(region)));
  if (asksForEuropeRemote && ["europe", "emea"].some((region) => actual.has(region))) return true;

  // A plain "Remote" label carries no country eligibility. Do not assume it
  // includes the user's location unless the user explicitly chose any remote.
  return false;
}
