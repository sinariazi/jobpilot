import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ApplicationStatus, CandidateProfile, CoverLetterDraftRecord, Job, MatchReview, PersistedCvAnalysis, PersistedState } from "./types";
import { defaultProfile } from "./types";
import { MAX_MATCH_REVIEWS } from "./match-calibration";
import { normalizeMatchingSettings } from "./job-screening";
import type { DetailedJobAnalysis, JobScreening, MatchingSettings } from "./types";

const STORAGE_VERSION = 1;
const MAX_TRACKED_JOBS = 2_000;
const allowedStatuses = new Set<ApplicationStatus>([
  "Needs review",
  "Approved to prepare",
  "Applied",
  "Rejected",
]);

export type LoadedState = PersistedState & { initialized: boolean };

export function defaultState(): LoadedState {
  return { profile: defaultProfile, saved: [], status: {}, applicationNotes: {}, applicationFollowUps: {}, coverLetterDrafts: {}, matchReviews: [], matchCohortKey: "", matchingSettings: normalizeMatchingSettings(undefined), liveJobs: [], initialized: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function parseProfile(value: unknown): CandidateProfile | null {
  if (!isRecord(value)) return null;
  if (!boundedString(value.name, 120)) return null;
  if (typeof value.roles !== "string" || value.roles.length > 2000) return null;
  if (typeof value.locations !== "string" || value.locations.length > 2000) return null;
  if (typeof value.skills !== "string" || value.skills.length > 4000) return null;
  if ((value.email !== undefined && (typeof value.email !== "string" || value.email.length > 320))
    || (value.phone !== undefined && (typeof value.phone !== "string" || value.phone.length > 100))
    || (value.linkedin !== undefined && (typeof value.linkedin !== "string" || value.linkedin.length > 2048))
    || (value.portfolio !== undefined && (typeof value.portfolio !== "string" || value.portfolio.length > 2048))
    || (value.workAuthorization !== undefined && (typeof value.workAuthorization !== "string" || value.workAuthorization.length > 1000))) return null;
  return {
    name: value.name.trim(),
    roles: value.roles.trim(),
    locations: value.locations.trim(),
    skills: value.skills.trim(),
    ...(typeof value.email === "string" ? { email: value.email.trim() } : {}),
    ...(typeof value.phone === "string" ? { phone: value.phone.trim() } : {}),
    ...(typeof value.linkedin === "string" ? { linkedin: value.linkedin.trim() } : {}),
    ...(typeof value.portfolio === "string" ? { portfolio: value.portfolio.trim() } : {}),
    ...(typeof value.workAuthorization === "string" ? { workAuthorization: value.workAuthorization.trim() } : {}),
  };
}

function parseStringArray(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  if (!value.every((item) => boundedString(item, maxLength))) return null;
  return [...new Set(value.map((item) => item.trim()))];
}

function parseJob(value: unknown): Job | null {
  if (!isRecord(value)) return null;
  const textFields: Array<[keyof Pick<Job, "id" | "company" | "role" | "location" | "mode" | "posted" | "source" | "summary">, number]> = [
    ["id", 300], ["company", 160], ["role", 300], ["location", 300],
    ["mode", 100], ["posted", 100], ["source", 100], ["summary", 4000],
  ];
  if (!textFields.every(([key, max]) => boundedString(value[key], max))) return null;
  if (value.sourceUrl !== undefined) {
    if (!boundedString(value.sourceUrl, 2048)) return null;
    try {
      if (new URL(value.sourceUrl).protocol !== "https:") return null;
    } catch {
      return null;
    }
  }
  if (value.retrievedAt !== undefined && !boundedString(value.retrievedAt, 50)) return null;
  if (value.postedAt !== undefined && (!boundedString(value.postedAt, 50) || !Number.isFinite(Date.parse(value.postedAt)))) return null;
  if (value.department !== undefined && !boundedString(value.department, 500)) return null;
  if (value.sourceLocationScope !== undefined && !boundedString(value.sourceLocationScope, 100)) return null;
  const sourceAliases = value.sourceAliases === undefined ? undefined : parseStringArray(value.sourceAliases, 10, 100);
  if (value.sourceAliases !== undefined && !sourceAliases) return null;
  if (value.description !== undefined && (typeof value.description !== "string" || value.description.length > 8000)) return null;
  if (value.aiMatch !== undefined && (!isRecord(value.aiMatch)
    || !boundedString(value.aiMatch.model, 200)
    || typeof value.aiMatch.relevant !== "boolean"
    || typeof value.aiMatch.score !== "number" || !Number.isInteger(value.aiMatch.score) || value.aiMatch.score < 0 || value.aiMatch.score > 100
    || !boundedString(value.aiMatch.reason, 500) || !boundedString(value.aiMatch.cvEvidence, 300))) return null;
  let screening: JobScreening | undefined;
  if (value.screening !== undefined) {
    const item = value.screening;
    if (!isRecord(item) || !boundedString(item.model, 200) || !Number.isInteger(item.score) || (item.score as number) < 0 || (item.score as number) > 100
      || !isRecord(item.breakdown)
      || !(item.confidence === null || (typeof item.confidence === "number" && Number.isInteger(item.confidence) && item.confidence >= 0 && item.confidence <= 100))
      || !(item.disqualifierRisk === null || (typeof item.disqualifierRisk === "number" && Number.isInteger(item.disqualifierRisk) && item.disqualifierRisk >= 0 && item.disqualifierRisk <= 100))
      || !["sufficient", "cv_missing", "job_missing", "both_missing"].includes(String(item.informationStatus))) return null;
    const breakdown = item.breakdown;
    if (!["skills", "experience", "domain"].every((key) => {
      const part = breakdown[key];
      return part === null || (typeof part === "number" && Number.isInteger(part) && part >= 0 && part <= 100);
    })) return null;
    screening = item as unknown as JobScreening;
  }
  let detailedAnalysis: DetailedJobAnalysis | undefined;
  if (value.detailedAnalysis !== undefined) {
    const item = value.detailedAnalysis;
    if (!isRecord(item) || !boundedString(item.model, 200) || typeof item.summary !== "string" || item.summary.length > 3000
      || !Array.isArray(item.matchedRequirements) || item.matchedRequirements.length > 30 || !item.matchedRequirements.every((entry) => boundedString(entry, 500))
      || !Array.isArray(item.gaps) || item.gaps.length > 30 || !item.gaps.every((entry) => boundedString(entry, 500))
      || !Array.isArray(item.evidence) || item.evidence.length > 30 || !item.evidence.every((entry) => isRecord(entry) && boundedString(entry.requirement, 500) && boundedString(entry.cvQuote, 500) && boundedString(entry.jobQuote, 500))) return null;
    detailedAnalysis = item as unknown as DetailedJobAnalysis;
  }
  return {
    id: (value.id as string).trim(),
    company: (value.company as string).trim(),
    role: (value.role as string).trim(),
    location: (value.location as string).trim(),
    mode: (value.mode as string).trim(),
    posted: (value.posted as string).trim(),
    ...(typeof value.postedAt === "string" ? { postedAt: value.postedAt } : {}),
    source: (value.source as string).trim(),
    ...(typeof value.department === "string" ? { department: value.department.trim() } : {}),
    summary: (value.summary as string).trim(),
    ...(typeof value.description === "string" ? { description: value.description.trim() } : {}),
    ...(typeof value.sourceUrl === "string" ? { sourceUrl: value.sourceUrl } : {}),
    ...(typeof value.sourceLocationScope === "string" ? { sourceLocationScope: value.sourceLocationScope } : {}),
    ...(sourceAliases ? { sourceAliases } : {}),
    ...(typeof value.retrievedAt === "string" ? { retrievedAt: value.retrievedAt } : {}),
    ...(isRecord(value.aiMatch) ? { aiMatch: {
      model: value.aiMatch.model as string,
      relevant: value.aiMatch.relevant as boolean,
      score: value.aiMatch.score as number,
      reason: value.aiMatch.reason as string,
      cvEvidence: value.aiMatch.cvEvidence as string,
    } } : {}),
    ...(screening ? { screening } : {}),
    ...(detailedAnalysis ? { detailedAnalysis } : {}),
  };
}

export function parsePersistedState(value: unknown): PersistedState | null {
  if (!isRecord(value)) return null;
  const profile = parseProfile(value.profile);
  const saved = parseStringArray(value.saved, MAX_TRACKED_JOBS, 300);
  if (!profile || !saved || !isRecord(value.status)) return null;
  const statusEntries = Object.entries(value.status);
  if (statusEntries.length > MAX_TRACKED_JOBS || statusEntries.some(([id, status]) => !id || id.length > 300 || typeof status !== "string" || !allowedStatuses.has(status as ApplicationStatus))) return null;
  const applicationNotes = value.applicationNotes === undefined ? {} : value.applicationNotes;
  if (!isRecord(applicationNotes) || Object.entries(applicationNotes).length > MAX_TRACKED_JOBS || Object.entries(applicationNotes).some(([id, note]) => !id || id.length > 300 || typeof note !== "string" || note.length > 2000)) return null;
  const applicationFollowUps = value.applicationFollowUps === undefined ? {} : value.applicationFollowUps;
  if (!isRecord(applicationFollowUps) || Object.entries(applicationFollowUps).length > MAX_TRACKED_JOBS || Object.entries(applicationFollowUps).some(([id, date]) => {
    if (!id || id.length > 300 || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return true;
    const parsed = new Date(`${date}T00:00:00.000Z`);
    return !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date;
  })) return null;
  const coverLetterDrafts = value.coverLetterDrafts === undefined ? {} : value.coverLetterDrafts;
  if (!isRecord(coverLetterDrafts) || Object.entries(coverLetterDrafts).length > MAX_TRACKED_JOBS) return null;
  const parsedDrafts: Record<string, CoverLetterDraftRecord> = {};
  for (const [id, entry] of Object.entries(coverLetterDrafts)) {
    if (!id || id.length > 300 || !isRecord(entry)
      || typeof entry.interest !== "string" || entry.interest.length > 2000
      || typeof entry.evidence !== "string" || entry.evidence.length > 4000
      || typeof entry.draft !== "string" || entry.draft.length > 20_000
      || typeof entry.updatedAt !== "string" || !Number.isFinite(Date.parse(entry.updatedAt))) return null;
    parsedDrafts[id] = { interest: entry.interest, evidence: entry.evidence, draft: entry.draft, updatedAt: entry.updatedAt };
  }
  const matchReviews = value.matchReviews === undefined ? [] : value.matchReviews;
  if (!Array.isArray(matchReviews) || matchReviews.length > MAX_MATCH_REVIEWS) return null;
  const parsedMatchReviews: MatchReview[] = [];
  for (const entry of matchReviews) {
    if (!isRecord(entry) || !boundedString(entry.jobId, 300) || !boundedString(entry.company, 160)
      || !boundedString(entry.role, 300) || !boundedString(entry.model, 200)
      || (entry.configurationKey !== undefined && (typeof entry.configurationKey !== "string" || entry.configurationKey.length > 500))
      || typeof entry.cohortKey !== "string" || !/^[a-f0-9]{64}$/.test(entry.cohortKey)
      || typeof entry.score !== "number" || !Number.isInteger(entry.score) || entry.score < 0 || entry.score > 100
      || typeof entry.predictedRelevant !== "boolean" || typeof entry.reviewedRelevant !== "boolean"
      || typeof entry.reviewedAt !== "string" || !Number.isFinite(Date.parse(entry.reviewedAt))) return null;
    parsedMatchReviews.push({
      jobId: entry.jobId.trim(), company: entry.company.trim(), role: entry.role.trim(), model: entry.model.trim(),
      ...(typeof entry.configurationKey === "string" ? { configurationKey: entry.configurationKey } : {}),
      cohortKey: entry.cohortKey, score: entry.score, predictedRelevant: entry.predictedRelevant,
      reviewedRelevant: entry.reviewedRelevant, reviewedAt: entry.reviewedAt,
    });
  }
  const matchCohortKey = value.matchCohortKey === undefined ? "" : value.matchCohortKey;
  if (typeof matchCohortKey !== "string" || (matchCohortKey !== "" && !/^[a-f0-9]{64}$/.test(matchCohortKey))) return null;
  if (value.cvText !== undefined && (typeof value.cvText !== "string" || value.cvText.length > 10_000)) return null;
  if (value.cvFileName !== undefined && (typeof value.cvFileName !== "string" || value.cvFileName.length > 200)) return null;
  let cvAnalysis: PersistedCvAnalysis | undefined;
  if (value.cvAnalysis !== undefined) {
    const item = value.cvAnalysis;
    if (!isRecord(item)
      || (item.summary !== undefined && (typeof item.summary !== "string" || item.summary.length > 4000))
      || (item.seniority !== undefined && (typeof item.seniority !== "string" || item.seniority.length > 200))
      || (item.domains !== undefined && !parseStringArray(item.domains, 30, 200))
      || (item.highlights !== undefined && !parseStringArray(item.highlights, 30, 500))
      || (item.notes !== undefined && !parseStringArray(item.notes, 30, 500))) return null;
    cvAnalysis = {
      ...(typeof item.summary === "string" ? { summary: item.summary } : {}),
      ...(typeof item.seniority === "string" ? { seniority: item.seniority } : {}),
      ...(Array.isArray(item.domains) ? { domains: parseStringArray(item.domains, 30, 200)! } : {}),
      ...(Array.isArray(item.highlights) ? { highlights: parseStringArray(item.highlights, 30, 500)! } : {}),
      ...(Array.isArray(item.notes) ? { notes: parseStringArray(item.notes, 30, 500)! } : {}),
    };
  }
  if (value.liveJobs !== undefined && (!Array.isArray(value.liveJobs) || value.liveJobs.length > MAX_TRACKED_JOBS)) return null;
  const liveJobs = value.liveJobs === undefined ? [] : value.liveJobs.map(parseJob);
  if (liveJobs.some((job) => job === null)) return null;
  const matchingSettings: MatchingSettings = normalizeMatchingSettings(value.matchingSettings);
  return {
    profile,
    saved,
    status: Object.fromEntries(statusEntries) as Record<string, ApplicationStatus>,
    applicationNotes: Object.fromEntries(Object.entries(applicationNotes)) as Record<string, string>,
    applicationFollowUps: Object.fromEntries(Object.entries(applicationFollowUps)) as Record<string, string>,
    coverLetterDrafts: parsedDrafts,
    matchReviews: parsedMatchReviews,
    matchCohortKey,
    matchingSettings,
    ...(typeof value.cvText === "string" ? { cvText: value.cvText } : {}),
    ...(typeof value.cvFileName === "string" ? { cvFileName: value.cvFileName } : {}),
    ...(cvAnalysis ? { cvAnalysis } : {}),
    liveJobs: liveJobs as Job[],
  };
}

function getDataDirectory() {
  const configured = process.env.JOBPILOT_DATA_DIR;
  return configured ? resolve(configured) : join(homedir(), ".jobpilot");
}

function statePath(directory: string) {
  return join(directory, "state.json");
}

export async function loadLocalState(directory = getDataDirectory()): Promise<LoadedState> {
  try {
    const contents = await readFile(statePath(directory), "utf8");
    const stored = JSON.parse(contents) as unknown;
    if (!isRecord(stored) || stored.version !== STORAGE_VERSION) {
      throw new Error("Local state format is not supported.");
    }
    const state = parsePersistedState(stored.state);
    if (!state) throw new Error("Local state file is invalid.");
    return { ...state, initialized: true };
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return defaultState();
    throw error;
  }
}

export async function saveLocalState(value: PersistedState, directory = getDataDirectory()): Promise<void> {
  const state = parsePersistedState(value);
  if (!state) throw new Error("Refusing to save invalid local state.");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(directory, 0o700);
  const target = statePath(directory);
  const temporary = join(directory, `state-${process.pid}-${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify({ version: STORAGE_VERSION, state }), { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
