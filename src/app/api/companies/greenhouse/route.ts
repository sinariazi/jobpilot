import { searchGreenhouseCompanies } from "@/lib/company-directory";

const COMPANY_DIRECTORY_URL = "https://raw.githubusercontent.com/outscal/OpenJobs/main/data/companies_v2.json";
const MAX_DIRECTORY_BYTES = 20_000_000;

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("query")?.trim() ?? "";
  if (query.length < 2) return Response.json({ companies: [] });

  try {
    const response = await fetch(COMPANY_DIRECTORY_URL, {
      headers: { Accept: "application/json" },
      next: { revalidate: 86_400 },
    });
    if (!response.ok) throw new Error(`Directory returned HTTP ${response.status}`);
    const directoryText = await response.text();
    if (directoryText.length > MAX_DIRECTORY_BYTES) {
      return Response.json({ error: "Company directory is larger than expected." }, { status: 502 });
    }
    const companies = searchGreenhouseCompanies(JSON.parse(directoryText) as unknown, query);
    return Response.json({ companies });
  } catch {
    return Response.json({ error: "Company search is temporarily unavailable. You can still paste a Greenhouse link." }, { status: 503 });
  }
}
