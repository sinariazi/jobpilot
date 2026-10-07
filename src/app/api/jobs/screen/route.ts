import { normalizeMatchingSettings, normalizeSystemOneScreenResult } from "../../../../lib/job-screening";
import type { MatchWeights } from "../../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const LOCAL_OLLAMA_DEFAULT = "http://127.0.0.1:11434";
const MAX_BODY_CHARS = 100_000;
const MAX_CV_CHARS = 15_000;
const MAX_JOB_CHARS = 12_000;
// System One rejects prompts above 2,050 tokens instead of truncating them.
const MAX_SYSTEM_ONE_EVIDENCE_CHARS = 1_600;
const MAX_SYSTEM_ONE_PREFERENCE_CHARS = 250;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function localUrl() {
  try {
    const url = new URL(process.env.OLLAMA_BASE_URL || LOCAL_OLLAMA_DEFAULT);
    if (url.protocol !== "http:" || !new Set(["localhost", "127.0.0.1", "[::1]"]).has(url.hostname) || url.username || url.password) return null;
    return url.toString().replace(/\/$/, "");
  } catch { return null; }
}
function compatibleVersion(value: unknown) {
  if (typeof value !== "string") return false;
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)/);
  return Boolean(match && (Number(match[1]) > 0 || Number(match[2]) >= 35));
}

function compactEvidence(value: string, limit: number) {
  const text = value.trim();
  if (text.length <= limit) return { text, truncated: false };
  const marker = "\n[…middle omitted to fit local decision model…]\n";
  const available = Math.max(0, limit - marker.length);
  const headLength = Math.ceil(available * 0.6);
  const tailLength = available - headLength;
  return {
    text: `${text.slice(0, headLength)}${marker}${tailLength ? text.slice(-tailLength) : ""}`,
    truncated: true,
  };
}

