import type { Job } from "./types";

/** Merge refreshed feed rows without dropping valid local scores/details. */
export function mergeJobPool(existing: Job[], incoming: Job[], limit = 2_000): Job[] {
  const byKey = new Map<string, Job>();
  const keyFor = (job: Job) => job.sourceUrl ?? job.id;
  for (const job of existing) byKey.set(keyFor(job), job);
  for (const job of incoming) {
    const key = keyFor(job);
    const previous = byKey.get(key);
    if (!previous) {
      byKey.set(key, job);
      continue;
    }
    const richer = (job.description?.length ?? job.summary.length) > (previous.description?.length ?? previous.summary.length) ? job : previous;
    byKey.set(key, {
      ...previous,
      ...job,
      ...richer,
      // A refresh can omit a field that was available in the earlier copy.
      description: job.description || previous.description,
      summary: (job.summary?.length ?? 0) > (previous.summary?.length ?? 0) ? job.summary : previous.summary,
      screening: job.screening ?? previous.screening,
      aiMatch: job.aiMatch ?? previous.aiMatch,
      detailedAnalysis: job.detailedAnalysis ?? previous.detailedAnalysis,
      sourceAliases: [...new Set([...(previous.sourceAliases ?? [previous.source]), ...(job.sourceAliases ?? [job.source])])],
    });
  }
  return [...byKey.values()].slice(-limit);
}
