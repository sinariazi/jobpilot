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

export function matchesPreferredLocation(jobLocation: string, preferences: string, jobMode = "", source = "") {
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
  const listingIsEuropeScoped = source === "Jobicy";
  if (asksForEuropeRemote && (["europe", "emea"].some((region) => actual.has(region)) || (listingIsEuropeScoped && actual.has("remote")))) return true;

  // A plain "Remote" label carries no country eligibility. Do not assume it
  // includes the user's location unless the user explicitly chose any remote.
  return false;
}