export async function POST(request: Request) {
  let host = "";
  try { host = new URL(request.url).hostname; } catch { /* Invalid request URL. */ }
  if (!new Set(["localhost", "127.0.0.1", "[::1]"]).has(host)) return Response.json({ error: "For privacy, local screening is available only when Jobpilot is open on this laptop." }, { status: 403 });
  const baseUrl = localUrl();
  if (!baseUrl) return Response.json({ error: "Configure OLLAMA_BASE_URL to a local loopback address." }, { status: 503 });

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) return Response.json({ error: "The local screening request is too large." }, { status: 413 });
    body = JSON.parse(text) as unknown;
  } catch { return Response.json({ error: "The screening request must be valid JSON." }, { status: 400 }); }
  if (!isRecord(body) || typeof body.model !== "string" || !body.model.trim() || body.model.length > 200
    || typeof body.cvText !== "string" || body.cvText.length > MAX_CV_CHARS
    || !isRecord(body.job) || typeof body.job.company !== "string" || typeof body.job.role !== "string"
    || typeof body.job.location !== "string" || typeof body.job.mode !== "string" || typeof body.job.description !== "string"
    || body.job.description.length > MAX_JOB_CHARS || !isRecord(body.weights)) {
    return Response.json({ error: "Provide an installed decision model, parsed CV text, one complete job and valid score weights." }, { status: 400 });
  }
  const weights = body.weights as unknown as MatchWeights;
  const settings = normalizeMatchingSettings({ weights });
  const sum = Object.values(weights).reduce((total, value) => total + (typeof value === "number" ? value : Number.NaN), 0);
  if (!Object.values(weights).every((value) => Number.isInteger(value) && value >= 0 && value <= 100) || sum !== 100) return Response.json({ error: "Match weights must be whole percentages that add up to 100." }, { status: 400 });

  const cvEvidence = compactEvidence(body.cvText as string, MAX_SYSTEM_ONE_EVIDENCE_CHARS);
  const job = {
    company: body.job.company as string,
    role: body.job.role as string,
    location: body.job.location as string,
    mode: body.job.mode as string,
    description: body.job.description as string,
  };
  const description = compactEvidence(job.description, MAX_SYSTEM_ONE_EVIDENCE_CHARS);
  const preferences = isRecord(body.preferences) ? body.preferences : {};
  const locationPreferences = typeof preferences.locations === "string" ? preferences.locations.slice(0, MAX_SYSTEM_ONE_PREFERENCE_CHARS) : "";
  const targetRolePreferences = typeof preferences.targetRoles === "string" ? preferences.targetRoles.slice(0, MAX_SYSTEM_ONE_PREFERENCE_CHARS) : "";
  const state = {
    cv: cvEvidence.text,
    cvEvidenceTruncated: cvEvidence.truncated,
    candidateLocationPreferences: locationPreferences,
    targetRolePreferences,
    job: {
      company: job.company.slice(0, 120),
      role: job.role.slice(0, 180),
      location: job.location.slice(0, 120),
      mode: job.mode.slice(0, 80),
      description: description.text,
      descriptionTruncated: description.truncated,
    },
  };
  const questions = {
    skills: { type: "score", instructions: "How well does the candidate's CV support the job's required technical and professional skills? Assess evidence and importance, not keyword overlap.", criteria: ["No relevant evidence", "Limited or transferable evidence", "Some relevant evidence with important gaps", "Strong evidence for core requirements", "Very strong evidence across requirements"] },
    experience: { type: "score", instructions: "How well do the candidate's demonstrated experience level, responsibilities, and scope match the role and the user's target role preferences?", criteria: ["Major level or responsibility mismatch", "Limited relevant experience", "Partial responsibility and level match", "Strong level and responsibility match", "Very strong direct match"] },
    domain: { type: "score", instructions: "How well do the candidate's demonstrated domain, product, and delivery experience match this job and the user's target role preferences?", criteria: ["No evidence", "Weak or indirect evidence", "Some adjacent experience", "Strong related experience", "Very strong direct experience"] },
    disqualifier: {
      type: "noul",
      instructions: "What is the probability that the available information explicitly shows a material disqualifier: the job location or work arrangement conflicts with candidateLocationPreferences, a required language conflicts with explicit CV evidence, work authorization conflicts with explicit CV evidence, or a mandatory qualification is absent from clear CV evidence? Missing information alone is not evidence of a mismatch; if unclear, treat as no explicit disqualifier.",
      criteria: {
        false: "No explicit material disqualifier is supported by the available CV and job information, or relevant information is missing or unclear.",
        true: "The available CV and job information explicitly supports a material location, language, work authorization, or mandatory qualification conflict.",
      },
    },
    information: { type: "choice", instructions: "Which information is materially missing or too unclear to assess?", criteria: { sufficient: "CV and job requirements contain enough relevant information", cv_missing: "CV evidence is missing or too unclear", job_missing: "Job requirements are missing or too unclear", both_missing: "Both CV and job requirements are missing or too unclear" } },
  };

  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]);
    const [versionResponse, tagsResponse] = await Promise.all([
      fetch(`${baseUrl}/api/version`, { cache: "no-store", signal }),
      fetch(`${baseUrl}/api/tags`, { cache: "no-store", signal }),
    ]);
    if (!versionResponse.ok) return Response.json({ error: "Could not verify the Ollama version. Upgrade Ollama to a release that supports /v1/systemone (0.35 or newer)." }, { status: 503 });
    const versionPayload: unknown = await versionResponse.json();
    if (!isRecord(versionPayload) || !compatibleVersion(versionPayload.version)) return Response.json({ error: "Ollama /v1/systemone requires Ollama 0.35 or newer. Upgrade Ollama, then refresh local AI status." }, { status: 503 });
    if (!tagsResponse.ok) return Response.json({ error: "Ollama is not reachable. Start Ollama on this laptop." }, { status: 503 });
    const tags: unknown = await tagsResponse.json();
    if (!isRecord(tags) || !Array.isArray(tags.models)) return Response.json({ error: "Ollama returned an invalid installed-model list." }, { status: 502 });
    if (!tags.models.some((item) => isRecord(item) && item.name === body.model)) return Response.json({ error: "The selected decision model is not installed. Choose an installed model or install one with Ollama." }, { status: 400 });

    let upstream: Response;
    try {
      upstream = await fetch(`${baseUrl}/v1/systemone`, { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]), body: JSON.stringify({ model: body.model, state, questions }) });
    } catch (error) {
      if (request.signal.aborted) return Response.json({ error: "Local screening was cancelled." }, { status: 499 });
      if (error instanceof Error && error.name === "TimeoutError") return Response.json({ error: "Ollama decision screening timed out. Try a smaller installed decision model." }, { status: 504 });
      return Response.json({ error: "Ollama does not support /v1/systemone. Upgrade it to version 0.35 or newer." }, { status: 503 });
    }
    if (upstream.status === 404 || upstream.status === 405) return Response.json({ error: "This Ollama server does not support /v1/systemone. Upgrade Ollama to 0.35 or newer." }, { status: 503 });
    if (!upstream.ok) {
      let detail = "";
      try { const errorBody: unknown = await upstream.json(); if (isRecord(errorBody) && typeof errorBody.error === "string") detail = ` ${errorBody.error.slice(0, 200)}`; } catch { /* status conveys failure */ }
      if (upstream.status === 400 && /prompt\\s+\\d+\\s+has\\s+\\d+\\s+tokens.*expected\\s+1\\s*[–-]\\s*2050/i.test(detail)) {
        return Response.json({ error: "The decision model rejected the compact screening request because it exceeds Ollama System One’s 2,050-token input limit. Choose a compatible decision model with a larger input window." }, { status: 502 });
      }
      return Response.json({ error: `Ollama screening failed (HTTP ${upstream.status}). Check that the selected model is a decision model.${detail}` }, { status: 502 });
    }
    const payload: unknown = await upstream.json();
    const screening = normalizeSystemOneScreenResult(payload, body.model, settings.weights);
    if (!screening) return Response.json({ error: "The decision model returned malformed or incomplete answers. Try another installed decision model." }, { status: 502 });
    screening.evidenceTruncated = cvEvidence.truncated || description.truncated;
    return Response.json({ screening }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (request.signal.aborted) return Response.json({ error: "Local screening was cancelled." }, { status: 499 });
    if (error instanceof Error && error.name === "TimeoutError") return Response.json({ error: "Ollama did not respond in time. Confirm Ollama is running, then retry." }, { status: 504 });
    return Response.json({ error: "Could not connect to local Ollama. Start it and refresh local AI status." }, { status: 503 });
  }
}
