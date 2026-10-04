import { descriptionText } from "./greenhouse";
import type { Job } from "./types";

export type AdzunaMarket = { code: string; label: string; aliases: string[]; site: string };

// Market codes and local sites follow Adzuna's market list. This is provider
// metadata, not a default search location; the user's profile selects markets.
export const ADZUNA_MARKETS: AdzunaMarket[] = [
  { code: "au", label: "Australia", aliases: ["australia"], site: "https://www.adzuna.com.au/" },
  { code: "at", label: "Austria", aliases: ["austria", "österreich"], site: "https://www.adzuna.at/" },
  { code: "be", label: "Belgium", aliases: ["belgium", "belgië", "belgique", "belgien"], site: "https://www.adzuna.be/" },
  { code: "br", label: "Brazil", aliases: ["brazil", "brasil"], site: "https://www.adzuna.com.br/" },
  { code: "ca", label: "Canada", aliases: ["canada"], site: "https://www.adzuna.ca/" },
  { code: "fr", label: "France", aliases: ["france"], site: "https://www.adzuna.fr/" },
  { code: "de", label: "Germany", aliases: ["germany", "deutschland"], site: "https://www.adzuna.de/" },
  { code: "in", label: "India", aliases: ["india"], site: "https://www.adzuna.in/" },
  { code: "it", label: "Italy", aliases: ["italy", "italia"], site: "https://www.adzuna.it/" },
  { code: "mx", label: "Mexico", aliases: ["mexico", "méxico"], site: "https://www.adzuna.com.mx/" },
  { code: "nl", label: "Netherlands", aliases: ["netherlands", "nederland", "holland"], site: "https://www.adzuna.nl/" },
  { code: "nz", label: "New Zealand", aliases: ["new zealand"], site: "https://www.adzuna.co.nz/" },
  { code: "pl", label: "Poland", aliases: ["poland", "polska"], site: "https://www.adzuna.pl/" },
  { code: "sg", label: "Singapore", aliases: ["singapore"], site: "https://www.adzuna.sg/" },
  { code: "za", label: "South Africa", aliases: ["south africa"], site: "https://www.adzuna.co.za/" },
  { code: "es", label: "Spain", aliases: ["spain", "españa"], site: "https://www.adzuna.es/" },
  { code: "ch", label: "Switzerland", aliases: ["switzerland", "schweiz", "suisse", "svizzera"], site: "https://www.adzuna.ch/" },
  { code: "gb", label: "United Kingdom", aliases: ["united kingdom", "great britain", "uk"], site: "https://www.adzuna.co.uk/" },
  { code: "us", label: "United States", aliases: ["united states", "usa", "us"], site: "https://www.adzuna.com/" },
];

export type AdzunaPosting = {
  id?: string | number;
  title?: string;
  description?: string;
  created?: string;
  redirect_url?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  category?: { label?: string };
  contract_type?: string;
  contract_time?: string;
};

export type AdzunaPage = { results?: AdzunaPosting[]; count?: number; mean?: number };

export function adzunaMarketsForLocations(locations: string): AdzunaMarket[] {
  const normalized = locations.toLocaleLowerCase();
  return ADZUNA_MARKETS.filter((market) => market.aliases.some((alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, "iu").test(normalized);
  }));
}

export function adzunaLocationForMarket(locations: string, market: AdzunaMarket): string {
  const candidate = locations.split(/[;\n]+/).map((item) => item.trim()).find((item) => {
    const escapedAliases = market.aliases.map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return escapedAliases.some((alias) => new RegExp(`(^|[^\\p{L}])${alias}([^\\p{L}]|$)`, "iu").test(item));
  });
  return candidate || market.label;
}

function secureAdzunaRedirect(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.toString();
    if (url.protocol === "http:" && /(^|\.)adzuna\.[a-z.]+$/i.test(url.hostname)) {
      url.protocol = "https:";
      return url.toString();
    }
  } catch { /* invalid provider URL */ }
  return undefined;
}

export function mapAdzunaPosting(posting: AdzunaPosting, market: AdzunaMarket, retrievedAt: string): Job | null {
  const sourceUrl = secureAdzunaRedirect(posting.redirect_url);
  if ((typeof posting.id !== "string" && typeof posting.id !== "number") || !posting.title?.trim() || !posting.company?.display_name?.trim() || !sourceUrl) return null;
  const description = descriptionText(posting.description ?? "");
  const created = posting.created && Number.isFinite(Date.parse(posting.created)) ? new Date(posting.created).toISOString() : undefined;
  const mode = [posting.contract_time, posting.contract_type].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" · ") || "See posting";
  return {
    id: `adzuna-${market.code}-${posting.id}`,
    company: posting.company.display_name,
    role: posting.title,
    location: posting.location?.display_name || market.label,
    mode,
    posted: created ? new Date(created).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Date not provided",
    ...(created ? { postedAt: created } : {}),
    source: "Adzuna",
    sourceUrl,
    sourceAttributionUrl: market.site,
    ...(posting.category?.label ? { department: posting.category.label } : {}),
    retrievedAt,
    summary: description.slice(0, 1200) || "Adzuna provides a job-description snippet. Open the advert for full details.",
    ...(description ? { description } : {}),
  };
}
