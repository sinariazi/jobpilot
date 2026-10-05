function locationWords(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]+/g) ?? [];
}

const LOCATION_ALIASES: Record<string, string> = {
  austria: "austria", osterreich: "austria", aut: "austria",
  vienna: "wien", wien: "wien",
  zurich: "zurich", zürich: "zurich", zuri: "zurich",
  geneva: "geneve", geneve: "geneve", genf: "geneve",
  munich: "munchen", munchen: "munchen",
  cologne: "koln", koeln: "koln", koln: "koln",
  prague: "praha", praha: "praha",
  schweiz: "switzerland", suisse: "switzerland", schweizerisch: "switzerland",
  deutschland: "germany", deutsch: "germany", alemania: "germany", allemagne: "germany",
  nederland: "netherlands", holland: "netherlands", paysbas: "netherlands",
  espana: "spain", espagne: "spain", italia: "italy", italie: "italy",
  ireland: "ireland", eire: "ireland", irlande: "ireland",
  sverige: "sweden", schweden: "sweden", suede: "sweden",
  norge: "norway", norwegen: "norway", norvege: "norway",
  danmark: "denmark", daenemark: "denmark", dänemark: "denmark",
  suomi: "finland", finnland: "finland",
  polska: "poland", polen: "poland", portugal: "portugal",
  belgique: "belgium", belgie: "belgium", belgien: "belgium",
  ellada: "greece", griechenland: "greece", grecia: "greece",
  romania: "romania", rumania: "romania", rumänien: "romania",
  bulgaria: "bulgaria", hungary: "hungary", ungarn: "hungary", magyarorszag: "hungary",
  slovensko: "slovakia", slowakei: "slovakia",
  slovenija: "slovenia", slowenien: "slovenia",
  hrvatska: "croatia", kroatien: "croatia",
  serbia: "serbia", srbija: "serbia", tschechien: "czechia",
  turkiye: "turkey", türkiye: "turkey", turkei: "turkey", türkei: "turkey",
  uk: "uk", britain: "uk", britania: "uk", england: "uk", scotland: "uk", wales: "uk",
  usa: "usa", us: "usa", america: "usa", amerikanisch: "usa",
  uae: "uae", emirates: "uae",
};

const LOCATION_PHRASE_ALIASES: Array<[string[], string]> = [
  [["united", "states", "of", "america"], "usa"], [["united", "kingdom"], "uk"],
  [["great", "britain"], "uk"], [["united", "states"], "usa"], [["czech", "republic"], "czechia"],
  [["the", "netherlands"], "netherlands"],
  [["south", "korea"], "southkorea"], [["north", "korea"], "northkorea"],
  [["united", "arab", "emirates"], "uae"], [["new", "zealand"], "newzealand"],
  [["south", "africa"], "southafrica"], [["saudi", "arabia"], "saudiarabia"],
  [["st", "polten"], "stpolten"], [["san", "francisco"], "sanfrancisco"],
  [["new", "york"], "newyork"], [["los", "angeles"], "losangeles"],
  [["hong", "kong"], "hongkong"], [["kuala", "lumpur"], "kualalumpur"],
];

// City names add their country as an additional normalized token. This lets a
// country preference include city-only provider labels without weakening
// boundary matching (for example, Austria never matches Australia).
const CITY_COUNTRIES: Record<string, string> = {
  wien: "austria", graz: "austria", linz: "austria", salzburg: "austria", innsbruck: "austria",
  klagenfurt: "austria", bregenz: "austria", stpolten: "austria", eisenstadt: "austria", villach: "austria",
  munchen: "germany", berlin: "germany", hamburg: "germany", frankfurt: "germany", stuttgart: "germany",
  koln: "germany", dusseldorf: "germany", leipzig: "germany", dresden: "germany", hannover: "germany",
  zurich: "switzerland", geneve: "switzerland", basel: "switzerland", bern: "switzerland", lausanne: "switzerland",
  lugano: "switzerland", winterthur: "switzerland",
  praha: "czechia", brno: "czechia", amsterdam: "netherlands", rotterdam: "netherlands", utrecht: "netherlands",
  dublin: "ireland", cork: "ireland", paris: "france", lyon: "france", toulouse: "france", nantes: "france",
  madrid: "spain", barcelona: "spain", valencia: "spain", lisbon: "portugal", porto: "portugal",
  rome: "italy", roma: "italy", milan: "italy", milano: "italy", turin: "italy", torino: "italy",
  stockholm: "sweden", gothenburg: "sweden", oslo: "norway", bergen: "norway", copenhagen: "denmark",
  helsinki: "finland", warsaw: "poland", krakow: "poland", wroclaw: "poland", brussels: "belgium",
  antwerp: "belgium", athens: "greece", bucharest: "romania", budapest: "hungary", bratislava: "slovakia",
  ljubljana: "slovenia", zagreb: "croatia", belgrade: "serbia", istanbul: "turkey", ankara: "turkey",
  london: "uk", manchester: "uk", edinburgh: "uk", birmingham: "uk", newyork: "usa", boston: "usa",
  chicago: "usa", seattle: "usa", austin: "usa", sanfrancisco: "usa", losangeles: "usa", toronto: "canada",
  vancouver: "canada", montreal: "canada", auckland: "newzealand", wellington: "newzealand",
};

function canonicalLocationWords(value: string): string[] {
  const input = locationWords(value);
  const words: string[] = [];
  for (let index = 0; index < input.length;) {
    const phraseAlias = LOCATION_PHRASE_ALIASES.find(([phrase]) => phrase.every((word, offset) => input[index + offset] === word));
    if (phraseAlias) {
      words.push(phraseAlias[1]);
      index += phraseAlias[0].length;
      continue;
    }
    const word = input[index++];
    words.push(LOCATION_ALIASES[word] ?? word);
  }
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
