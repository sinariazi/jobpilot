"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ApplicationStatus, CandidateProfile, CoverLetterDraftRecord, Job, MatchReview, PersistedState, MatchingSettings, MatchWeights } from "@/lib/types";
import { defaultProfile } from "@/lib/types";
import { jobsForReview, matchesTargetRole, scoreJob } from "@/lib/matcher";
import { matchesPreferredLocation } from "@/lib/locations";
import { matchesDepartment, matchesPostedWithin, matchesWorkMode, type PostedWithin, type WorkMode } from "@/lib/job-filters";
import type { CvSuggestions } from "@/lib/cv-parser";
import { createBackup, parseBackup } from "@/lib/backup";
import { createCoverLetterDraft } from "@/lib/cover-letter";
import { jobsToAssess } from "@/lib/job-assessment";
import { createMatchCohortKey, MAX_MATCH_REVIEWS, summarizeMatchReviews } from "@/lib/match-calibration";
import { DEFAULT_MATCHING_SETTINGS, shouldRunDetailedAnalysis } from "@/lib/job-screening";

const LEGACY_STORAGE_KEY = "jobpilot-local-v1";
const MAX_BACKUP_BYTES = 23_000_000;
const AI_MATCH_BATCH_SIZE = 2;
const MAX_CV_MATCH_CHARS = 10_000;

function createCvMatchContext(cvText: string, suggestions: CvSuggestions | null) {
  const analysis = suggestions?.analysis;
  const profileEvidence = [
    analysis?.summary,
    analysis?.seniority ? `Seniority: ${analysis.seniority}` : "",
    analysis?.domains.length ? `Domains: ${analysis.domains.join(", ")}` : "",
    suggestions?.roles ? `Roles: ${suggestions.roles}` : "",
    suggestions?.skills ? `Skills: ${suggestions.skills}` : "",
    analysis?.highlights.length ? `Experience evidence: ${analysis.highlights.join("; ")}` : "",
  ].filter(Boolean).join("\n");
  const rawText = cvText.slice(0, MAX_CV_MATCH_CHARS);
  return [profileEvidence && `CV analysis:\n${profileEvidence}`, rawText && `CV text excerpt:\n${rawText}`].filter(Boolean).join("\n\n");
}

function isLocalJobpilotPage() {
  return typeof window !== "undefined" && ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
}

