import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ApplicationStatus, CandidateProfile, CoverLetterDraftRecord, Job, PersistedState } from "./types";
import { defaultProfile } from "./types";

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
  return { profile: defaultProfile, saved: [], status: {}, applicationNotes: {}, coverLetterDrafts: {}, liveJobs: [], initialized: false };
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
  return {
    name: value.name.trim(),
    roles: value.roles.trim(),
    locations: value.locations.trim(),
    skills: value.skills.trim(),
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
  if (value.description !== undefined && (typeof value.description !== "string" || value.description.length > 8000)) return null;
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
    ...(typeof value.retrievedAt === "string" ? { retrievedAt: value.retrievedAt } : {}),
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
  if (value.liveJobs !== undefined && (!Array.isArray(value.liveJobs) || value.liveJobs.length > MAX_TRACKED_JOBS)) return null;
  const liveJobs = value.liveJobs === undefined ? [] : value.liveJobs.map(parseJob);
  if (liveJobs.some((job) => job === null)) return null;
  return {
    profile,
    saved,
    status: Object.fromEntries(statusEntries) as Record<string, ApplicationStatus>,
    applicationNotes: Object.fromEntries(Object.entries(applicationNotes)) as Record<string, string>,
    coverLetterDrafts: parsedDrafts,
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
