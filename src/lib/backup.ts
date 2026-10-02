import type { PersistedState } from "./types";

const BACKUP_FORMAT = "jobpilot-backup";
const BACKUP_VERSION = 1;

type JobpilotBackup = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  state: PersistedState;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createBackup(state: PersistedState, exportedAt = new Date()) {
  const backup: JobpilotBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    state,
  };
  return JSON.stringify(backup, null, 2);
}

export function parseBackup(contents: string): PersistedState | null {
  let value: unknown;
  try {
    value = JSON.parse(contents) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(value) || value.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION || typeof value.exportedAt !== "string" || !Number.isFinite(Date.parse(value.exportedAt))) return null;
  if (!isRecord(value.state) || !isRecord(value.state.profile) || !Array.isArray(value.state.saved) || !isRecord(value.state.status) || !Array.isArray(value.state.liveJobs)) return null;
  return value.state as unknown as PersistedState;
}
