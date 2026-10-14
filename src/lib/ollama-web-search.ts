import { createHash } from "node:crypto";
import { matchesPreferredLocation } from "./locations";
import type { Job } from "./types";

const SEARCH_ENDPOINT = "https://ollama.com/api/web_search";
const SEARCH_SOURCE = "Ollama Web Search";
export const OLLAMA_WEB_SEARCH_MAX_QUERIES = 5;
export const OLLAMA_WEB_SEARCH_RESULTS_PER_QUERY = 10;
const QUERY_VARIANTS = [
  "{role} careers and open positions {location} {terms}",
  "{role} vacancies hiring now {location} {terms}",
  "{role} newly posted jobs {location} {terms}",
  "{role} employer career page job openings {location} {terms}",
  "{role} job opportunities applications open {location} {terms}",
  "{role} careers recruitment positions {location} {terms}",
  "{role} job listings accepting applications {location} {terms}",
  "{role} full time job openings {location} {terms}",
  "{role} current hiring opportunities {location} {terms}",
  "{role} employment vacancy career site {location} {terms}",
  "{role} open roles hiring companies {location} {terms}",
  "{role} job advertisement apply now {location} {terms}",
  "{role} senior professional position {location} {terms}",
  "{role} technical leadership jobs {location} {terms}",
  "{role} career opportunities {location} {terms}",
];

type OllamaWebResult = { title?: unknown; url?: unknown; content?: unknown };
type OllamaWebResponse = { results?: unknown };

export function buildOllamaWebSearchQueries(roles: string, locations: string, searchTerms = "", round = 0) {
  const titleGroups = roles.split(/[;,\n]+/).map((item) => item.trim()).filter(Boolean).slice(0, OLLAMA_WEB_SEARCH_MAX_QUERIES);
  const places = locations.split(/[;\n]+/).map((item) => item.trim()).filter(Boolean).slice(0, 4);
  const locationText = places.join(" or ");
  const roleGroups = titleGroups.length ? titleGroups : ["job vacancy"];
  const terms = searchTerms.split(/[;,\n]+/).map((item) => item.trim()).filter(Boolean).slice(0, 8);
  const start = (Math.max(0, Math.floor(round)) * OLLAMA_WEB_SEARCH_MAX_QUERIES) % QUERY_VARIANTS.length;
  return Array.from({ length: OLLAMA_WEB_SEARCH_MAX_QUERIES }, (_, index) => {
    const role = roleGroups[index % roleGroups.length];
    const variant = QUERY_VARIANTS[(start + index) % QUERY_VARIANTS.length];
    const termCount = Math.min(4, terms.length);
    const termOffset = terms.length ? (Math.max(0, Math.floor(round)) * 3 + index * 2) % terms.length : 0;
    const queryTerms = Array.from({ length: termCount }, (_, termIndex) => terms[(termOffset + termIndex) % terms.length]).join(" ");
    return variant.replace("{role}", role).replace("{location}", locationText).replace("{terms}", queryTerms)
      .replace(/\s+/g, " ").trim();
  });
}

function validResultUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { return new URL(value).protocol === "https:" && value.length <= 2048; } catch { return false; }
}

function plainText(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

function mapResult(result: OllamaWebResult, locations: string, retrievedAt: string): Job | null {
  if (typeof result.title !== "string" || !result.title.trim() || !validResultUrl(result.url) || typeof result.content !== "string") return null;
  const role = plainText(result.title).slice(0, 300);
  const snippet = plainText(result.content).slice(0, 4000);
  const requestedLocations = locations.split(/[;\n]+/).map((item) => item.trim()).filter(Boolean);
  const locationEvidence = requestedLocations.find((location) => matchesPreferredLocation(`${role} ${snippet}`, location));
  return {
    id: `ollama-web-${createHash("sha256").update(result.url).digest("hex")}`,
    company: "Employer not identified in search snippet",
    role,
    location: locationEvidence ?? "Location not confirmed",
    ...(locationEvidence ? { locationEvidence: "Search snippet" } : {}),
    mode: "Not provided in search snippet",
    posted: "Date not provided",
    source: SEARCH_SOURCE,
    sourceUrl: result.url,
    sourceAttributionUrl: "https://docs.ollama.com/capabilities/web-search",
    retrievedAt,
    listingVerification: "search-result",
    descriptionKind: "search-snippet",
    summary: snippet || "Search result did not include a text snippet. Open the original page to review it.",
    ...(snippet ? { description: snippet } : {}),
  };
}

function errorMessage(status: number) {
  if (status === 401 || status === 403) return "Ollama Web Search rejected the API key. Check OLLAMA_API_KEY in .env.local and restart Jobpilot.";
  if (status === 429) return "Ollama Web Search is rate limited or its free usage allowance is exhausted. Try again later or turn off optional web search.";
  if (status >= 500) return "Ollama Web Search is temporarily unavailable. Public feed results are still available.";
  return `Ollama Web Search returned HTTP ${status}. Check the API key and try again.`;
}

export async function searchWithOllamaWeb(options: {
  roles: string;
  locations: string;
  searchTerms?: string;
  round?: number;
  apiKey?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
}) {
  const apiKey = options.apiKey ?? process.env.OLLAMA_API_KEY;
  if (!apiKey?.trim()) throw new Error("Optional web search is enabled, but OLLAMA_API_KEY is not set. Follow the optional web-search setup in README, or turn web search off.");
  const queries = buildOllamaWebSearchQueries(options.roles, options.locations, options.searchTerms, options.round);
  const fetcher = options.fetcher ?? fetch;
  const retrievedAt = (options.now ?? (() => new Date()))().toISOString();
  const jobs: Job[] = [];
  // Ollama's free plan allows one concurrent request. Keep requests sequential
  // and bounded; query rounds vary wording because this endpoint has no paging.
  for (const query of queries) {
    let response: Response;
    try {
      response = await fetcher(SEARCH_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, max_results: OLLAMA_WEB_SEARCH_RESULTS_PER_QUERY }),
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      const message = error instanceof Error && error.name === "TimeoutError"
        ? "Ollama Web Search timed out. Try again or turn off optional web search."
        : "Could not connect to Ollama Web Search. Check the internet connection or turn off optional web search.";
      if (jobs.length) return { jobs, error: message, state: "partial" as const };
      throw new Error(message);
    }
    if (!response.ok) {
      const message = errorMessage(response.status);
      if (jobs.length) return { jobs, error: message, state: "partial" as const };
      throw new Error(message);
    }
    let payload: OllamaWebResponse;
    try { payload = await response.json() as OllamaWebResponse; }
    catch {
      const message = "Ollama Web Search returned invalid JSON. Public feed results are still available.";
      if (jobs.length) return { jobs, error: message, state: "partial" as const };
      throw new Error(message);
    }
    if (!Array.isArray(payload.results)) {
      const message = "Ollama Web Search returned an unexpected response. Public feed results are still available.";
      if (jobs.length) return { jobs, error: message, state: "partial" as const };
      throw new Error(message);
    }
    jobs.push(...payload.results.slice(0, OLLAMA_WEB_SEARCH_RESULTS_PER_QUERY).flatMap((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
      const mapped = mapResult(item as OllamaWebResult, options.locations, retrievedAt);
      return mapped && !jobs.some((job) => job.sourceUrl === mapped.sourceUrl) ? [mapped] : [];
    }));
  }
  return { jobs, state: "success" as const };
}
