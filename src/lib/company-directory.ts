import { parseGreenhouseBoardReference } from "./greenhouse-input";

type CompanyRecord = {
  name?: unknown;
  ats_links?: unknown;
};

export type GreenhouseCompany = { name: string; slug: string };

export function searchGreenhouseCompanies(data: unknown, query: string, limit = 20): GreenhouseCompany[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length < 2 || !Array.isArray(data)) return [];

  const companies = new Map<string, GreenhouseCompany>();
  for (const record of data as CompanyRecord[]) {
    if (typeof record?.name !== "string" || !Array.isArray(record.ats_links)) continue;
    const name = record.name.trim();
    if (!name) continue;
    for (const link of record.ats_links) {
      if (typeof link !== "string") continue;
      const slug = parseGreenhouseBoardReference(link);
      if (!slug || (!name.toLocaleLowerCase().includes(needle) && !slug.includes(needle))) continue;
      if (!companies.has(slug)) companies.set(slug, { name, slug });
    }
  }

  return [...companies.values()]
    .sort((a, b) => {
      const aStarts = a.name.toLocaleLowerCase().startsWith(needle) ? 0 : 1;
      const bStarts = b.name.toLocaleLowerCase().startsWith(needle) ? 0 : 1;
      return aStarts - bStarts || a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}