function formatRate(rate: number | null) {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export default function Home() {
  const [profile, setProfile] = useState<CandidateProfile>(defaultProfile);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"match" | "newest" | "company">("match");
  const [minimumScore, setMinimumScore] = useState(0);
  const [postedWithin, setPostedWithin] = useState<PostedWithin>("any");
  const [workMode, setWorkMode] = useState<WorkMode>("any");
  const [department, setDepartment] = useState("");
  const [visibleCount, setVisibleCount] = useState(25);
  const [saved, setSaved] = useState<string[]>([]);
  const [status, setStatus] = useState<Record<string, ApplicationStatus>>({});
  const [applicationNotes, setApplicationNotes] = useState<Record<string, string>>({});
  const [applicationFollowUps, setApplicationFollowUps] = useState<Record<string, string>>({});
  const [coverLetterDrafts, setCoverLetterDrafts] = useState<Record<string, CoverLetterDraftRecord>>({});
  const [matchReviews, setMatchReviews] = useState<MatchReview[]>([]);
  const [matchCohortKey, setMatchCohortKey] = useState("");
  const [matchingSettings, setMatchingSettings] = useState<MatchingSettings>(DEFAULT_MATCHING_SETTINGS);
  const [systemOneAvailable, setSystemOneAvailable] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [activeView, setActiveView] = useState<"overview" | "applications">("overview");
  const [liveJobs, setLiveJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [loadingMoreJobs, setLoadingMoreJobs] = useState(false);
  const [aiMatchProgress, setAiMatchProgress] = useState<{ completed: number; total: number } | null>(null);
  const [nextArbeitnowPage, setNextArbeitnowPage] = useState<number | null>(null);
  const [nextJobicyCursor, setNextJobicyCursor] = useState<string | null>(null);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [storageMessage, setStorageMessage] = useState("Loading saved data from this device…");
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const aiMatchAbortController = useRef<AbortController | null>(null);
  const aiMatchGeneration = useRef(0);
  const backupInput = useRef<HTMLInputElement>(null);
  const [sourceMessage, setSourceMessage] = useState("");
  const [sourceErrors, setSourceErrors] = useState<string[]>([]);
  const [profileDraft, setProfileDraft] = useState<CandidateProfile>(defaultProfile);
  const [cvSuggestions, setCvSuggestions] = useState<CvSuggestions | null>(null);
  const [ocrLanguage, setOcrLanguage] = useState<"eng" | "deu" | "eng+deu">("eng");
  const [cvText, setCvText] = useState("");
  const [cvPreviewUrl, setCvPreviewUrl] = useState("");
  const [cvAnalysisStatus, setCvAnalysisStatus] = useState("");
  const [cvAnalyzing, setCvAnalyzing] = useState(false);
  const [cvAnalyzedModel, setCvAnalyzedModel] = useState("");
  const [cvFileName, setCvFileName] = useState("");
  const [cvParsing, setCvParsing] = useState(false);
  const [cvError, setCvError] = useState("");
  const [cvMessage, setCvMessage] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [coverLetterOpen, setCoverLetterOpen] = useState(false);
  const [coverLetterMessage, setCoverLetterMessage] = useState("");
  const [localAiModels, setLocalAiModels] = useState<string[]>([]);
  const [selectedAiModel, setSelectedAiModel] = useState("");
  const [localAiConnected, setLocalAiConnected] = useState<boolean | null>(null);
  const [localAiRuntimeVersion, setLocalAiRuntimeVersion] = useState("");
  const [localAiModelDetails, setLocalAiModelDetails] = useState<Record<string, { size?: number; digest?: string; details?: { family?: string; parameterSize?: string; quantizationLevel?: string } }>>({});
  const [checkingLocalAi, setCheckingLocalAi] = useState(false);
  const [localAiStatus, setLocalAiStatus] = useState("Checking for Ollama on this laptop…");
  const [aiDrafting, setAiDrafting] = useState(false);
  const candidateSkills = useMemo(() => profile.skills.split(",").map((skill) => skill.trim()).filter(Boolean), [profile.skills]);
  const jobs = useMemo(() => {
    const unique = new Map<string, Job>();
    liveJobs.forEach((job) => unique.set(job.sourceUrl ?? job.id, job));
    return [...unique.values()];
  }, [liveJobs]);

  function selectJob(jobId: string) {
    setSelectedId(jobId);
    setCoverLetterMessage("");
  }

  function invalidateAiAssessment() {
    aiMatchGeneration.current += 1;
    aiMatchAbortController.current?.abort();
    aiMatchAbortController.current = null;
    setAiMatchProgress(null);
  }

  function chooseLocalAiModel(model: string) {
    invalidateAiAssessment();
    setSelectedAiModel(model);
    setCvAnalyzedModel("");
    setLiveJobs((current) => current.map((job) => ({ ...job, aiMatch: undefined, screening: undefined, detailedAnalysis: undefined })));
    setSourceMessage("Local model changed. Search again to reassess your CV against the jobs.");
  }

  function chooseDecisionModel(model: string) {
    invalidateAiAssessment();
    setMatchingSettings((current) => ({ ...current, decisionModel: model }));
    setLiveJobs((current) => current.map((job) => ({ ...job, screening: undefined, aiMatch: undefined, detailedAnalysis: undefined })));
    setCvAnalyzedModel("");
    setSourceMessage("Decision model changed. Search again to rescreen the jobs locally.");
  }

  function updateMatchWeight(key: keyof MatchWeights, value: number) {
    const bounded = Math.max(0, Math.min(100, Math.round(value)));
    const weights = { ...matchingSettings.weights };
    const balanceKey: keyof MatchWeights = key === "disqualifier" ? "skills" : "disqualifier";
    const fixedTotal = Object.entries(weights).reduce((sum, [name, amount]) => name === key || name === balanceKey ? sum : sum + amount, 0);
    const adjusted = Math.min(bounded, Math.max(0, 100 - fixedTotal));
    weights[key] = adjusted;
    weights[balanceKey] = 100 - fixedTotal - adjusted;
    if (JSON.stringify(weights) !== JSON.stringify(matchingSettings.weights)) {
      invalidateAiAssessment();
      setCvAnalyzedModel("");
      setLiveJobs((jobs) => jobs.map((job) => ({ ...job, screening: undefined, aiMatch: undefined, detailedAnalysis: undefined })));
    }
    setMatchingSettings({ ...matchingSettings, weights });
  }

  useEffect(() => {
    let cancelled = false;
    async function restoreState() {
      try {
        const response = await fetch("/api/state", { cache: "no-store" });
        if (!response.ok) throw new Error("Could not load the local state file.");
        let restored = await response.json() as PersistedState & { initialized: boolean };
        let migrated = false;
        if (!restored.initialized) {
          const legacyValue = window.localStorage.getItem(LEGACY_STORAGE_KEY);
          if (legacyValue) {
            const legacy = JSON.parse(legacyValue) as Partial<PersistedState>;
            const migration = await fetch("/api/state", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                profile: legacy.profile ?? defaultProfile,
                saved: legacy.saved ?? [],
                status: legacy.status ?? {},
                applicationNotes: legacy.applicationNotes ?? {},
                applicationFollowUps: legacy.applicationFollowUps ?? {},
                liveJobs: [],
              }),
            });
            if (!migration.ok) throw new Error("Could not move your existing browser data to the local state file.");
            restored = await migration.json() as PersistedState & { initialized: boolean };
            window.localStorage.removeItem(LEGACY_STORAGE_KEY);
            migrated = true;
          }
        }
        if (cancelled) return;
        setProfile(restored.profile);
        setSaved(restored.saved);
        setStatus(restored.status);
        setApplicationNotes(restored.applicationNotes ?? {});
        setApplicationFollowUps(restored.applicationFollowUps ?? {});
        setCoverLetterDrafts(restored.coverLetterDrafts ?? {});
        setMatchReviews(restored.matchReviews ?? []);
        setMatchCohortKey(restored.matchCohortKey ?? "");
        setMatchingSettings((current) => ({ ...(restored.matchingSettings ?? DEFAULT_MATCHING_SETTINGS), decisionModel: restored.matchingSettings?.decisionModel || current.decisionModel }));
        setLiveJobs(restored.liveJobs ?? []);
        selectJob(restored.liveJobs?.[0]?.id ?? "");
        setStorageMessage(migrated ? "Existing browser data moved to a private local file." : "Saved on this device.");
        setStateLoaded(true);
      } catch (error) {
        if (cancelled) return;
        setStorageMessage(error instanceof Error ? error.message : "Could not load local data. Changes are not being saved.");
      }
    }
    void restoreState();
    return () => { cancelled = true; };
  }, []);

  async function refreshLocalAiStatus(showChecking = true) {
    if (showChecking) setCheckingLocalAi(true);
    try {
      const response = await fetch("/api/application/draft", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not check the local AI service.");
      const result = await response.json() as {
        connected?: boolean;
        available?: boolean;
        models?: Array<string | { name: string; size?: number; digest?: string; details?: { family?: string; parameterSize?: string; quantizationLevel?: string } }>;
        preferredModel?: string;
        preferredDecisionModel?: string;
        systemOneAvailable?: boolean;
        runtimeVersion?: string;
        message?: string;
      };
      const names = (result.models ?? []).map((model) => typeof model === "string" ? model : model.name);
      const details = Object.fromEntries((result.models ?? []).filter((model): model is Exclude<typeof model, string> => typeof model !== "string").map((model) => [model.name, { size: model.size, digest: model.digest, details: model.details }]));
      setLocalAiModels(names);
      setLocalAiModelDetails(details);
      setLocalAiConnected(result.connected ?? Boolean(result.available));
      setLocalAiRuntimeVersion(result.runtimeVersion ?? "");
      setSystemOneAvailable(result.systemOneAvailable ?? false);
      setMatchingSettings((current) => ({ ...current, decisionModel: current.decisionModel && names.includes(current.decisionModel) ? current.decisionModel : result.preferredDecisionModel && names.includes(result.preferredDecisionModel) ? result.preferredDecisionModel : "" }));
      setSelectedAiModel((current) => current && names.includes(current) ? current : result.preferredModel && names.includes(result.preferredModel) ? result.preferredModel : names[0] ?? "");
      setLocalAiStatus(result.message ?? (names.length ? "Ollama is connected and a local model is ready." : "Ollama is connected, but no models are installed."));
    } catch (error) {
      setLocalAiModels([]);
      setLocalAiModelDetails({});
      setLocalAiConnected(false);
      setLocalAiRuntimeVersion("");
      setSystemOneAvailable(false);
      setLocalAiStatus(error instanceof Error ? error.message : "Could not check for local Ollama models.");
    } finally {
      if (showChecking) setCheckingLocalAi(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => refreshLocalAiStatus(false));
  }, []);

  useEffect(() => () => {
    if (cvPreviewUrl) URL.revokeObjectURL(cvPreviewUrl);
  }, [cvPreviewUrl]);

  useEffect(() => () => aiMatchAbortController.current?.abort(), []);

  useEffect(() => {
    if (!stateLoaded) return;
    let cancelled = false;
    const snapshot = { profile, saved, status, applicationNotes, applicationFollowUps, coverLetterDrafts, matchReviews, matchCohortKey, matchingSettings, liveJobs } satisfies PersistedState;
    const timeout = window.setTimeout(() => {
      setStorageMessage("Saving on this device…");
      saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
        const response = await fetch("/api/state", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(snapshot),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(result?.error ?? "Could not save local data.");
        }
      }).then(() => {
        if (!cancelled) setStorageMessage("Saved on this device.");
      }).catch((error: unknown) => {
        if (!cancelled) setStorageMessage(error instanceof Error ? error.message : "Could not save local data.");
      });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [profile, saved, status, applicationNotes, applicationFollowUps, coverLetterDrafts, matchReviews, matchCohortKey, matchingSettings, liveJobs, stateLoaded]);

  const locationMatchedJobs = useMemo(() => jobs.filter((job) => matchesPreferredLocation(job.location, profile.locations, job.mode, job.source)), [jobs, profile.locations]);
  const localCvAnalysisReady = Boolean(cvText.trim() && localAiModels.includes(selectedAiModel) && localAiModels.includes(matchingSettings.decisionModel) && systemOneAvailable && isLocalJobpilotPage());
  const hasCurrentCvAssessment = localCvAnalysisReady && cvAnalyzedModel === selectedAiModel;
  const hasStoredScreenings = jobs.some((job) => job.screening?.model === matchingSettings.decisionModel);
  const hasAnyScreenings = hasCurrentCvAssessment || hasStoredScreenings;
  const matchingConfigurationKey = JSON.stringify(matchingSettings);
  const currentModelReviews = useMemo(() => matchReviews.filter((review) => review.model === matchingSettings.decisionModel && review.cohortKey === matchCohortKey && review.configurationKey === matchingConfigurationKey), [matchReviews, matchingSettings.decisionModel, matchingConfigurationKey, matchCohortKey]);
  const currentModelMetrics = useMemo(() => summarizeMatchReviews(currentModelReviews), [currentModelReviews]);
  // With a current CV assessment, keep every location-eligible listing visible.
  // The model's relevance flag is guidance for ranking and labels, not a hidden filter.
  const preferredJobs = useMemo(() => jobsForReview(locationMatchedJobs, hasAnyScreenings, candidateSkills, profile.roles), [locationMatchedJobs, hasAnyScreenings, candidateSkills, profile.roles]);
  const ranked = useMemo(() => preferredJobs.map((job) => {
    const keywordMatch = scoreJob(job, candidateSkills);
    const screening = job.screening?.model === matchingSettings.decisionModel ? job.screening : undefined;
    return { job, ...keywordMatch, score: screening?.score ?? keywordMatch.score, confidence: screening?.confidence ?? null, roleMatch: matchesTargetRole(job, profile.roles) };
  })
    .filter(({ job }) => `${job.role} ${job.company} ${job.location} ${job.department ?? ""}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "newest") return (Date.parse(b.job.postedAt ?? "") || 0) - (Date.parse(a.job.postedAt ?? "") || 0) || b.score - a.score;
      if (sortBy === "company") return a.job.company.localeCompare(b.job.company) || a.job.role.localeCompare(b.job.role);
      return hasAnyScreenings && a.job.screening && b.job.screening
        ? b.score - a.score
        : Number(b.roleMatch) - Number(a.roleMatch) || b.titleMatched.length - a.titleMatched.length || b.score - a.score;
    }), [query, candidateSkills, preferredJobs, profile.roles, hasAnyScreenings, matchingSettings.decisionModel, sortBy]);
  const filteredRanked = useMemo(() => ranked.filter(({ job, score }) => score >= minimumScore && matchesPostedWithin(job, postedWithin) && matchesWorkMode(job, workMode) && matchesDepartment(job, department)), [ranked, minimumScore, postedWithin, workMode, department]);
  const visibleJobs = filteredRanked.slice(0, visibleCount);
  const departments = useMemo(() => [...new Set(preferredJobs.map((job) => job.department?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b)), [preferredJobs]);
  const selected = filteredRanked.find(({ job }) => job.id === selectedId) ?? filteredRanked[0];
  const selectedMatchReview = selected?.job.screening && selected.job.screening.model === matchingSettings.decisionModel
    ? currentModelReviews.find((review) => review.jobId === selected.job.id)
    : undefined;
  const selectedCoverLetter = selected ? coverLetterDrafts[selected.job.id] : undefined;
  const matchedJobs = preferredJobs.filter((job) => scoreJob(job, candidateSkills).matched.length > 0).length;
  const reviewedCount = preferredJobs.filter((job) => status[job.id]).length;
  const applicationJobs = jobs.filter((job) => saved.includes(job.id) || status[job.id]);
  const todayKey = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  })();
  const followUpJobs = applicationJobs.filter((job) => Boolean(applicationFollowUps[job.id]));
  const overdueFollowUps = followUpJobs.filter((job) => applicationFollowUps[job.id] < todayKey).length;
  const applicationGroups: Array<{ title: string; items: Job[] }> = [
    { title: "Needs review", items: applicationJobs.filter((job) => !status[job.id] || status[job.id] === "Needs review") },
    { title: "Approved to prepare", items: applicationJobs.filter((job) => status[job.id] === "Approved to prepare") },
    { title: "Applied", items: applicationJobs.filter((job) => status[job.id] === "Applied") },
    { title: "Rejected", items: applicationJobs.filter((job) => status[job.id] === "Rejected") },
  ];

  function followUpLabel(date: string) {
    if (date < todayKey) return "Overdue";
    if (date === todayKey) return "Due today";
    return `Due ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${date}T00:00:00`))}`;
  }

  function updateFollowUp(jobId: string, date: string) {
    setApplicationFollowUps((current) => {
      const next = { ...current };
      if (date) next[jobId] = date;
      else delete next[jobId];
      return next;
    });
  }

  function reviewSelectedMatch(reviewedRelevant: boolean) {
    if (!selected || !matchCohortKey || !hasCurrentCvAssessment || selected.job.screening?.model !== matchingSettings.decisionModel) return;
    const review: MatchReview = {
      jobId: selected.job.id,
      company: selected.job.company,
      role: selected.job.role,
      model: selected.job.screening.model,
      configurationKey: matchingConfigurationKey,
      cohortKey: matchCohortKey,
      score: selected.job.screening.score,
      predictedRelevant: selected.job.screening.score >= matchingSettings.detailedScoreThreshold,
      reviewedRelevant,
      reviewedAt: new Date().toISOString(),
    };
    setMatchReviews((current) => [
      ...current.filter((item) => !(item.jobId === review.jobId && item.model === review.model && item.cohortKey === review.cohortKey)),
      review,
    ].slice(-MAX_MATCH_REVIEWS));
  }

  function clearMatchReviews() {
    if (window.confirm("Clear all locally stored AI match reviews and screening metrics?")) setMatchReviews([]);
  }

  async function assessJobsLocally(candidates: Job[], signal: AbortSignal) {
    const screeningById = new Map<string, NonNullable<Job["screening"]>>();
    const detailedById = new Map<string, NonNullable<Job["aiMatch"]>>();
    const analysisById = new Map<string, NonNullable<Job["detailedAnalysis"]>>();
    const cvForModel = createCvMatchContext(cvText, cvSuggestions);
    let error = "";
    let cancelled = false;
    let completed = 0;
    const detailedCandidates: Job[] = [];
    setAiMatchProgress({ completed: 0, total: candidates.length });
    for (let offset = 0; offset < candidates.length; offset += AI_MATCH_BATCH_SIZE) {
      if (signal.aborted) { cancelled = true; break; }
      const batch = candidates.slice(offset, offset + AI_MATCH_BATCH_SIZE);
      setSourceMessage(`Local decision model screening ${Math.min(offset + batch.length, candidates.length)} of ${candidates.length} jobs…`);
      try {
        const screened = await Promise.all(batch.map(async (job) => {
          const response = await fetch("/api/jobs/screen", {
            method: "POST", headers: { "Content-Type": "application/json" }, signal,
            body: JSON.stringify({ model: matchingSettings.decisionModel, cvText: cvForModel.slice(0, 15_000), weights: matchingSettings.weights, preferences: { locations: profile.locations }, job: { company: job.company, role: job.role, location: job.location, mode: job.mode, description: (job.description ?? job.summary).slice(0, 12_000) } }),
          });
          const result = await response.json() as { screening?: NonNullable<Job["screening"]>; error?: string };
          if (!response.ok || !result.screening) throw new Error(result.error ?? "Local decision screening failed.");
          return { job, screening: result.screening };
        }));
        for (const { job, screening } of screened) {
          screeningById.set(job.id, screening);
          if (shouldRunDetailedAnalysis(screening, matchingSettings)) detailedCandidates.push(job);
        }
        completed += screened.length;
        setAiMatchProgress({ completed, total: candidates.length + detailedCandidates.length });
        setLiveJobs((current) => current.map((item) => screeningById.has(item.id) ? { ...item, screening: screeningById.get(item.id), aiMatch: undefined, detailedAnalysis: undefined } : item));
      } catch (cause) {
        if (signal.aborted) cancelled = true;
        else error = cause instanceof Error ? cause.message : "Local screening failed.";
        break;
      }
    }
    if (!cancelled && !error && detailedCandidates.length) {
      const total = candidates.length + detailedCandidates.length;
      for (let offset = 0; offset < detailedCandidates.length; offset += AI_MATCH_BATCH_SIZE) {
        if (signal.aborted) { cancelled = true; break; }
        const batch = detailedCandidates.slice(offset, offset + AI_MATCH_BATCH_SIZE);
        setSourceMessage(`Detailed local analysis for ${Math.min(offset + batch.length, detailedCandidates.length)} of ${detailedCandidates.length} shortlisted or uncertain jobs…`);
        try {
          const response = await fetch("/api/jobs/match", {
            method: "POST", headers: { "Content-Type": "application/json" }, signal,
            body: JSON.stringify({ model: selectedAiModel, cvText: cvText.slice(0, MAX_CV_MATCH_CHARS), jobs: batch.map((job) => ({ id: job.id, company: job.company, role: job.role, location: job.location, mode: job.mode, description: (job.description ?? job.summary).slice(0, 2_500) })) }),
          });
          const result = await response.json() as { matches?: Array<{ id: string; relevant: boolean; score: number; reason: string; cvEvidence: string; detailedAnalysis: NonNullable<Job["detailedAnalysis"]> }>; error?: string };
          if (!response.ok) throw new Error(result.error ?? "Detailed local analysis failed.");
          for (const match of result.matches ?? []) {
            if (!batch.some((job) => job.id === match.id)) continue;
            detailedById.set(match.id, { model: selectedAiModel, relevant: match.relevant, score: Math.max(0, Math.min(100, Math.round(match.score))), reason: match.reason, cvEvidence: match.cvEvidence });
            analysisById.set(match.id, match.detailedAnalysis);
          }
          completed += batch.length;
          setAiMatchProgress({ completed, total });
          setLiveJobs((current) => current.map((job) => detailedById.has(job.id) ? { ...job, aiMatch: detailedById.get(job.id), detailedAnalysis: analysisById.get(job.id) } : job));
        } catch (cause) {
          if (signal.aborted) cancelled = true;
          else error = cause instanceof Error ? cause.message : "Detailed local analysis failed.";
          break;
        }
      }
    }
    return { screeningById, detailedById, analysisById, error, cancelled, completed, total: candidates.length + detailedCandidates.length, detailedCount: detailedCandidates.length };
  }
  const emptyJobMessage = locationMatchedJobs.length === 0
    ? profile.locations.trim() ? `No fetched jobs match ${profile.locations}. Check your preferred locations or refresh the feeds.` : "No jobs are available in the current feeds. Try searching again later."
    : hasCurrentCvAssessment
      ? "The local model did not identify a strong CV match in the analyzed listings. Review your preferred locations or try again after more jobs are available."
      : "No jobs match your saved target roles or CV skills. Review those fields in your profile, then search again.";

  function openProfile() {
    setProfileDraft(profile);
    setProfileOpen(true);
  }

  function saveProfileDraft() {
    const nextProfile = { ...profileDraft, name: profileDraft.name.trim() || "Candidate" };
    if (nextProfile.locations !== profile.locations) {
      invalidateAiAssessment();
      setCvAnalyzedModel("");
      setLiveJobs((current) => current.map((job) => ({ ...job, screening: undefined, aiMatch: undefined, detailedAnalysis: undefined })));
      setSourceMessage("Location preferences changed. Search again to rescreen jobs against the new preferences.");
    }
    setProfile(nextProfile);
    setProfileOpen(false);
  }

  async function parseSelectedCv(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    invalidateAiAssessment();
    setCvAnalyzedModel("");
        setLiveJobs((current) => current.map((job) => ({ ...job, aiMatch: undefined, screening: undefined, detailedAnalysis: undefined })));
    if (cvPreviewUrl) URL.revokeObjectURL(cvPreviewUrl);
    setCvPreviewUrl(file.name.toLocaleLowerCase().endsWith(".pdf") ? URL.createObjectURL(file) : "");
    setCvParsing(true);
    setCvAnalyzing(false);
    setCvError("");
    setCvMessage("");
    setCvAnalysisStatus("");
    try {
      const { parseCvFile } = await import("@/lib/cv-parser");
      const suggestions = await parseCvFile(file, { ocrLanguage, onProgress: setCvAnalysisStatus });
      const cohortKey = await createMatchCohortKey(suggestions.sourceText ?? "");
      const browserRoles = suggestions.roles || profile.roles;
      const browserSkills = suggestions.skills || profile.skills;
      const autoFilledProfile = { ...profile, roles: browserRoles, skills: browserSkills };
      setCvSuggestions(suggestions);
      setCvText(suggestions.sourceText ?? "");
      setMatchCohortKey(cohortKey);
      setCvAnalyzedModel("");
      setLiveJobs((current) => current.map((job) => ({ ...job, aiMatch: undefined, screening: undefined, detailedAnalysis: undefined })));
      setCvFileName(file.name);
      setProfile(autoFilledProfile);
      setProfileDraft(autoFilledProfile);
      setCvMessage(`CV text extracted in your browser. Job titles and skills have been filled into your profile; Jobpilot saves them automatically on this device. Your name and preferred locations were left unchanged.${(suggestions.sourceText?.length ?? 0) > MAX_CV_MATCH_CHARS ? ` Matching uses the first ${MAX_CV_MATCH_CHARS.toLocaleString()} characters.` : ""}`);

      if (!localAiModels.includes(selectedAiModel)) {
        setCvAnalysisStatus("Text-based role and skill extraction is ready. Select an installed Ollama model and upload the CV again for a deeper local analysis.");
        return;
      }
      if (!isLocalJobpilotPage()) {
        setCvAnalysisStatus("AI analysis is disabled here for privacy. Open Jobpilot at localhost on this laptop. The CV was not sent for AI analysis.");
        return;
      }

      setCvAnalyzing(true);
      setCvAnalysisStatus(`Analyzing your CV with local model ${selectedAiModel}…`);
      try {
        const response = await fetch("/api/cv/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ model: selectedAiModel, cvText: (suggestions.sourceText ?? "").slice(0, MAX_CV_MATCH_CHARS) }),
        });
        const result = await response.json() as { summary?: string; roles?: string[]; skills?: string[]; seniority?: string; domains?: string[]; highlights?: string[]; error?: string };
        if (!response.ok || !result.summary || !Array.isArray(result.roles) || !Array.isArray(result.skills)) {
          throw new Error(result.error ?? "The local model returned incomplete CV analysis.");
        }
        const analyzedRoles = result.roles.join("; ") || browserRoles;
        const analyzedSkills = result.skills.join(", ") || browserSkills;
        const analysis = {
          summary: result.summary,
          seniority: result.seniority ?? "Not identified",
          domains: result.domains ?? [],
          highlights: result.highlights ?? [],
        };
        setCvSuggestions({ ...suggestions, roles: analyzedRoles, skills: analyzedSkills, analysis });
        setProfile((current) => ({ ...current,
          roles: current.roles === browserRoles ? analyzedRoles : current.roles,
          skills: current.skills === browserSkills ? analyzedSkills : current.skills,
        }));
        setProfileDraft((current) => ({ ...current,
          roles: current.roles === browserRoles ? analyzedRoles : current.roles,
          skills: current.skills === browserSkills ? analyzedSkills : current.skills,
        }));
        setCvAnalysisStatus(`CV analyzed locally with ${selectedAiModel}. Target roles and skills were updated automatically; review or edit them below. Your name and location were not inferred from the CV.`);
      } catch (error) {
        setCvAnalysisStatus(`Local AI analysis could not finish: ${error instanceof Error ? error.message : "unknown error"} Text-extracted role and skill fields are already filled. You can still search or try another model.`);
      } finally {
        setCvAnalyzing(false);
      }
    } catch (error) {
      setCvSuggestions(null);
      setCvText("");
      setCvAnalyzedModel("");
      setCvFileName("");
      setCvError(error instanceof Error ? error.message : "Could not read this CV.");
    } finally {
      setCvParsing(false);
    }
  }

  function downloadBackup() {
    const backup = createBackup({ profile, saved, status, applicationNotes, applicationFollowUps, coverLetterDrafts, matchReviews, matchCohortKey, matchingSettings, liveJobs });
    const url = URL.createObjectURL(new Blob([backup], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `jobpilot-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setBackupMessage("Backup downloaded. Store the file somewhere safe; it contains your local profile and job tracking data.");
  }

  function buildCoverLetter() {
    if (!selected) return;
    setCoverLetterDrafts((current) => {
      const prior = current[selected.job.id] ?? { interest: "", evidence: "", draft: "", updatedAt: "" };
      return { ...current, [selected.job.id]: {
        ...prior,
        draft: createCoverLetterDraft({ candidateName: profile.name, role: selected.job.role, company: selected.job.company, matchedSkills: selected.matched, reason: prior.interest, evidence: prior.evidence }),
        updatedAt: new Date().toISOString(),
      } };
    });
    setCoverLetterMessage("Draft created. Review every statement and replace any placeholders before use.");
  }

  async function generateAiCoverLetter() {
    if (!selected || !localAiModels.includes(selectedAiModel) || aiDrafting) return;
    setAiDrafting(true);
    setCoverLetterMessage("Drafting with the configured AI provider…");
    try {
      const response = await fetch("/api/application/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedAiModel,
          job: {
            company: selected.job.company,
            role: selected.job.role,
            location: selected.job.location,
            description: selected.job.description ?? selected.job.summary,
          },
          candidate: { name: profile.name, skills: profile.skills },
          interest: selectedCoverLetter?.interest ?? "",
          evidence: selectedCoverLetter?.evidence ?? "",
        }),
      });
      const result = await response.json() as { draft?: string; error?: string };
      if (!response.ok || !result.draft) throw new Error(result.error ?? "The AI provider returned no draft.");
      updateSelectedCoverLetter({ draft: result.draft });
      setCoverLetterMessage("AI draft created and saved locally. Verify every claim before use.");
    } catch (error) {
      setCoverLetterMessage(error instanceof Error ? error.message : "Could not create the AI draft.");
    } finally {
      setAiDrafting(false);
    }
  }

  function updateSelectedCoverLetter(patch: Partial<CoverLetterDraftRecord>) {
    if (!selected) return;
    setCoverLetterDrafts((current) => ({
      ...current,
      [selected.job.id]: {
        ...(current[selected.job.id] ?? { interest: "", evidence: "", draft: "", updatedAt: "" }),
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    }));
  }

  async function copyCoverLetter() {
    try {
      await navigator.clipboard.writeText(coverLetterDrafts[selected?.job.id ?? ""]?.draft ?? "");
      setCoverLetterMessage("Draft copied to clipboard.");
    } catch {
      setCoverLetterMessage("Clipboard access is unavailable. Select and copy the draft text manually.");
    }
  }

  function downloadCoverLetter() {
    const draft = coverLetterDrafts[selected?.job.id ?? ""]?.draft;
    if (!selected || !draft) return;
    const safeName = `${selected.job.company}-${selected.job.role}`.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "application";
    const url = URL.createObjectURL(new Blob([draft], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `cover-letter-${safeName}.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setCoverLetterMessage("Draft downloaded as a text file.");
  }

  async function restoreBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      setBackupMessage("This backup is too large to restore (maximum 23 MB).");
      return;
    }
    let restoredState: PersistedState | null;
    try {
      restoredState = parseBackup(await file.text());
    } catch {
      setBackupMessage("Could not read the selected backup file.");
      return;
    }
    if (!restoredState) {
      setBackupMessage("This file is not a valid Jobpilot backup or uses an unsupported backup version.");
      return;
    }
    if (!window.confirm("Restore this backup? It will replace the profile, saved jobs, application statuses, fetched listings, and local AI match reviews on this device.")) {
      setBackupMessage("Restore cancelled. Your current data was not changed.");
      return;
    }
    setBackupBusy(true);
    setBackupMessage("Validating and restoring backup…");
    const operation = saveQueue.current.catch(() => undefined).then(async () => {
      const response = await fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(restoredState),
      });
      const result = await response.json() as PersistedState & { initialized?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error ?? "The backup data did not pass validation.");
      setProfile(result.profile);
      setSaved(result.saved);
      setStatus(result.status);
      setApplicationNotes(result.applicationNotes ?? {});
      setApplicationFollowUps(result.applicationFollowUps ?? {});
      setCoverLetterDrafts(result.coverLetterDrafts ?? {});
      setMatchReviews(result.matchReviews ?? []);
      setMatchCohortKey(result.matchCohortKey ?? "");
      setMatchingSettings(result.matchingSettings ?? DEFAULT_MATCHING_SETTINGS);
      setLiveJobs(result.liveJobs);
      selectJob(result.liveJobs[0]?.id ?? "");
      setStorageMessage("Backup restored and saved on this device.");
    });
    saveQueue.current = operation.then(() => undefined, () => undefined);
    try {
      await operation;
      setBackupMessage("Backup restored successfully.");
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : "Could not restore this backup.");
    } finally {
      setBackupBusy(false);
    }
  }

  async function fetchLiveJobs() {
    if (loadingJobs || loadingMoreJobs) return;
    const searchGeneration = aiMatchGeneration.current;
    setLoadingJobs(true);
    setCvAnalyzedModel("");
    setSourceMessage("");
    setSourceErrors([]);
    let fetchedJobs: Job[] = [];
    try {
      const response = await fetch("/api/jobs/search", { cache: "no-store" });
      const result = await response.json() as { jobs?: Job[]; errors?: string[]; error?: string; nextArbeitnowPage?: number | null; nextJobicyCursor?: string | null };
      if (!response.ok) throw new Error(result.error ?? "Could not fetch jobs.");
      setSourceErrors(result.errors ?? []);
      setNextArbeitnowPage(result.nextArbeitnowPage ?? null);
      setNextJobicyCursor(result.nextJobicyCursor ?? null);
      fetchedJobs = result.jobs ?? [];
      const locationJobs = fetchedJobs.filter((job) => matchesPreferredLocation(job.location, profile.locations, job.mode, job.source));
      const assessWithCurrentContext = localCvAnalysisReady && searchGeneration === aiMatchGeneration.current;
      let analyzedJobs = fetchedJobs;
      let completed = 0;
      let cancelled = false;
      let matchingWarning = "";
      let detailedCount = 0;
      if (assessWithCurrentContext) {
        const candidates = jobsToAssess(locationJobs);
        const generation = ++aiMatchGeneration.current;
        const controller = new AbortController();
        aiMatchAbortController.current = controller;
        const outcome = await assessJobsLocally(candidates, controller.signal);
        if (generation !== aiMatchGeneration.current) return;
        completed = outcome.completed;
        cancelled = outcome.cancelled;
        matchingWarning = outcome.error;
        detailedCount = outcome.detailedCount;
        aiMatchAbortController.current = null;
        analyzedJobs = fetchedJobs.map((job) => ({
          ...job,
          ...(outcome.screeningById.has(job.id) ? { screening: outcome.screeningById.get(job.id) } : { screening: undefined }),
          ...(outcome.detailedById.has(job.id) ? { aiMatch: outcome.detailedById.get(job.id), detailedAnalysis: outcome.analysisById.get(job.id) } : { aiMatch: undefined, detailedAnalysis: undefined }),
        }));
        setCvAnalyzedModel(selectedAiModel);
      }
      setLiveJobs(analyzedJobs);
      const locationCount = locationJobs.length;
      setSourceMessage(result.jobs?.length
        ? assessWithCurrentContext
          ? `Local decision screening assessed ${completed} of ${locationCount} location-eligible jobs; ${detailedCount} received detailed analysis. ${cancelled ? "Assessment cancelled; fetched listings remain available." : matchingWarning ? `Some jobs remain unassessed: ${matchingWarning}` : ""} Scores are estimates, not hiring probabilities. Review the evidence and original postings.`
          : cvText.trim() && !isLocalJobpilotPage()
            ? "CV analysis is blocked here for privacy. Open Jobpilot from localhost on this laptop; no CV text was sent. Showing profile matches."
            : cvText.trim()
              ? `Found ${result.jobs.length} listings, but local decision screening is unavailable. Start/update Ollama to 0.35 or newer, choose an installed decision model, and try again. ${localAiStatus}`
              : `Searched public job feeds and found ${result.jobs.length} listings; ${locationCount} match your location. Import your CV and select local models for the two-stage match.`
        : "No listings came back from the public job feeds. Try again later.");
      selectJob(locationJobs[0]?.id ?? "");
    } catch (error) {
      if (fetchedJobs.length) {
        const fallback = fetchedJobs.filter((job) => matchesPreferredLocation(job.location, profile.locations, job.mode, job.source));
        setLiveJobs(fetchedJobs.map((job) => ({ ...job, screening: undefined, aiMatch: undefined, detailedAnalysis: undefined })));
        selectJob(fallback[0]?.id ?? "");
        setSourceMessage(`Local job screening failed: ${error instanceof Error ? error.message : "unknown error"}. Jobs are still available to review; no hosted model fallback was used.`);
      } else setSourceMessage(error instanceof Error ? error.message : "Could not fetch job listings.");
    } finally {
      aiMatchAbortController.current = null;
      setAiMatchProgress(null);
      setLoadingJobs(false);
    }
  }

  async function fetchMoreJobs() {
    if ((nextArbeitnowPage === null && nextJobicyCursor === null) || loadingMoreJobs || loadingJobs) return;
    const searchGeneration = aiMatchGeneration.current;
    setLoadingMoreJobs(true);
    setSourceMessage("");
    let fetchedMore: Job[] = [];
    try {
      const params = new URLSearchParams();
      if (nextArbeitnowPage !== null) params.set("arbeitnowStartPage", String(nextArbeitnowPage));
      if (nextJobicyCursor !== null) params.set("jobicyCursor", nextJobicyCursor);
      const response = await fetch(`/api/jobs/search?${params}`, { cache: "no-store" });
      const result = await response.json() as { jobs?: Job[]; errors?: string[]; error?: string; nextArbeitnowPage?: number | null; nextJobicyCursor?: string | null };
      if (!response.ok) throw new Error(result.error ?? "Could not load more jobs.");
      fetchedMore = result.jobs ?? [];
      setNextArbeitnowPage(result.nextArbeitnowPage ?? null);
      setNextJobicyCursor(result.nextJobicyCursor ?? null);
      setSourceErrors((current) => [...current.filter((error) => !result.errors?.includes(error)), ...(result.errors ?? [])]);
      setLiveJobs((current) => {
        const seen = new Set(current.map((job) => job.sourceUrl ?? job.id));
        return [...current, ...fetchedMore.filter((job) => !seen.has(job.sourceUrl ?? job.id))];
      });
      const assessWithCurrentContext = localCvAnalysisReady && searchGeneration === aiMatchGeneration.current;
      if (!assessWithCurrentContext || !fetchedMore.length) {
        const moreSources = [result.nextArbeitnowPage !== null && result.nextArbeitnowPage !== undefined ? "Arbeitnow" : "", result.nextJobicyCursor ? "Jobicy" : ""].filter(Boolean);
        setSourceMessage(`Loaded ${fetchedMore.length} more listings. ${moreSources.length ? `More pages are available from ${moreSources.join(" and ")}.` : "No further pages are available."} ${assessWithCurrentContext ? "" : "Local two-stage CV matching is unavailable; listings remain visible."}`);
        return;
      }
      const previouslyScreened = liveJobs.filter((job) => job.screening?.model === matchingSettings.decisionModel).map((job) => job.sourceUrl ?? job.id);
      const candidates = jobsToAssess(fetchedMore.filter((job) => matchesPreferredLocation(job.location, profile.locations, job.mode, job.source)), previouslyScreened);
      const generation = ++aiMatchGeneration.current;
      const controller = new AbortController();
      aiMatchAbortController.current = controller;
      const outcome = await assessJobsLocally(candidates, controller.signal);
      if (generation !== aiMatchGeneration.current) return;
      const analyzed = fetchedMore.map((job) => ({ ...job,
        ...(outcome.screeningById.has(job.id) ? { screening: outcome.screeningById.get(job.id) } : {}),
        ...(outcome.detailedById.has(job.id) ? { aiMatch: outcome.detailedById.get(job.id), detailedAnalysis: outcome.analysisById.get(job.id) } : {}),
      }));
      setLiveJobs((current) => current.map((job) => analyzed.find((item) => item.id === job.id) ?? job));
      setCvAnalyzedModel(selectedAiModel);
      const moreSources = [result.nextArbeitnowPage !== null && result.nextArbeitnowPage !== undefined ? "Arbeitnow" : "", result.nextJobicyCursor ? "Jobicy" : ""].filter(Boolean);
      setSourceMessage(`Loaded ${fetchedMore.length} more listings. Screened ${outcome.completed} of ${candidates.length}; detailed analysis ran for ${outcome.detailedCount}. ${outcome.error || (outcome.cancelled ? "Assessment cancelled." : "Scores are estimates, not hiring probabilities.")} ${moreSources.length ? `More pages are available from ${moreSources.join(" and ")}.` : "No further pages are available."}`);
    } catch (error) {
      if (fetchedMore.length) setSourceMessage(`Loaded ${fetchedMore.length} more listings, but local screening failed: ${error instanceof Error ? error.message : "unknown error"}.`);
      else setSourceMessage(error instanceof Error ? error.message : "Could not load more jobs.");
    } finally {
      aiMatchAbortController.current = null;
      setAiMatchProgress(null);
      setLoadingMoreJobs(false);
    }
  }

  function cancelAiAssessment() {
    aiMatchAbortController.current?.abort();
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">J</span><span>jobpilot<span className="brand-dot">.</span></span></div>
        <div className="sidebar-label">WORKSPACE</div>
        <button className={`nav-item ${activeView === "overview" ? "active" : ""}`} onClick={() => setActiveView("overview")}><span>▦</span> Overview</button>
        <button className="nav-item" onClick={() => setActiveView("overview")}><span>⌕</span> Job matches <b className="nav-count">{ranked.length}</b></button>
        <button className={`nav-item ${activeView === "applications" ? "active" : ""}`} onClick={() => setActiveView("applications")}><span>▤</span> Applications <b className="nav-count">{applicationJobs.length}</b></button>
        <button className="nav-item" onClick={openProfile}><span>♧</span> Candidate profile</button>
        <div className="sidebar-bottom">
          <div className="local-status"><i /> Local workspace <span>●</span></div>
          <button className="profile-chip profile-chip-button" onClick={openProfile}><div className="avatar">{profile.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</div><div><strong>{profile.name}</strong><small>Private to this device</small></div><span className="more">···</span></button>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> {activeView === "applications" ? "Applications" : "Overview"}</div><div className="topbar-right"><span className="privacy-pill"><i /> LOCAL ONLY</span><button className="icon-button" aria-label="Edit candidate profile" onClick={openProfile}>⚙</button><div className="avatar small">{profile.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</div></div></header>
        <div className="content">
          {activeView === "applications" ? (
            <>
              <div className="greeting-row"><div><div className="eyebrow">YOUR JOB SEARCH</div><h1>Applications <span>tracker.</span></h1><p className="subheading">Track saved roles and move each one through your review process.</p></div><button className="primary-button" onClick={() => setActiveView("overview")}>＋ Find jobs</button></div>
              <div className="application-summary"><strong>{applicationJobs.length}</strong><span>roles in your tracker</span><span className="summary-divider"/><span>{applicationGroups.find((group) => group.title === "Applied")?.items.length ?? 0} applied</span><span>{saved.length} saved</span><span>{followUpJobs.length} follow-ups</span>{overdueFollowUps > 0 && <span className="follow-up-overdue-count">{overdueFollowUps} overdue</span>}</div>
              <div className="application-board">{applicationGroups.map((group) => <section className="application-column" key={group.title}><div className="application-column-heading"><h2>{group.title}</h2><span>{group.items.length}</span></div>{group.items.length ? group.items.map((job) => <article className="application-card" key={job.id}><div className="application-company"><div className={`company-logo logo-${job.source.toLowerCase()}`}>{job.company.slice(0, 1)}</div><div><strong>{job.company}</strong><span>{job.location}</span></div></div><h3>{job.role}</h3><div className="follow-up-row"><label>Follow-up date<input type="date" aria-label={`Set follow-up date for ${job.company} — ${job.role}`} value={applicationFollowUps[job.id] ?? ""} onChange={(event) => updateFollowUp(job.id, event.target.value)}/></label>{applicationFollowUps[job.id] && <span className={`follow-up-badge ${applicationFollowUps[job.id] < todayKey ? "overdue" : applicationFollowUps[job.id] === todayKey ? "today" : "upcoming"}`}>{followUpLabel(applicationFollowUps[job.id])}</span>}</div><details className="application-notes"><summary>{applicationNotes[job.id]?.trim() ? "Edit notes" : "Add a note"}</summary><label><span className="visually-hidden">Notes for {job.role} at {job.company}</span><textarea maxLength={2000} rows={3} value={applicationNotes[job.id] ?? ""} onChange={(event) => setApplicationNotes((current) => ({ ...current, [job.id]: event.target.value }))} placeholder="Interview details, next steps, or why you saved this role…"/></label></details><div className="application-card-footer"><span>{job.source}</span><select aria-label={`Update ${job.company} application status`} value={status[job.id] ?? "Needs review"} onChange={(event) => setStatus((current) => ({ ...current, [job.id]: event.target.value as ApplicationStatus }))}><option>Needs review</option><option>Approved to prepare</option><option>Applied</option><option>Rejected</option></select></div></article>) : <p className="application-empty">No roles here yet.</p>}</section>)}</div>
              <p className="application-footnote">Status changes, notes, and follow-up dates are saved on this device. Follow-up dates appear here as reminders; no notification is sent. “Applied” is a manual record; Jobpilot never submits applications.</p>
            </>
          ) : <>
          <div className="greeting-row"><div><div className="eyebrow">{new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase()}</div><h1>Your next opportunity <span>starts here.</span></h1><p className="subheading">A focused view of live roles that match your preferences.</p></div><button className="primary-button" onClick={fetchLiveJobs} disabled={loadingJobs || loadingMoreJobs}><span>＋</span> {loadingJobs ? "Searching feeds…" : "Search jobs"}</button></div>

          <section className="source-panel search-panel">
            <div>
              <span className="eyebrow">AUTOMATIC JOB SEARCH</span>
              <strong>Search across public job feeds</strong>
              <p>Jobpilot searches public feeds automatically. Import your CV and select a local Ollama model to analyze role fit on this laptop. No company names or board links are needed.</p>
            </div>
            <div className="source-controls">
              <button className="primary-button" disabled={loadingJobs || loadingMoreJobs} onClick={fetchLiveJobs}>{loadingJobs ? "Searching job feeds…" : loadingMoreJobs ? "Loading more jobs…" : liveJobs.length ? "↻ Search for new jobs" : "Search jobs now"}</button>
              <span className="feed-summary">Europe listings plus remote roles · Profile stays on this device</span>
            </div>
            <p className="directory-credit">Sources: <a href="https://www.arbeitnow.com/" target="_blank" rel="noreferrer">Arbeitnow</a>, <a href="https://remotive.com/remote-jobs/api" target="_blank" rel="noreferrer">Remotive</a>, and <a href="https://jobicy.com/jobs-rss-feed" target="_blank" rel="noreferrer">Jobicy</a>. Feed coverage varies; it does not include every employer.</p>
            {sourceMessage && <p className="source-message" role="status">{sourceMessage}</p>}
            {aiMatchProgress && aiMatchProgress.total > 0 && <div className="ai-assessment-progress" role="status" aria-live="polite">
              <div><span>Screening and analyzing locally: {aiMatchProgress.completed} of {aiMatchProgress.total}</span><button type="button" className="secondary-button" onClick={cancelAiAssessment}>Cancel assessment</button></div>
              <progress aria-label="CV matching progress" max={aiMatchProgress.total} value={aiMatchProgress.completed} />
            </div>}
            {cvText && <p className="source-message" role="status">CV ready for local matching · {localAiModels.includes(selectedAiModel) ? `Model: ${selectedAiModel}` : "Start Ollama and select a model to enable AI analysis"}{!isLocalJobpilotPage() && " · open Jobpilot at localhost to keep CV processing on this laptop"}</p>}
            {sourceErrors.length > 0 && <ul className="source-errors" role="status">{sourceErrors.map((error) => <li key={error}>{error}</li>)}</ul>}
            <p className="source-message" role="status">{storageMessage}</p>
          </section>

          <section className={`local-ai-panel ${localAiConnected === null ? "ai-checking" : localAiConnected ? "ai-connected" : "ai-disconnected"}`} aria-labelledby="local-ai-title" aria-live="polite">
            <div className="local-ai-heading"><div><span className="eyebrow">ON-DEVICE AI</span><h2 id="local-ai-title">Local AI status</h2><p>Ollama runs the model on this laptop. Profile and job text stay with the local app.</p></div><button type="button" className="secondary-button" onClick={() => void refreshLocalAiStatus()} disabled={checkingLocalAi}>{checkingLocalAi ? "Checking…" : "↻ Refresh status"}</button></div>
            <div className="local-ai-facts">
              <div><span>Connection</span><strong className="ai-connection"><i />{localAiConnected === null ? "Checking" : localAiConnected ? systemOneAvailable ? "Connected · decision API ready" : "Connected · decision API unavailable" : "Not connected"}</strong></div>
              <div><span>Ollama version</span><strong>{localAiRuntimeVersion ? `v${localAiRuntimeVersion}` : localAiConnected ? "Version unavailable" : "—"}</strong></div>
              <div><span>Detailed analysis and drafting model</span><select className="ai-model-picker" aria-label="Select local Ollama chat model" value={selectedAiModel} onChange={(event) => chooseLocalAiModel(event.target.value)} disabled={!localAiModels.length || aiDrafting || checkingLocalAi}><option value="">Choose an installed model</option>{localAiModels.map((model) => <option key={model} value={model}>{model}</option>)}</select><small>{selectedAiModel && localAiModelDetails[selectedAiModel]?.details ? [localAiModelDetails[selectedAiModel].details?.family, localAiModelDetails[selectedAiModel].details?.parameterSize, localAiModelDetails[selectedAiModel].details?.quantizationLevel].filter(Boolean).join(" · ") : selectedAiModel ? "Installed locally · model tag shown above" : "Install a model with Ollama, then refresh"}</small></div>
              <div><span>Decision model for first-stage screening</span><select className="ai-model-picker" aria-label="Select local decision model" value={matchingSettings.decisionModel} onChange={(event) => chooseDecisionModel(event.target.value)} disabled={!localAiModels.length || checkingLocalAi}><option value="">Choose an installed decision model</option>{localAiModels.map((model) => <option key={model} value={model}>{model}</option>)}</select><small>{systemOneAvailable ? "Uses Ollama /v1/systemone. Select an installed decision model." : "Requires Ollama 0.35 or newer."}</small></div>
            </div>
            <details className="matching-settings"><summary>Screening weights and detailed-analysis thresholds</summary>
              <p>Weighted estimate = skills × {matchingSettings.weights.skills}% + experience × {matchingSettings.weights.experience}% + domain × {matchingSettings.weights.domain}% + (1 − explicit disqualifier risk) × {matchingSettings.weights.disqualifier}%. Weights total 100%.</p>
              <div className="matching-settings-grid">{(["skills", "experience", "domain", "disqualifier"] as const).map((key) => <label key={key}>{key === "disqualifier" ? "Explicit disqualifier penalty" : `${key[0].toUpperCase()}${key.slice(1)} evidence`}<input type="number" min="0" max="100" value={matchingSettings.weights[key]} onChange={(event) => updateMatchWeight(key, Number(event.target.value))} />%</label>)}
                <label>Send to detailed analysis at or above score<input type="number" min="0" max="100" value={matchingSettings.detailedScoreThreshold} onChange={(event) => setMatchingSettings((current) => ({ ...current, detailedScoreThreshold: Math.round(Math.max(0, Math.min(100, Number(event.target.value)))) }))} />%</label>
                <label>Send to detailed analysis below confidence<input type="number" min="0" max="100" value={matchingSettings.detailedConfidenceThreshold} onChange={(event) => setMatchingSettings((current) => ({ ...current, detailedConfidenceThreshold: Math.round(Math.max(0, Math.min(100, Number(event.target.value)))) }))} />%</label>
              </div><small>Low confidence and missing information always go to detailed analysis. These scores are estimates, not chances of getting hired.</small>
            </details>
            {localAiStatus && <p className="local-ai-message" role="status">{localAiStatus}</p>}
          </section>

          <div className="stats-grid">
            <div className="stat-card"><div className="stat-label">JOBS REVIEWED</div><div className="stat-bottom"><strong>{reviewedCount}</strong><span className="stat-note">of {preferredJobs.length} live jobs in your locations</span></div></div>
            <div className="stat-card"><div className="stat-label">JOBS WITH SKILL MENTIONS</div><div className="stat-bottom"><strong>{matchedJobs}</strong><span className="stat-note">At least one profile skill mentioned</span></div></div>
            <div className="stat-card"><div className="stat-label">SAVED JOBS <span>ⓘ</span></div><div className="stat-bottom"><strong>{String(saved.length).padStart(2, "0")}</strong><span className="stat-note">Kept for later review</span></div><div className="saved-stat-icon">☆</div></div>
            <div className="stat-card source-card"><div className="stat-label">JOB SOURCES <span>ⓘ</span></div><div className="source-logos"><b className="gh">↗</b><span>{liveJobs.length ? `${new Set(liveJobs.map((job) => job.source)).size} feeds searched` : "Ready to search"}</span></div><div className="source-foot">Public job feeds <i/> Europe + remote</div></div>
          </div>

          {hasCurrentCvAssessment && <section className="match-calibration-panel" aria-labelledby="match-calibration-title">
            <div className="match-calibration-heading"><div><span className="eyebrow">LOCAL FEEDBACK</span><h2 id="match-calibration-title">Review screening quality</h2><p>Review assessed jobs in the detail panel. Reviews are stored on this device and grouped by CV and decision model.</p></div><span className="calibration-sample-count">{currentModelMetrics.total} reviewed</span></div>
            {currentModelMetrics.total === 0 ? <p className="calibration-empty">No reviewed matches for this CV and model yet. Mark assessed jobs as relevant or not relevant to start measuring errors.</p> : <>
              <div className="calibration-metrics">
                <div><span>False positives</span><strong>{currentModelMetrics.falsePositive} · {formatRate(currentModelMetrics.falsePositiveRate)}</strong><small>Model said match; your review said no</small></div>
                <div><span>False negatives</span><strong>{currentModelMetrics.falseNegative} · {formatRate(currentModelMetrics.falseNegativeRate)}</strong><small>Model said low match; your review said yes</small></div>
                <div><span>Precision</span><strong>{formatRate(currentModelMetrics.precision)}</strong><small>Of predicted matches, how many you approved</small></div>
                <div><span>Recall</span><strong>{formatRate(currentModelMetrics.recall)}</strong><small>Of reviewed matches, how many the model found</small></div>
              </div>
              <div className="calibration-table-wrap"><table className="calibration-table"><thead><tr><th>Screening-score band</th><th>Reviews</th><th>Average score</th><th>Observed relevant rate in your reviews</th></tr></thead><tbody>{currentModelMetrics.bands.map((band) => <tr key={band.low}><td>{band.low}–{band.high}%</td><td>{band.count}</td><td>{band.meanModelScore === null ? "—" : `${Math.round(band.meanModelScore)}%`}</td><td>{formatRate(band.observedRelevantRate)}</td></tr>)}</tbody></table></div>
              <p className="calibration-caveat">This is a small, self-selected review sample. It does not establish model calibration or a general probability of getting hired.</p>
              <button type="button" className="secondary-button clear-calibration" onClick={clearMatchReviews}>Clear local review history</button>
            </>}
          </section>}

          <div className="section-heading"><div><h2>Job listings <span className="result-count">{filteredRanked.length}</span></h2><p>{hasAnyScreenings ? "Sorted by local decision-model fit estimate. Confidence is shown separately; neither is a hiring probability." : "Sort by target role, exact skill overlap, posting date, or company."}</p></div><span className="filter-summary">Showing {visibleJobs.length} of {filteredRanked.length}</span></div>
          <div className="jobs-layout">
            <section className="jobs-column">
              <div className="filters">
                <label className="search-box"><span>⌕</span><input id="job-search" placeholder="Search roles or companies..." value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(25); }} /></label>
                <select aria-label="Filter by posting date" value={postedWithin} onChange={(event) => { setPostedWithin(event.target.value as PostedWithin); setVisibleCount(25); }}><option value="any">Any date</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select>
                <select aria-label="Filter by work mode" value={workMode} onChange={(event) => { setWorkMode(event.target.value as WorkMode); setVisibleCount(25); }}><option value="any">Any work mode</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">On-site</option></select>
                <select aria-label="Filter by department" value={department} onChange={(event) => { setDepartment(event.target.value); setVisibleCount(25); }}><option value="">Any department</option>{departments.map((item) => <option key={item} value={item}>{item}</option>)}</select>
                <select aria-label="Filter by minimum match score" value={minimumScore} onChange={(event) => { setMinimumScore(Number(event.target.value)); setVisibleCount(25); }}><option value={0}>Any match score</option><option value={40}>40% or higher</option><option value={60}>60% or higher</option><option value={80}>80% or higher</option></select>
                <select aria-label="Sort jobs" value={sortBy} onChange={(event) => setSortBy(event.target.value as "match" | "newest" | "company")}><option value="match">Sort: Best match score</option><option value="newest">Sort: Newest</option><option value="company">Sort: Company A–Z</option></select>
                <span className="location-filter">Locations: {profile.locations || "Any"}</span>
              </div>
              {filteredRanked.length > 0 ? <>
                <div className="job-list">{visibleJobs.map(({ job, score, confidence, matched, titleMatched, roleMatch }) => <article key={job.id} className={`job-card ${selected?.job.id === job.id ? "selected" : ""}`}><button type="button" className="job-card-main" aria-pressed={selected?.job.id === job.id} onClick={() => { selectJob(job.id); setStatus((current) => current[job.id] ? current : { ...current, [job.id]: "Needs review" }); }}><div className="job-card-top"><div className={`company-logo logo-${job.source.toLowerCase()}`}>{job.company.slice(0, 1)}</div><span className="match-tag">{job.screening?.model === matchingSettings.decisionModel ? `${score}% estimate · ${confidence === null ? "confidence unavailable" : `${confidence}% confidence`}` : roleMatch ? "Target role" : `${score}% skills overlap`}</span></div><div className="job-title">{job.role}</div><div className="company-name">{job.company} <span>·</span> {job.location}</div><div className="job-meta"><span>◷ {job.posted}</span><span>⌂ {job.mode}</span><span className="source-tag">{job.source} · feed</span></div></button><div className="job-card-bottom"><div className="skill-pills">{matched.slice(0, 3).map((skill) => <span className={titleMatched.includes(skill) ? "skill-in-title" : ""} key={skill}>{skill}{titleMatched.includes(skill) && <small>title</small>}</span>)}{matched.length > 3 && <span className="more-skills">+{matched.length - 3}</span>}</div><button type="button" className={`bookmark ${saved.includes(job.id) ? "bookmarked" : ""}`} onClick={() => setSaved((current) => current.includes(job.id) ? current.filter((id) => id !== job.id) : [...current, job.id])} aria-label={saved.includes(job.id) ? "Remove saved job" : "Save job"} aria-pressed={saved.includes(job.id)}>{saved.includes(job.id) ? "★" : "☆"}</button></div></article>)}</div>
                {visibleJobs.length < filteredRanked.length && <button className="load-more" onClick={() => setVisibleCount((count) => count + 25)}>Show more jobs <span>({filteredRanked.length - visibleJobs.length} remaining)</span></button>}
              </> : <div className="empty-state">{liveJobs.length === 0 ? "No jobs loaded yet. Select “Search jobs now” to check public job feeds." : ranked.length === 0 ? query ? "No live jobs match that search. Try another role or company." : emptyJobMessage : "No jobs match these filters. Try a different date, work mode, or department."}</div>}
              {(nextArbeitnowPage !== null || nextJobicyCursor !== null) && <button className="load-more" onClick={() => void fetchMoreJobs()} disabled={loadingMoreJobs || loadingJobs}>{loadingMoreJobs ? "Loading more jobs…" : "Load more jobs"}</button>}
            </section>

            {selected ? (
              <aside className="detail-card">
                    <div className="detail-actions">
                <span className="detail-source"><i /> {selected.job.source} listing · <a href={selected.job.sourceAttributionUrl ?? selected.job.sourceUrl} target="_blank" rel="noreferrer">source</a></span>
                  <button className="icon-button" onClick={() => setSaved((current) => current.includes(selected.job.id) ? current.filter((id) => id !== selected.job.id) : [...current, selected.job.id])} aria-label="Save selected job">{saved.includes(selected.job.id) ? "★" : "☆"}</button>
                </div>
                <div className="detail-company"><div className={`company-logo big-logo logo-${selected.job.source.toLowerCase()}`}>{selected.job.company.slice(0, 1)}</div><div><h3>{selected.job.company}</h3><span>{selected.job.location} · {selected.job.mode}</span>{selected.job.department && <span>{selected.job.department}</span>}</div></div>
                <h2 className="detail-title">{selected.job.role}</h2>
                <div className="detail-sub">{selected.job.mode} <i/> Posted {selected.job.posted} {selected.job.retrievedAt && <><i/> Retrieved {new Date(selected.job.retrievedAt).toLocaleString()}</>}</div>
                <div className="detail-buttons">{selected.job.sourceUrl ? <a href={selected.job.sourceUrl} target="_blank" rel="noreferrer" className="primary-button apply-button">Open original posting ↗</a> : <a href="#job-description" className="primary-button apply-button">Review role details ↓</a>}<label className="detail-status-label">Status<select aria-label={`Application status for ${selected.job.company}`} value={status[selected.job.id] ?? "Needs review"} onChange={(event) => setStatus((current) => ({ ...current, [selected.job.id]: event.target.value as ApplicationStatus }))}><option>Needs review</option><option>Approved to prepare</option><option>Applied</option><option>Rejected</option></select></label></div>
                <div className="divider"/>
                <div className="fit-heading"><div><h4>{selected.job.screening?.model === matchingSettings.decisionModel ? "AI estimated fit" : "Profile skills overlap"} <span className="info-dot">i</span></h4><p>{selected.job.screening?.model === matchingSettings.decisionModel ? "Local decision-model estimate; confidence shown separately" : selected.roleMatch ? "Target role matches; percentage shows exact skill mentions only" : "Profile skills mentioned in the posting"}</p></div><div className="score-ring" style={{ "--score": `${selected.score}%` } as React.CSSProperties}><span>{selected.score}%</span></div></div>
                <div className="fit-meter"><i style={{ width: `${selected.score}%` }}/></div>
                {selected.job.screening?.model === matchingSettings.decisionModel && <section className="ai-match-explanation" aria-label="Local decision-model match estimate"><div className="ai-match-title"><h4>Local screening estimate</h4><strong>{selected.job.screening.score}% · {selected.job.screening.confidence === null ? "confidence unavailable" : `${selected.job.screening.confidence}% model confidence`} · {selected.job.screening.model}</strong></div><p>Estimated role fit, not probability of getting hired. Screening confidence controls second-stage review and is not the same as the fit score.</p><div className="screening-breakdown">{Object.entries(selected.job.screening.breakdown).map(([key, value]) => <span key={key}>{key}: {value === null ? "missing" : `${value}%`}</span>)}<span>Explicit disqualifier risk: {selected.job.screening.disqualifierRisk === null ? "missing" : `${selected.job.screening.disqualifierRisk}%`}</span><span>Information: {selected.job.screening.informationStatus.replaceAll("_", " ")}</span></div><small>Score weights: skills {matchingSettings.weights.skills}%, experience {matchingSettings.weights.experience}%, domain {matchingSettings.weights.domain}%, disqualifier penalty {matchingSettings.weights.disqualifier}%.</small><small>AI estimates can be wrong. Verify the original posting and every requirement.</small>{hasCurrentCvAssessment && <div className="match-review-controls"><span>Your review: {selectedMatchReview ? selectedMatchReview.reviewedRelevant ? "Relevant" : "Not relevant" : "Not reviewed"}</span><div><button type="button" className={selectedMatchReview?.reviewedRelevant === true ? "selected-review" : ""} aria-pressed={selectedMatchReview?.reviewedRelevant === true} onClick={() => reviewSelectedMatch(true)}>Relevant</button><button type="button" className={selectedMatchReview?.reviewedRelevant === false ? "selected-review" : ""} aria-pressed={selectedMatchReview?.reviewedRelevant === false} onClick={() => reviewSelectedMatch(false)}>Not relevant</button></div></div>}</section>}
                {selected.job.detailedAnalysis && <section className="ai-match-explanation detailed-analysis" aria-label="Detailed local CV and job evidence"><div className="ai-match-title"><h4>Detailed local analysis</h4><strong>{selected.job.aiMatch?.model ?? selected.job.detailedAnalysis.model}</strong></div><p>{selected.job.detailedAnalysis.summary}</p>{selected.job.detailedAnalysis.matchedRequirements.length > 0 && <><h5>Matched requirements</h5><ul>{selected.job.detailedAnalysis.matchedRequirements.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></>}{selected.job.detailedAnalysis.gaps.length > 0 && <><h5>Gaps or unclear requirements</h5><ul>{selected.job.detailedAnalysis.gaps.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></>}{selected.job.detailedAnalysis.evidence.map((item, index) => <blockquote key={`${index}-${item.requirement}`}><strong>{item.requirement}</strong><br/><b>CV:</b> “{item.cvQuote}”<br/><b>Job:</b> “{item.jobQuote}”</blockquote>)}</section>}
                <div className="evidence-label">PROFILE SKILLS MENTIONED IN POSTING <span>{selected.matched.length} found</span></div>
                <div className="evidence-pills">{selected.matched.map((skill) => <span key={skill}>✓ {skill}{selected.titleMatched.includes(skill) && <small> · title</small>}</span>)}</div>
                {selected.missing.length > 0 && <><div className="evidence-label gap-label">PROFILE SKILLS NOT MENTIONED <span>{selected.missing.length}</span></div><div className="evidence-pills missing-pills">{selected.missing.map((skill) => <span key={skill}>! {skill}</span>)}</div><p className="match-caveat">A skill missing from the posting text is not proof that the job requires it.</p></>}
                <div className="divider"/>
                <div id="job-description" className="description"><h4>Job description</h4><p className="job-description-text">{selected.job.description ?? selected.job.summary}</p></div>
                  <section className="cover-letter-draft" key={selected.job.id}>
                  <div className="cover-letter-heading"><div><h4>Cover letter draft</h4><p>Build an editable first draft for this role.</p></div><button type="button" className="secondary-button" onClick={() => setCoverLetterOpen((open) => !open)}>{coverLetterOpen ? "Close" : "Create draft"}</button></div>
                  {coverLetterOpen && <>
                    <p className="cover-letter-help">Add a reason and a specific, truthful experience example. AI drafting runs through Ollama on this laptop. Review every claim before use.</p>
                    <label>Why are you interested in this role or company?<textarea rows={2} maxLength={2000} value={selectedCoverLetter?.interest ?? ""} onChange={(event) => updateSelectedCoverLetter({ interest: event.target.value })} placeholder="Add a specific reason…" /></label>
                    <label>Relevant example and outcome from your experience<textarea rows={2} maxLength={4000} value={selectedCoverLetter?.evidence ?? ""} onChange={(event) => updateSelectedCoverLetter({ evidence: event.target.value })} placeholder="Describe your contribution and the result…" /></label>
                    <label className="local-model-select">Local AI model<select value={selectedAiModel} onChange={(event) => chooseLocalAiModel(event.target.value)} disabled={!localAiModels.length || aiDrafting}><option value="">Choose an installed model</option>{localAiModels.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
                    <p className="cover-letter-help">Cover-letter drafting uses your profile and notes. CV text is used only for local job matching, not sent with a cover-letter request.</p>
                    {localAiStatus && <p className="cover-letter-message" role="status">{localAiStatus}</p>}
                    <div className="cover-letter-actions"><button type="button" className="primary-button cover-letter-generate" onClick={() => void generateAiCoverLetter()} disabled={!localAiModels.includes(selectedAiModel) || aiDrafting}>{aiDrafting ? "Generating locally…" : "Generate on this laptop"}</button><button type="button" className="secondary-button cover-letter-generate" onClick={buildCoverLetter}>Use simple template</button></div>
                    {selectedCoverLetter?.draft && <><label>Draft text<textarea rows={11} maxLength={20000} value={selectedCoverLetter.draft} onChange={(event) => updateSelectedCoverLetter({ draft: event.target.value })} /></label><div className="cover-letter-actions"><button type="button" className="secondary-button" onClick={() => void copyCoverLetter()}>Copy</button><button type="button" className="secondary-button" onClick={downloadCoverLetter}>Download .txt</button></div><p className="cover-letter-help">Saved on this device · Updated {new Date(selectedCoverLetter.updatedAt).toLocaleString()}</p></>}
                    {coverLetterMessage && <p className="cover-letter-message" role="status">{coverLetterMessage}</p>}
                  </>}
                </section>
                <div className="review-note"><span>◉</span><p><strong>Human review required</strong><br/>Approval only authorizes preparation; it does not submit an application.</p></div>
              </aside>
            ) : <aside className="detail-card empty-detail">Select a job to inspect its match evidence.</aside>}
          </div>
          <footer className="page-footer"><span>JOBPILOT <b>·</b> LOCAL-FIRST JOB SEARCH</span><span>Live listings · Nothing is submitted automatically</span></footer>
          </>}
        </div>
      </section>
      {profileOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileOpen(false); }}><section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title"><div className="modal-heading"><div><span className="eyebrow">YOUR LOCAL SEARCH PROFILE</span><h2 id="profile-title">Candidate profile</h2><p>These editable details are stored in a file on this device.</p></div><button className="icon-button" onClick={() => setProfileOpen(false)} aria-label="Close profile">×</button></div><section className="cv-import" aria-labelledby="cv-import-title">
        <div className="cv-import-heading"><div><h3 id="cv-import-title">Analyze CV</h3><p>Upload once. Job titles and skills fill your profile automatically; your name and preferred locations stay unchanged.</p></div><span className="local-only-tag">ON THIS DEVICE</span></div>
        <label className="cv-file-label" htmlFor="cv-file">{cvParsing ? "Reading CV…" : cvAnalyzing ? "Analyzing with Ollama…" : cvFileName ? "Choose a different CV" : "Choose a CV file"}<input id="cv-file" type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event) => void parseSelectedCv(event)} disabled={cvParsing || cvAnalyzing}/></label>
        <p className="cv-file-hint">PDF, DOCX, or TXT · up to 12 MB. Scanned PDF pages are converted to images in your browser and read by Tesseract on this laptop. CV pages are not sent to a hosted OCR service.</p>
        <label className="local-model-select">OCR language<select aria-label="OCR language" value={ocrLanguage} onChange={(event) => setOcrLanguage(event.target.value as "eng" | "deu" | "eng+deu")} disabled={cvParsing || cvAnalyzing}><option value="eng">English</option><option value="deu">German</option><option value="eng+deu">English and German</option></select></label>
        {cvError && <p className="cv-error" role="alert">{cvError}</p>}
        {cvMessage && <p className="cv-message" role="status">{cvMessage}</p>}
        {cvAnalysisStatus && <p className="cv-message" role="status">{cvAnalysisStatus}</p>}
        {cvSuggestions && <div className="cv-preview">
          <div className="cv-analysis-summary"><span className="eyebrow">CV ANALYSIS {(cvParsing || cvAnalyzing) && "· IN PROGRESS"}</span><strong className="cv-file-name">{cvFileName}</strong><p>{cvSuggestions.analysis?.summary ?? (cvAnalyzing ? "Ollama is analyzing your experience, skills, and suitable job titles…" : "AI summary is not available. Profile fields were extracted from readable CV sections.")}</p></div>
          {cvSuggestions.analysis && <div className="cv-analysis-facts"><p><strong>Seniority</strong><span>{cvSuggestions.analysis.seniority}</span></p><p><strong>Domains</strong><span>{cvSuggestions.analysis.domains.join(" · ") || "Not identified"}</span></p></div>}
          <div className="cv-analysis-facts"><p><strong>Suggested job titles</strong><span>{cvSuggestions.roles || (cvParsing || cvAnalyzing ? "Analyzing CV for role titles…" : "No role titles detected")}</span></p><p><strong>Skills and keywords</strong><span>{cvSuggestions.skills || (cvParsing || cvAnalyzing ? "Analyzing CV for skills…" : "No skills detected")}</span></p></div>
          {Boolean(cvSuggestions.analysis?.highlights.length) && <div className="cv-highlights"><strong>Experience evidence</strong><ul>{cvSuggestions.analysis?.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul></div>}
          {cvSuggestions.notes.filter((note) => !(cvParsing || cvAnalyzing) || !/no skills section|no dated role titles/i.test(note)).map((note) => <p className="cv-file-hint" key={note}>{note}</p>)}
          {cvPreviewUrl && <details className="cv-document-details"><summary>View original CV PDF</summary><iframe title="Uploaded CV PDF preview" src={cvPreviewUrl}/></details>}
          <details className="cv-text-details"><summary>View extracted CV text</summary><pre>{(cvSuggestions.sourceText ?? "").slice(0, 12_000)}</pre>{(cvSuggestions.sourceText?.length ?? 0) > 12_000 && <small>Preview limited to 12,000 characters. The full extracted text remains in memory for local matching.</small>}</details>
          <p className="cv-file-hint">Your preferred location was not inferred from the CV. Profile role and skill fields below were filled automatically and can be edited.</p>
        </div>}
      </section><label>Display name<input value={profileDraft.name} onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })}/></label><label>Target roles<span className="field-hint">Enter the roles you want to apply for, separated by commas or new lines. Filled automatically from your CV analysis; edit this list to steer job discovery.</span><textarea rows={2} value={profileDraft.roles} onChange={(event) => setProfileDraft({ ...profileDraft, roles: event.target.value })}/></label><label>Preferred locations<span className="field-hint">Enter locations explicitly, for example Austria or Vienna, Austria. Separate alternatives with semicolons. Leave blank to show any location. A bare “Remote” listing is excluded unless you choose Remote.</span><textarea rows={2} value={profileDraft.locations} onChange={(event) => setProfileDraft({ ...profileDraft, locations: event.target.value })}/></label><label>Skills <span className="field-hint">Filled automatically from your CV analysis. Edit these keywords to steer job discovery; local AI also compares the CV text with each job description.</span><textarea rows={4} value={profileDraft.skills} onChange={(event) => setProfileDraft({ ...profileDraft, skills: event.target.value })}/></label><div className="modal-actions"><button className="secondary-button" onClick={() => setProfileDraft(defaultProfile)}>Reset default profile</button><button className="primary-button" onClick={saveProfileDraft}>Save profile</button></div><section className="data-backup" aria-label="Profile and job data backup"><div><strong>Data backup</strong><p>Download a copy of your profile and job tracker, or restore a previous backup.</p></div><div className="data-backup-actions"><button type="button" className="secondary-button" onClick={downloadBackup}>Download backup</button><button type="button" className="secondary-button" onClick={() => backupInput.current?.click()} disabled={backupBusy}>{backupBusy ? "Restoring…" : "Restore backup"}</button><input ref={backupInput} className="visually-hidden" type="file" accept="application/json,.json" aria-label="Choose Jobpilot backup file" onChange={(event) => void restoreBackup(event)}/></div>{backupMessage && <p role="status">{backupMessage}</p>}</section><p className="privacy-explainer">Scanned PDF page images are sent only to Jobpilot on localhost and processed by Tesseract on this laptop; temporary image files are deleted immediately. The CV file and full text are not saved. Extracted text is sent only to local Ollama for profile analysis and job matching. Accepted role and skill suggestions are stored in the local profile file, which is not encrypted.</p></section></div>}
    </main>
  );
}
