function locationWords(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]+/g) ?? [];
}

export function matchesPreferredLocation(jobLocation: string, preferences: string, jobMode = "", source = "") {
  const actual = new Set(locationWords(jobLocation));
  const alternatives: string[][] = preferences.split(/[;\n|]+/).map((part) => locationWords(part)).filter((words) => words.length > 0);
  if (alternatives.length === 0) return true;
  if (alternatives.some((words) => words.every((word) => actual.has(word)))) return true;

  const remoteListing = /remote/i.test(jobMode) || actual.has("remote");
  if (!remoteListing) return false;
  return alternatives.some((words) => {
    const remotePreference = words.includes("remote");
    if (!remotePreference) return false;
    if (["worldwide", "anywhere", "global"].some((word) => actual.has(word))) return true;
    const europePreference = ["europe", "emea"].some((word) => words.includes(word));
    if (!europePreference) return actual.size === 1 && actual.has("remote");
    if (["europe", "emea"].some((word) => actual.has(word))) return true;
    // These feeds are Europe-scoped; remote postings with a city or country
    // in their location field remain eligible for a Europe-remote preference.
    if (source === "Arbeitnow" || source === "Jobicy") return true;
    // Remotive does not apply a region filter, so a location such as "USA"
    // must not be treated as eligible for a Europe-only preference.
    return actual.size === 1 && actual.has("remote");
  });
}
