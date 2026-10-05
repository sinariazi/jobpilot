import { createHash } from "node:crypto";
import { matchesPreferredLocation } from "./locations";
import type { Job } from "./types";

const SEARCH_ENDPOINT = "https://ollama.com/api/web_search";
const SEARCH_SOURCE = "Ollama Web Search";
export const OLLAMA_WEB_SEARCH_MAX_QUERIES = 5;
const RESULTS_PER_QUERY = 5;

type OllamaWebResult = { title?: unknown; url?: unknown; content?: unknown };
type OllamaWebResponse = { results?: unknown };

export function buildOllamaWebSearchQueries(roles: string, locations: string) {
  const titleGroups = roles.split(/[;,\n]+/).map((item) => item.trim()).filter(Boolean).slice(0, OLLAMA_WEB_SEARCH_MAX_QUERIES);
  const places = locations.split(/[;\n]+/).map((item) => item.trim()).filter(Boolean).slice(0, 8);
  const locationText = places.length ? ` in ${places.join(" or ")}` : "";
  const roleGroups = titleGroups.length ? titleGroups : ["job vacancy"];
  return roleGroups.map((role) => `${role} jobs hiring${locationText} official job posting`);
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
  apiKey?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
}) {
  const apiKey = options.apiKey ?? process.env.OLLAMA_API_KEY;
  if (!apiKey?.trim()) throw new Error("Optional web search is enabled, but OLLAMA_API_KEY is not set. Follow the optional web-search setup in README, or turn web search off.");
  const queries = buildOllamaWebSearchQueries(options.roles, options.locations);
  const fetcher = options.fetcher ?? fetch;
  const retrievedAt = (options.now ?? (() => new Date()))().toISOString();
  const jobs: Job[] = [];
  // Ollama's free plan allows one concurrent request. Keep these sequential,
  // cap queries per search, and let the ordinary feeds finish independently.
  for (const query of queries) {
    let response: Response;
    try {
      response = await fetcher(SEARCH_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, max_results: RESULTS_PER_QUERY }),
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
    jobs.push(...payload.results.slice(0, RESULTS_PER_QUERY).flatMap((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
      const mapped = mapResult(item as OllamaWebResult, options.locations, retrievedAt);
      return mapped ? [mapped] : [];
    }));
  }
  return { jobs, state: "success" as const };
}
