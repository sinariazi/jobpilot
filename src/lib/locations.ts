function locationWords(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]+/g) ?? [];
}

export function matchesPreferredLocation(jobLocation: string, preferences: string) {
  const actual = new Set(locationWords(jobLocation));
  const alternatives = preferences.split(/[;\n|]+/).map((part) => locationWords(part)).filter((words) => words.length > 0);
  if (alternatives.length === 0) return true;
  return alternatives.some((words) => words.every((word) => actual.has(word)));
}
