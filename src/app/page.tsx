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
import type { SearchSourceStatus } from "@/lib/job-search";
import { createMatchCohortKey, MAX_MATCH_REVIEWS, summarizeMatchReviews } from "@/lib/match-calibration";
import { DEFAULT_MATCHING_SETTINGS, localScreeningReadinessMessage } from "@/lib/job-screening";
import { createApplicationPacket, detectAtsPlatform } from "@/lib/application-preparation";
import { compareDecisionScores, passesMinimumDecisionScore } from "@/lib/job-ranking";

const LEGACY_STORAGE_KEY = "jobpilot-local-v1";
const MAX_BACKUP_BYTES = 23_000_000;
const AI_MATCH_BATCH_SIZE = 2;
const AUTOMATIC_PAGE_BATCH_LIMIT = 3;
const MAX_CV_MATCH_CHARS = 10_000;
const MAX_LOCAL_JOB_POOL = 2_000;

function createCvMatchContext(cvText: string, suggestions: CvSuggestions | null, profile: CandidateProfile) {
  const analysis = suggestions?.analysis;
  const profileEvidence = [
    analysis?.summary,
    analysis?.seniority ? `Seniority: ${analysis.seniority}` : "",
    analysis?.domains.length ? `Domains: ${analysis.domains.join(", ")}` : "",
    profile.roles ? `Target roles: ${profile.roles}` : suggestions?.roles ? `Suggested roles: ${suggestions.roles}` : "",
    profile.skills ? `Profile skills: ${profile.skills}` : suggestions?.skills ? `Skills: ${suggestions.skills}` : "",
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
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [systemOneAvailable, setSystemOneAvailable] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [activeView, setActiveView] = useState<"overview" | "all-found" | "applications">("overview");
  const [foundQuery, setFoundQuery] = useState("");
  const [foundVisibleCount, setFoundVisibleCount] = useState(50);
  const [liveJobs, setLiveJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [loadingMoreJobs, setLoadingMoreJobs] = useState(false);
  const [aiMatchProgress, setAiMatchProgress] = useState<{ completed: number; total: number } | null>(null);
  const [detailedAnalysisJobId, setDetailedAnalysisJobId] = useState("");
  const [detailedAnalysisError, setDetailedAnalysisError] = useState<{ jobId: string; message: string } | null>(null);
  const [nextArbeitnowPage, setNextArbeitnowPage] = useState<number | null>(null);
  const [nextJobicyCursor, setNextJobicyCursor] = useState<string | null>(null);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [storageMessage, setStorageMessage] = useState("Loading saved data from this device…");
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const aiMatchAbortController = useRef<AbortController | null>(null);
  const detailedAnalysisAbortController = useRef<AbortController | null>(null);
  const aiMatchGeneration = useRef(0);
  const fetchLiveJobsRef = useRef<() => Promise<void>>(async () => undefined);
  const handledSearchRequestId = useRef(0);
  const automaticScreeningLock = useRef(false);
  const moreJobsInFlight = useRef(false);
  const automaticScreeningAttempt = useRef("");
  const screenCurrentJobsRef = useRef<() => Promise<void>>(async () => undefined);
  const fetchMoreJobsRef = useRef<() => Promise<void>>(async () => undefined);
  const automaticPageBatchesRemaining = useRef(0);
  const backupInput = useRef<HTMLInputElement>(null);
  const [sourceMessage, setSourceMessage] = useState("");
  const [sourceErrors, setSourceErrors] = useState<string[]>([]);
  const [sourceStatuses, setSourceStatuses] = useState<SearchSourceStatus[]>([]);
  const [profileDraft, setProfileDraft] = useState<CandidateProfile>(defaultProfile);
  const [searchRolesDraft, setSearchRolesDraft] = useState(defaultProfile.roles);
  const [searchLocationsDraft, setSearchLocationsDraft] = useState(defaultProfile.locations);
  const [searchRequestId, setSearchRequestId] = useState(0);
  const [manualJob, setManualJob] = useState({ role: "", company: "", location: "", description: "", url: "" });
  const [manualJobMessage, setManualJobMessage] = useState("");
  const [manualJobError, setManualJobError] = useState("");
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
  const [applicationKitMessage, setApplicationKitMessage] = useState("");
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
  const allFoundJobs = useMemo(() => jobs.filter((job) => job.source !== "Manual"), [jobs]);
  const filteredFoundJobs = useMemo(() => {
    const normalizedQuery = foundQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery) return allFoundJobs;
    return allFoundJobs.filter((job) => `${job.role} ${job.company} ${job.location} ${job.source}`.toLocaleLowerCase().includes(normalizedQuery));
  }, [allFoundJobs, foundQuery]);
  const visibleFoundJobs = filteredFoundJobs.slice(0, foundVisibleCount);

  function selectJob(jobId: string) {
    setSelectedId(jobId);
    setCoverLetterMessage("");
    setDetailedAnalysisError(null);
  }

  function invalidateAiAssessment() {
    aiMatchGeneration.current += 1;
    aiMatchAbortController.current?.abort();
    aiMatchAbortController.current = null;
    setAiMatchProgress(null);
  }

  function chooseLocalAiModel(model: string) {
    detailedAnalysisAbortController.current?.abort();
    detailedAnalysisAbortController.current = null;
    setDetailedAnalysisJobId("");
    setDetailedAnalysisError(null);
    setSelectedAiModel(model);
    setSourceMessage("Detailed-analysis model changed. Existing decision scores and prior detailed reviews are kept; new reviews use the selected model.");
  }

  function chooseDecisionModel(model: string) {
    invalidateAiAssessment();
    detailedAnalysisAbortController.current?.abort();
    setDetailedAnalysisJobId("");
    setDetailedAnalysisError(null);
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
        setSearchRolesDraft(restored.profile.roles);
        setSearchLocationsDraft(restored.profile.locations);
        setSaved(restored.saved);
        setStatus(restored.status);
        setApplicationNotes(restored.applicationNotes ?? {});
        setApplicationFollowUps(restored.applicationFollowUps ?? {});
        setCoverLetterDrafts(restored.coverLetterDrafts ?? {});
        setMatchReviews(restored.matchReviews ?? []);
        setMatchCohortKey(restored.matchCohortKey ?? "");
        setMatchingSettings((current) => ({ ...(restored.matchingSettings ?? DEFAULT_MATCHING_SETTINGS), decisionModel: restored.matchingSettings?.decisionModel || current.decisionModel }));
        setWebSearchEnabled(restored.webSearchEnabled === true);
        setLiveJobs(restored.liveJobs ?? []);
        const restoredCvText = restored.cvText ?? "";
        setCvText(restoredCvText);
        setCvFileName(restored.cvFileName ?? "");
        if (restoredCvText || restored.cvAnalysis) {
          const analysis = restored.cvAnalysis;
          setCvSuggestions({
            roles: restored.profile.roles,
            skills: restored.profile.skills,
            notes: analysis?.notes ?? [],
            sourceText: restoredCvText,
            ...(analysis?.summary ? { analysis: {
              summary: analysis.summary,
              seniority: analysis.seniority ?? "Not identified",
              domains: analysis.domains ?? [],
              highlights: analysis.highlights ?? [],
            } } : {}),
          });
          setCvMessage("Restored the locally saved CV excerpt and analysis. The original CV file was not saved.");
        }
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
      setSelectedAiModel((current) => current && names.includes(current) ? current : result.preferredModel && names.includes(result.preferredModel) ? result.preferredModel : "");
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
    void Promise.resolve().then(() => refreshLocalAiStatus());
  }, []);

  useEffect(() => () => {
    if (cvPreviewUrl) URL.revokeObjectURL(cvPreviewUrl);
  }, [cvPreviewUrl]);

  useEffect(() => () => {
    aiMatchAbortController.current?.abort();
    detailedAnalysisAbortController.current?.abort();
  }, []);

  useEffect(() => {
    if (!stateLoaded) return;
    let cancelled = false;
    const snapshot = {
      profile, saved, status, applicationNotes, applicationFollowUps, coverLetterDrafts, matchReviews, matchCohortKey, matchingSettings, liveJobs, webSearchEnabled,
      cvText: cvText.slice(0, MAX_CV_MATCH_CHARS),
      cvFileName,
      ...(cvSuggestions ? { cvAnalysis: {
        ...(cvSuggestions.analysis ? { ...cvSuggestions.analysis } : {}),
        notes: cvSuggestions.notes,
      } } : {}),
    } satisfies PersistedState;
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
  }, [profile, saved, status, applicationNotes, applicationFollowUps, coverLetterDrafts, matchReviews, matchCohortKey, matchingSettings, liveJobs, webSearchEnabled, cvText, cvFileName, cvSuggestions, stateLoaded]);

  const locationMatchedJobs = useMemo(() => jobs.filter((job) =>
    (job.source === "Manual" || matchesPreferredLocation(job.location, profile.locations, job.mode, job.source, job.sourceLocationScope))
    && (job.source === "Manual" || !profile.roles.trim() || matchesTargetRole(job, profile.roles))), [jobs, profile.locations, profile.roles]);
  const localDecisionScreeningReady = Boolean(cvText.trim() && localAiModels.includes(matchingSettings.decisionModel) && systemOneAvailable && isLocalJobpilotPage());
  const screeningReadinessMessage = localScreeningReadinessMessage({
    hasCv: Boolean(cvText.trim()),
    isLocalPage: isLocalJobpilotPage(),
    ollamaConnected: localAiConnected,
    systemOneAvailable,
    decisionModelInstalled: localAiModels.includes(matchingSettings.decisionModel),
  });
  const hasCurrentCvAssessment = localDecisionScreeningReady && cvAnalyzedModel === matchingSettings.decisionModel;
  const hasStoredScreenings = jobs.some((job) => job.screening?.model === matchingSettings.decisionModel);
  const hasAnyScreenings = hasCurrentCvAssessment || hasStoredScreenings;
  const matchingConfigurationKey = JSON.stringify({ matchingSettings, roles: profile.roles, locations: profile.locations });
  const currentModelReviews = useMemo(() => matchReviews.filter((review) => review.model === matchingSettings.decisionModel && review.cohortKey === matchCohortKey && review.configurationKey === matchingConfigurationKey), [matchReviews, matchingSettings.decisionModel, matchingConfigurationKey, matchCohortKey]);
  const currentModelMetrics = useMemo(() => summarizeMatchReviews(currentModelReviews), [currentModelReviews]);
  // Keep every location-eligible listing visible. Relevance scores guide sorting;
  // they must not hide jobs just because extracted CV keywords missed a match.
  const preferredJobs = useMemo(() => jobsForReview(locationMatchedJobs), [locationMatchedJobs]);
  const ranked = useMemo(() => preferredJobs.map((job) => {
    const keywordMatch = scoreJob(job, candidateSkills);
    const screening = job.screening?.model === matchingSettings.decisionModel ? job.screening : undefined;
    return { job, ...keywordMatch, score: screening?.score ?? null, confidence: screening?.confidence ?? null, roleMatch: matchesTargetRole(job, profile.roles) };
  })
    .filter(({ job }) => `${job.role} ${job.company} ${job.location} ${job.department ?? ""}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "newest") return (Date.parse(b.job.postedAt ?? "") || 0) - (Date.parse(a.job.postedAt ?? "") || 0) || compareDecisionScores(a.score, b.score);
      if (sortBy === "company") return a.job.company.localeCompare(b.job.company) || a.job.role.localeCompare(b.job.role);
      if (hasAnyScreenings) {
        const aScored = a.job.screening?.model === matchingSettings.decisionModel;
        const bScored = b.job.screening?.model === matchingSettings.decisionModel;
        if (aScored !== bScored) return aScored ? -1 : 1;
        if (aScored && bScored) return compareDecisionScores(a.score, b.score);
      }
      return Number(b.roleMatch) - Number(a.roleMatch) || b.titleMatched.length - a.titleMatched.length || compareDecisionScores(a.score, b.score);
    }), [query, candidateSkills, preferredJobs, profile.roles, hasAnyScreenings, matchingSettings.decisionModel, sortBy]);
  const filteredRanked = useMemo(() => ranked.filter(({ job, score }) => passesMinimumDecisionScore(score, minimumScore) && matchesPostedWithin(job, postedWithin) && matchesWorkMode(job, workMode) && matchesDepartment(job, department)), [ranked, minimumScore, postedWithin, workMode, department]);
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
      predictedRelevant: selected.job.screening.score >= matchingSettings.relevanceScoreThreshold,
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
    const cvForModel = createCvMatchContext(cvText, cvSuggestions, profile);
    let error = "";
    let cancelled = false;
    let screenedCount = 0;
    setAiMatchProgress({ completed: 0, total: candidates.length });
    for (let offset = 0; offset < candidates.length; offset += AI_MATCH_BATCH_SIZE) {
      if (signal.aborted) { cancelled = true; break; }
      const batch = candidates.slice(offset, offset + AI_MATCH_BATCH_SIZE);
      setSourceMessage(`Local decision model screening ${Math.min(offset + batch.length, candidates.length)} of ${candidates.length} jobs…`);
      try {
        const screened = await Promise.all(batch.map(async (job) => {
          const response = await fetch("/api/jobs/screen", {
            method: "POST", headers: { "Content-Type": "application/json" }, signal,
            body: JSON.stringify({ model: matchingSettings.decisionModel, cvText: cvForModel.slice(0, 15_000), weights: matchingSettings.weights, preferences: { locations: profile.locations, targetRoles: profile.roles }, job: { company: job.company, role: job.role, location: job.location, mode: job.mode, description: (job.description ?? job.summary).slice(0, 12_000) } }),
          });
          const result = await response.json() as { screening?: NonNullable<Job["screening"]>; error?: string };
          if (!response.ok || !result.screening) throw new Error(result.error ?? "Local decision screening failed.");
          return { job, screening: result.screening };
        }));
        for (const { job, screening } of screened) screeningById.set(job.id, screening);
        screenedCount += screened.length;
        setLiveJobs((current) => current.map((item) => screeningById.has(item.id) ? { ...item, screening: screeningById.get(item.id), aiMatch: undefined, detailedAnalysis: undefined } : item));
      } catch (cause) {
        if (signal.aborted) cancelled = true;
        else error = cause instanceof Error ? cause.message : "Local screening failed.";
        break;
      }
    }
    return { screeningById, error, cancelled, screenedCount };
  }

  async function analyzeJobInDetail(job: Job) {
    setDetailedAnalysisError(null);
    if (!cvText.trim()) {
      setDetailedAnalysisError({ jobId: job.id, message: "Upload and analyze your CV before requesting a detailed comparison." });
      return;
    }
    if (!isLocalJobpilotPage()) {
      setDetailedAnalysisError({ jobId: job.id, message: "Open Jobpilot at localhost so your CV and job description stay on this laptop." });
      return;
    }
    if (!localAiModels.includes(selectedAiModel)) {
      setDetailedAnalysisError({ jobId: job.id, message: "Install and select a local chat model in Local AI status, then try again." });
      return;
    }
    if (detailedAnalysisAbortController.current) return;
    const controller = new AbortController();
    detailedAnalysisAbortController.current = controller;
    setDetailedAnalysisJobId(job.id);
    try {
      const response = await fetch("/api/jobs/match", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ model: selectedAiModel, cvText: cvText.slice(0, MAX_CV_MATCH_CHARS), candidatePreferences: { targetRoles: profile.roles, preferredLocations: profile.locations, profileSkills: profile.skills }, jobs: [{ id: job.id, company: job.company, role: job.role, location: job.location, mode: job.mode, description: (job.description ?? job.summary).slice(0, 2_500) }] }),
      });
      const result = await response.json() as { matches?: Array<{ id: string; relevant: boolean; score: number; reason: string; cvEvidence: string; detailedAnalysis: NonNullable<Job["detailedAnalysis"]> }>; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Detailed local analysis failed.");
      const match = result.matches?.find((item) => item.id === job.id);
      if (!match) throw new Error("The local model did not return a detailed comparison for this job.");
      const aiMatch = { model: selectedAiModel, relevant: match.relevant, score: Math.max(0, Math.min(100, Math.round(match.score))), reason: match.reason, cvEvidence: match.cvEvidence };
      setLiveJobs((current) => current.map((item) => item.id === job.id ? { ...item, aiMatch, detailedAnalysis: match.detailedAnalysis } : item));
    } catch (error) {
      if (!controller.signal.aborted) setDetailedAnalysisError({ jobId: job.id, message: error instanceof Error ? error.message : "Detailed local analysis failed." });
    } finally {
      if (detailedAnalysisAbortController.current === controller) detailedAnalysisAbortController.current = null;
      setDetailedAnalysisJobId((current) => current === job.id ? "" : current);
    }
  }

  async function screenCurrentJobs() {
    if (screeningReadinessMessage) {
      setSourceMessage(screeningReadinessMessage);
      return;
    }
    if (automaticScreeningLock.current) return;
    const pending = jobsToAssess(locationMatchedJobs.filter((job) => job.screening?.model !== matchingSettings.decisionModel));
    if (!pending.length) {
      setSourceMessage("All location-eligible jobs already have a score from the selected decision model.");
      return;
    }
    automaticScreeningLock.current = true;
    invalidateAiAssessment();
    const generation = aiMatchGeneration.current;
    const controller = new AbortController();
    aiMatchAbortController.current = controller;
    try {
      const outcome = await assessJobsLocally(pending, controller.signal);
      if (generation !== aiMatchGeneration.current) return;
      setCvAnalyzedModel(matchingSettings.decisionModel);
      setSourceMessage(`Local decision screening assessed ${outcome.screenedCount} of ${pending.length} jobs.${outcome.error ? ` Some scores are still missing: ${outcome.error}` : outcome.cancelled ? " Assessment cancelled." : " Scores are estimates, not hiring probabilities. Request detailed analysis from an individual job when you need it."}`);
    } catch (error) {
      if (generation === aiMatchGeneration.current) setSourceMessage(`Local screening failed: ${error instanceof Error ? error.message : "unknown error"}. The listings remain available.`);
    } finally {
      automaticScreeningLock.current = false;
      if (generation === aiMatchGeneration.current) {
        aiMatchAbortController.current = null;
        setAiMatchProgress(null);
      }
    }
  }

  const pendingMatchCount = locationMatchedJobs.filter((job) => job.screening?.model !== matchingSettings.decisionModel).length;
  const decisionScoredCount = locationMatchedJobs.filter((job) => job.screening?.model === matchingSettings.decisionModel).length;
  const detailedAnalyzedCount = locationMatchedJobs.filter((job) => Boolean(job.detailedAnalysis)).length;
  const jobWorkflowBusy = loadingJobs || loadingMoreJobs || Boolean(aiMatchProgress);
  const jobWorkflowHeading = loadingJobs
    ? liveJobs.length ? "Refreshing listings; current jobs stay visible" : "Searching your selected roles and locations"
    : loadingMoreJobs ? "Finding and checking more listings" : "Local decision screening in progress";
  useEffect(() => {
    screenCurrentJobsRef.current = screenCurrentJobs;
  });
  useEffect(() => {
    if (!stateLoaded || loadingJobs || loadingMoreJobs || cvParsing || cvAnalyzing || checkingLocalAi || !localDecisionScreeningReady || screeningReadinessMessage || aiMatchProgress || automaticScreeningLock.current) return;
    const work = locationMatchedJobs.filter((job) => job.screening?.model !== matchingSettings.decisionModel);
    if (!work.length) return;
    const attemptKey = JSON.stringify({ decision: matchingSettings.decisionModel, cohort: matchCohortKey, configuration: matchingConfigurationKey, jobs: work.map((job) => job.id).sort() });
    if (automaticScreeningAttempt.current === attemptKey) return;
    automaticScreeningAttempt.current = attemptKey;
    void screenCurrentJobsRef.current();
  }, [stateLoaded, loadingJobs, loadingMoreJobs, cvParsing, cvAnalyzing, checkingLocalAi, localDecisionScreeningReady, screeningReadinessMessage, aiMatchProgress, locationMatchedJobs, matchingSettings, matchCohortKey, matchingConfigurationKey]);
  const emptyJobMessage = locationMatchedJobs.length === 0
    ? profile.locations.trim() ? `No fetched jobs have a specific location match for ${profile.locations}. If Europe-wide remote work is acceptable, add “Remote Europe” to your preferences; otherwise try again when feeds have local listings.` : "No jobs are available in the current feeds. Try searching again later."
    : hasCurrentCvAssessment
      ? "The local model did not identify a strong CV match in the analyzed listings. Review your preferred locations or try again after more jobs are available."
      : "No jobs match your saved target roles or CV skills. Review those fields in your profile, then search again.";

  function openProfile() {
    setProfileDraft(profile);
    setProfileOpen(true);
  }

  function saveProfileDraft() {
    const nextProfile = { ...profileDraft, name: profileDraft.name.trim() || "Candidate" };
    if (nextProfile.locations !== profile.locations || nextProfile.roles !== profile.roles) {
      invalidateAiAssessment();
      setCvAnalyzedModel("");
      setLiveJobs((current) => current.map((job) => ({ ...job, screening: undefined, aiMatch: undefined, detailedAnalysis: undefined })));
      setSourceMessage("Search preferences changed. Search again to rescreen jobs against the new preferences.");
    }
    if (nextProfile.skills !== profile.skills || nextProfile.name !== profile.name) {
      setCoverLetterDrafts((current) => Object.fromEntries(Object.entries(current).map(([id, draft]) => [id, { ...draft, claimAudit: undefined }])));
      setCoverLetterMessage("Candidate name or profile skills changed. Existing cover-letter source checks were cleared; regenerate or review the drafts.");
    }
    setProfile(nextProfile);
    setSearchRolesDraft(nextProfile.roles);
    setSearchLocationsDraft(nextProfile.locations);
    setProfileOpen(false);
  }

  function searchWithPreferences() {
    const nextProfile = {
      ...profile,
      roles: searchRolesDraft.trim(),
      locations: searchLocationsDraft.trim(),
    };
    setSourceStatuses([]);
    setSourceErrors([]);
    setSourceMessage("");
    setNextArbeitnowPage(null);
    setNextJobicyCursor(null);
    if (nextProfile.locations !== profile.locations || nextProfile.roles !== profile.roles) {
      invalidateAiAssessment();
      setCvAnalyzedModel("");
      setLiveJobs((current) => current.map((job) => ({ ...job, screening: undefined, aiMatch: undefined, detailedAnalysis: undefined })));
    }
    setProfile(nextProfile);
    setProfileDraft((current) => ({ ...current, roles: nextProfile.roles, locations: nextProfile.locations }));
    setSearchRequestId((current) => current + 1);
  }

  async function addManualJob(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setManualJobError("");
    setManualJobMessage("");
    const role = manualJob.role.trim();
    const company = manualJob.company.trim();
    const location = manualJob.location.trim();
    const description = manualJob.description.trim();
    const originalUrl = manualJob.url.trim();
    if (!role || !company || !location || !description) {
      setManualJobError("Add the role, company, location, and pasted job description to continue.");
      return;
    }
    if (originalUrl) {
      try { if (new URL(originalUrl).protocol !== "https:") throw new Error(); }
      catch { setManualJobError("The original posting link must be a valid HTTPS URL."); return; }
    }
    const now = new Date().toISOString();
    const job: Job = {
      id: `manual-${crypto.randomUUID()}`, role, company, location,
      mode: /remote/i.test(location) ? "Remote" : "Not specified", posted: "Added manually", source: "Manual", retrievedAt: now,
      summary: description.slice(0, 1200), description, ...(originalUrl ? { sourceUrl: originalUrl } : {}),
    };
    setLiveJobs((current) => [job, ...current]);
    selectJob(job.id);
    setManualJob({ role: "", company: "", location: "", description: "", url: "" });
    setManualJobMessage("Posting added to this device. Its original link is saved when provided.");
    if (!localDecisionScreeningReady) return;
    const generation = aiMatchGeneration.current;
    const controller = new AbortController();
    aiMatchAbortController.current = controller;
    setAiMatchProgress({ completed: 0, total: 1 });
    try {
      const outcome = await assessJobsLocally([job], controller.signal);
      if (generation !== aiMatchGeneration.current) return;
      const screening = outcome.screeningById.get(job.id);
      if (screening) setLiveJobs((current) => current.map((item) => item.id === job.id ? { ...item, screening } : item));
      setCvAnalyzedModel(matchingSettings.decisionModel);
      setManualJobMessage(outcome.error ? `Posting added; local screening could not finish: ${outcome.error}` : "Posting added and assessed on this device.");
    } catch (error) {
      setManualJobMessage(`Posting added; local screening failed: ${error instanceof Error ? error.message : "unknown error"}.`);
    } finally {
      aiMatchAbortController.current = null;
      setAiMatchProgress(null);
    }
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
      setSearchRolesDraft(browserRoles);
      setCvMessage(`CV text extracted in your browser. Job titles and skills have been filled into your profile; Jobpilot saves them automatically on this device. Your name and preferred locations were left unchanged.${(suggestions.sourceText?.length ?? 0) > MAX_CV_MATCH_CHARS ? ` Matching uses the first ${MAX_CV_MATCH_CHARS.toLocaleString()} characters.` : ""}`);

      if (!localAiModels.includes(selectedAiModel)) {
        setCvAnalysisStatus("Text-based role and skill extraction is ready. Review the suggested job titles and locations, then search. Select local Ollama models to enable AI matching.");
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
        setSearchRolesDraft(analyzedRoles);
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

  function removeSavedCvEvidence() {
    invalidateAiAssessment();
    if (cvPreviewUrl) URL.revokeObjectURL(cvPreviewUrl);
    setCvPreviewUrl("");
    setCvText("");
    setCvSuggestions(null);
    setCvFileName("");
    setCvAnalyzedModel("");
    setCvMessage("");
    setCvAnalysisStatus("Saved CV matching text removed from this device. Your editable role and skill fields remain in the profile.");
    setLiveJobs((current) => current.map((job) => ({ ...job, screening: undefined, aiMatch: undefined, detailedAnalysis: undefined })));
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
        claimAudit: undefined,
        updatedAt: new Date().toISOString(),
      } };
    });
    setCoverLetterMessage("Basic English template created. AI tone, language, and length settings do not apply to this template.");
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
          preferences: selectedCoverLetter?.preferences ?? { tone: "professional", language: "English", length: "concise" },
        }),
      });
      const result = await response.json() as { draft?: string; claimAudit?: CoverLetterDraftRecord["claimAudit"]; error?: string };
      if (!response.ok || !result.draft) throw new Error(result.error ?? "The AI provider returned no draft.");
      updateSelectedCoverLetter({ draft: result.draft, claimAudit: result.claimAudit });
      const flagged = result.claimAudit?.unverifiedClaims.length ?? 0;
      setCoverLetterMessage(`AI draft created. ${result.claimAudit?.verifiedClaims.length ?? 0} claim quotes matched your supplied fields; ${flagged} claims could not be matched. This checks for source text only, not truth. Review the full letter before use.`);
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
        ...((patch.draft !== undefined || patch.interest !== undefined || patch.evidence !== undefined)
          && !Object.prototype.hasOwnProperty.call(patch, "claimAudit") ? { claimAudit: undefined } : {}),
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

  async function copyApplicationPacket() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(createApplicationPacket(selected.job, profile, selectedCoverLetter?.draft ?? ""));
      setApplicationKitMessage("Application packet copied. Paste details into the employer form and review each field.");
    } catch {
      setApplicationKitMessage("Clipboard access is unavailable. Use the details below to copy manually.");
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
      setSearchRolesDraft(result.profile.roles);
      setSearchLocationsDraft(result.profile.locations);
      setSaved(result.saved);
      setStatus(result.status);
      setApplicationNotes(result.applicationNotes ?? {});
      setApplicationFollowUps(result.applicationFollowUps ?? {});
      setCoverLetterDrafts(result.coverLetterDrafts ?? {});
      setMatchReviews(result.matchReviews ?? []);
      setMatchCohortKey(result.matchCohortKey ?? "");
      setMatchingSettings(result.matchingSettings ?? DEFAULT_MATCHING_SETTINGS);
      setWebSearchEnabled(result.webSearchEnabled === true);
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
    automaticPageBatchesRemaining.current = AUTOMATIC_PAGE_BATCH_LIMIT;
    const searchGeneration = aiMatchGeneration.current;
    setLoadingJobs(true);
    setCvAnalyzedModel("");
    setSourceMessage(`Searching enabled feeds${webSearchEnabled ? " and optional Ollama web search" : ""} for ${profile.roles || "all job titles"} in ${profile.locations || "your selected locations"}…`);
    setSourceErrors([]);
    let fetchedJobs: Job[] = [];
    let allDiscoveredJobs: Job[] = [];
    try {
      const searchParams = new URLSearchParams({ locations: profile.locations, roles: profile.roles, ...(webSearchEnabled ? { includeWebSearch: "1" } : {}) });
      const response = await fetch(`/api/jobs/search?${searchParams}`, { cache: "no-store" });
      const result = await response.json() as { jobs?: Job[]; discoveredJobs?: Job[]; errors?: string[]; error?: string; nextArbeitnowPage?: number | null; nextJobicyCursor?: string | null; sourceStatuses?: typeof sourceStatuses };
      setSourceStatuses(result.sourceStatuses ?? []);
      setSourceErrors(result.errors ?? []);
      setNextArbeitnowPage(result.nextArbeitnowPage ?? null);
      setNextJobicyCursor(result.nextJobicyCursor ?? null);
      if (!response.ok && !(result.jobs?.length)) throw new Error(result.error ?? "Could not fetch jobs.");
      fetchedJobs = result.jobs ?? [];
      allDiscoveredJobs = result.discoveredJobs ?? fetchedJobs;
      const locationJobs = fetchedJobs.filter((job) => matchesPreferredLocation(job.location, profile.locations, job.mode, job.source, job.sourceLocationScope)
        && (!profile.roles.trim() || matchesTargetRole(job, profile.roles)));
      // Show the normalized pool immediately. Screening updates these cards in
      // small batches, so users can review early scores while later jobs run.
      setLiveJobs(allDiscoveredJobs.slice(-MAX_LOCAL_JOB_POOL));
      selectJob(locationJobs[0]?.id ?? "");
      const assessWithCurrentContext = localDecisionScreeningReady && searchGeneration === aiMatchGeneration.current;
      setSourceMessage(assessWithCurrentContext
        ? `Found ${locationJobs.length} listings for your selected roles and locations. Showing them now while local matching runs…`
        : `Found ${locationJobs.length} listings for your selected roles and locations. Showing them now; local matching will start when CV and Ollama models are ready.`);
      let analyzedJobs = allDiscoveredJobs.slice(-MAX_LOCAL_JOB_POOL);
      let completed = 0;
      let cancelled = false;
      let matchingWarning = "";
      if (assessWithCurrentContext) {
        const candidates = jobsToAssess(locationJobs);
        const generation = ++aiMatchGeneration.current;
        const controller = new AbortController();
        aiMatchAbortController.current = controller;
        const outcome = await assessJobsLocally(candidates, controller.signal);
        if (generation !== aiMatchGeneration.current) return;
        completed = outcome.screenedCount;
        cancelled = outcome.cancelled;
        matchingWarning = outcome.error;
        aiMatchAbortController.current = null;
        analyzedJobs = allDiscoveredJobs.slice(-MAX_LOCAL_JOB_POOL).map((job) => ({
          ...job,
          ...(outcome.screeningById.has(job.id) ? { screening: outcome.screeningById.get(job.id) } : { screening: undefined }),
        }));
        setCvAnalyzedModel(matchingSettings.decisionModel);
      }
      setLiveJobs(analyzedJobs);
      const locationCount = locationJobs.length;
      const sourcesChecked = (result.sourceStatuses ?? []).map((source) => `${source.source}: ${source.count} matching of ${source.fetchedCount} fetched`).join(" · ");
      setSourceMessage(result.jobs?.length
        ? assessWithCurrentContext
          ? `Local decision screening assessed ${completed} of ${locationCount} location-eligible jobs. ${cancelled ? "Assessment cancelled; fetched listings remain available." : matchingWarning ? `Some jobs remain unassessed: ${matchingWarning}` : ""} Scores are estimates, not hiring probabilities. Request detailed analysis from an individual job when you need it.`
          : cvText.trim() && !isLocalJobpilotPage()
            ? "CV analysis is blocked here for privacy. Open Jobpilot from localhost on this laptop; no CV text was sent. Showing profile matches."
            : cvText.trim()
              ? `Found ${result.jobs.length} listings, but local decision screening is unavailable. Start/update Ollama to 0.35 or newer, choose an installed decision model, and try again. ${localAiStatus}`
              : `Found ${result.jobs.length} listings matching your selected titles and locations. Import your CV and select local models for fast scores; request detailed analysis on individual jobs. ${sourcesChecked}`
        : `No listing matched the selected titles and locations. Try broader preferences or load more pages. ${sourcesChecked || "No source returned a listing."}`);
      selectJob(locationJobs[0]?.id ?? "");
    } catch (error) {
      if (fetchedJobs.length) {
        const fallback = fetchedJobs.filter((job) => matchesPreferredLocation(job.location, profile.locations, job.mode, job.source, job.sourceLocationScope));
        setLiveJobs(allDiscoveredJobs.slice(-MAX_LOCAL_JOB_POOL).map((job) => ({ ...job, screening: undefined, aiMatch: undefined, detailedAnalysis: undefined })));
        selectJob(fallback[0]?.id ?? "");
        setSourceMessage(`Local job screening failed: ${error instanceof Error ? error.message : "unknown error"}. Jobs are still available to review; no hosted model fallback was used.`);
      } else setSourceMessage(error instanceof Error ? error.message : "Could not fetch job listings.");
    } finally {
      aiMatchAbortController.current = null;
      setAiMatchProgress(null);
      setLoadingJobs(false);
    }
  }

  useEffect(() => {
    fetchLiveJobsRef.current = fetchLiveJobs;
  });

  useEffect(() => {
    if (searchRequestId <= handledSearchRequestId.current || !stateLoaded || loadingJobs || loadingMoreJobs) return;
    handledSearchRequestId.current = searchRequestId;
    void fetchLiveJobsRef.current();
  }, [searchRequestId, stateLoaded, loadingJobs, loadingMoreJobs]);

  async function fetchMoreJobs() {
    if ((nextArbeitnowPage === null && nextJobicyCursor === null) || loadingMoreJobs || loadingJobs || moreJobsInFlight.current) return;
    moreJobsInFlight.current = true;
    const searchGeneration = aiMatchGeneration.current;
    setLoadingMoreJobs(true);
    setSourceMessage("Checking the next pages from enabled job feeds. Current results stay visible while new listings are added and assessed…");
    let fetchedMore: Job[] = [];
    try {
      const params = new URLSearchParams({ locations: profile.locations, roles: profile.roles });
      if (nextArbeitnowPage !== null) params.set("arbeitnowStartPage", String(nextArbeitnowPage));
      if (nextJobicyCursor !== null) params.set("jobicyCursor", nextJobicyCursor);
      const response = await fetch(`/api/jobs/search?${params}`, { cache: "no-store" });
      const result = await response.json() as { jobs?: Job[]; discoveredJobs?: Job[]; errors?: string[]; error?: string; nextArbeitnowPage?: number | null; nextJobicyCursor?: string | null; sourceStatuses?: SearchSourceStatus[] };
      setSourceStatuses((current) => {
        const merged = new Map(current.map((source) => [source.source, source]));
        for (const source of result.sourceStatuses ?? []) {
          const previous = merged.get(source.source);
          merged.set(source.source, previous ? {
            ...source,
            count: previous.count + source.count,
            fetchedCount: previous.fetchedCount + source.fetchedCount,
            state: source.state === "failed" && previous.count > 0 ? "partial" : source.state,
          } : source);
        }
        return [...merged.values()];
      });
      setSourceErrors((current) => [...current.filter((error) => !result.errors?.includes(error)), ...(result.errors ?? [])]);
      // Keep the server's advanced cursor even for an all-failed batch (503).
      // This preserves current listings and prevents repeatedly hitting the
      // same unavailable page range.
      setNextArbeitnowPage(result.nextArbeitnowPage ?? null);
      setNextJobicyCursor(result.nextJobicyCursor ?? null);
      if (!response.ok) throw new Error(result.error ?? "Could not load more jobs.");
      fetchedMore = result.jobs ?? [];
      const discoveredMore = result.discoveredJobs ?? fetchedMore;
      setLiveJobs((current) => {
        const seen = new Set(current.map((job) => job.sourceUrl ?? job.id));
        return [...current, ...discoveredMore.filter((job) => !seen.has(job.sourceUrl ?? job.id))].slice(-MAX_LOCAL_JOB_POOL);
      });
      const assessWithCurrentContext = localDecisionScreeningReady && searchGeneration === aiMatchGeneration.current;
      if (!assessWithCurrentContext || !fetchedMore.length) {
        const moreSources = [result.nextArbeitnowPage !== null && result.nextArbeitnowPage !== undefined ? "Arbeitnow" : "", result.nextJobicyCursor ? "Jobicy" : ""].filter(Boolean);
        setSourceMessage(`Loaded ${fetchedMore.length} more listings. ${moreSources.length ? `More pages are available from ${moreSources.join(" and ")}.` : "No further pages are available."} ${assessWithCurrentContext ? "" : "Local decision screening is unavailable; listings remain visible."}`);
        return;
      }
      const previouslyScreened = liveJobs.filter((job) => job.screening?.model === matchingSettings.decisionModel).map((job) => job.sourceUrl ?? job.id);
      const candidates = jobsToAssess(fetchedMore.filter((job) => matchesPreferredLocation(job.location, profile.locations, job.mode, job.source, job.sourceLocationScope)
        && (!profile.roles.trim() || matchesTargetRole(job, profile.roles))), previouslyScreened);
      const generation = ++aiMatchGeneration.current;
      const controller = new AbortController();
      aiMatchAbortController.current = controller;
      const outcome = await assessJobsLocally(candidates, controller.signal);
      if (generation !== aiMatchGeneration.current) return;
      const analyzed = fetchedMore.map((job) => ({ ...job,
        ...(outcome.screeningById.has(job.id) ? { screening: outcome.screeningById.get(job.id) } : {}),
      }));
      setLiveJobs((current) => current.map((job) => analyzed.find((item) => item.id === job.id) ?? job));
      setCvAnalyzedModel(matchingSettings.decisionModel);
      const moreSources = [result.nextArbeitnowPage !== null && result.nextArbeitnowPage !== undefined ? "Arbeitnow" : "", result.nextJobicyCursor ? "Jobicy" : ""].filter(Boolean);
      setSourceMessage(`Loaded ${fetchedMore.length} more listings. Screened ${outcome.screenedCount} of ${candidates.length}. ${outcome.error || (outcome.cancelled ? "Assessment cancelled." : "Scores are estimates, not hiring probabilities.")} Detailed reviews run only when requested from a job. ${moreSources.length ? `More pages are available from ${moreSources.join(" and ")}.` : "No further pages are available."}`);
    } catch (error) {
      if (fetchedMore.length) setSourceMessage(`Loaded ${fetchedMore.length} more listings, but local screening failed: ${error instanceof Error ? error.message : "unknown error"}.`);
      else setSourceMessage(error instanceof Error ? error.message : "Could not load more jobs.");
    } finally {
      aiMatchAbortController.current = null;
      setAiMatchProgress(null);
      setLoadingMoreJobs(false);
      moreJobsInFlight.current = false;
    }
  }

  useEffect(() => {
    fetchMoreJobsRef.current = fetchMoreJobs;
  });

  useEffect(() => {
    if (!stateLoaded || loadingJobs || loadingMoreJobs || aiMatchProgress || automaticPageBatchesRemaining.current <= 0
      || (nextArbeitnowPage === null && nextJobicyCursor === null)) return;
    automaticPageBatchesRemaining.current -= 1;
    void fetchMoreJobsRef.current();
  }, [stateLoaded, loadingJobs, loadingMoreJobs, aiMatchProgress, nextArbeitnowPage, nextJobicyCursor]);

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
        <button className={`nav-item ${activeView === "all-found" ? "active" : ""}`} onClick={() => setActiveView("all-found")}><span>◎</span> All found jobs <b className="nav-count">{allFoundJobs.length}</b></button>
        <button className={`nav-item ${activeView === "applications" ? "active" : ""}`} onClick={() => setActiveView("applications")}><span>▤</span> Applications <b className="nav-count">{applicationJobs.length}</b></button>
        <button className="nav-item" onClick={openProfile}><span>♧</span> Candidate profile</button>
        <div className="sidebar-bottom">
          <div className="local-status"><i /> Local workspace <span>●</span></div>
          <button className="profile-chip profile-chip-button" onClick={openProfile}><div className="avatar">{profile.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</div><div><strong>{profile.name}</strong><small>Private to this device</small></div><span className="more">···</span></button>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> {activeView === "applications" ? "Applications" : activeView === "all-found" ? "All found jobs" : "Overview"}</div><div className="topbar-right"><span className="privacy-pill"><i /> LOCAL APP</span><button className="icon-button" aria-label="Edit candidate profile" onClick={openProfile}>⚙</button><div className="avatar small">{profile.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</div></div></header>
        <div className="content">
          {activeView === "applications" ? (
            <>
              <div className="greeting-row"><div><div className="eyebrow">YOUR JOB SEARCH</div><h1>Applications <span>tracker.</span></h1><p className="subheading">Track saved roles and move each one through your review process.</p></div><button className="primary-button" onClick={() => setActiveView("overview")}>＋ Find jobs</button></div>
              <div className="application-summary"><strong>{applicationJobs.length}</strong><span>roles in your tracker</span><span className="summary-divider"/><span>{applicationGroups.find((group) => group.title === "Applied")?.items.length ?? 0} applied</span><span>{saved.length} saved</span><span>{followUpJobs.length} follow-ups</span>{overdueFollowUps > 0 && <span className="follow-up-overdue-count">{overdueFollowUps} overdue</span>}</div>
              <div className="application-board">{applicationGroups.map((group) => <section className="application-column" key={group.title}><div className="application-column-heading"><h2>{group.title}</h2><span>{group.items.length}</span></div>{group.items.length ? group.items.map((job) => <article className="application-card" key={job.id}><div className="application-company"><div className={`company-logo logo-${job.source.toLowerCase()}`}>{job.company.slice(0, 1)}</div><div><strong>{job.company}</strong><span>{job.location}</span></div></div><h3>{job.role}</h3><div className="follow-up-row"><label>Follow-up date<input type="date" aria-label={`Set follow-up date for ${job.company} — ${job.role}`} value={applicationFollowUps[job.id] ?? ""} onChange={(event) => updateFollowUp(job.id, event.target.value)}/></label>{applicationFollowUps[job.id] && <span className={`follow-up-badge ${applicationFollowUps[job.id] < todayKey ? "overdue" : applicationFollowUps[job.id] === todayKey ? "today" : "upcoming"}`}>{followUpLabel(applicationFollowUps[job.id])}</span>}</div><details className="application-notes"><summary>{applicationNotes[job.id]?.trim() ? "Edit notes" : "Add a note"}</summary><label><span className="visually-hidden">Notes for {job.role} at {job.company}</span><textarea maxLength={2000} rows={3} value={applicationNotes[job.id] ?? ""} onChange={(event) => setApplicationNotes((current) => ({ ...current, [job.id]: event.target.value }))} placeholder="Interview details, next steps, or why you saved this role…"/></label></details><div className="application-card-footer"><span>{job.source}</span><select aria-label={`Update ${job.company} application status`} value={status[job.id] ?? "Needs review"} onChange={(event) => setStatus((current) => ({ ...current, [job.id]: event.target.value as ApplicationStatus }))}><option>Needs review</option><option>Approved to prepare</option><option>Applied</option><option>Rejected</option></select></div></article>) : <p className="application-empty">No roles here yet.</p>}</section>)}</div>
              <p className="application-footnote">Status changes, notes, and follow-up dates are saved on this device. Follow-up dates appear here as reminders; no notification is sent. “Applied” is a manual record; Jobpilot never submits applications.</p>
            </>
          ) : activeView === "all-found" ? <>
            <div className="greeting-row"><div><div className="eyebrow">PUBLIC FEED DISCOVERIES</div><h1>All found <span>jobs.</span></h1><p className="subheading">{allFoundJobs.length} normalized listings returned before Jobpilot’s title and location filters.</p></div><button className="primary-button" onClick={searchWithPreferences} disabled={!stateLoaded || loadingJobs || loadingMoreJobs}><span>＋</span> {loadingJobs ? "Searching feeds…" : loadingMoreJobs ? "Loading more…" : "Search jobs"}</button></div>
            <div className="found-jobs-notice"><strong>This view shows every listing returned by enabled feeds.</strong><span>Some providers apply their own search scope (for example, Jobicy is queried by selected region). Jobpilot scores only listings that fit your selected titles and locations; each listing shows which preference excluded it.</span></div>
            {(loadingJobs || loadingMoreJobs) && <p className="source-message" role="status">{loadingMoreJobs ? "Loading another provider batch; current discoveries stay visible…" : "Searching enabled public feeds…"}</p>}
            {sourceErrors.length > 0 && <ul className="source-errors" role="status">{sourceErrors.map((error) => <li key={error}>{error}</li>)}</ul>}
            <div className="found-jobs-controls"><label className="search-box"><span>⌕</span><input aria-label="Search all found jobs" placeholder="Search all found titles, companies, or locations…" value={foundQuery} onChange={(event) => { setFoundQuery(event.target.value); setFoundVisibleCount(50); }} /></label><span>Showing {visibleFoundJobs.length} of {filteredFoundJobs.length}</span></div>
            {visibleFoundJobs.length > 0 ? <div className="found-jobs-list">{visibleFoundJobs.map((job) => {
              const locationMatches = matchesPreferredLocation(job.location, profile.locations, job.mode, job.source, job.sourceLocationScope);
              const roleMatches = !profile.roles.trim() || matchesTargetRole(job, profile.roles);
              const matchesPreferences = locationMatches && roleMatches;
              const excludedBy = [!roleMatches ? "title" : "", !locationMatches ? "location" : ""].filter(Boolean).join(" and ");
              return <article className="found-job-row" key={job.id}>
                <div className="found-job-heading"><div><h2>{job.role}</h2><p>{job.company} <span>·</span> {job.location}{job.locationEvidence ? " (snippet mention; unverified)" : ""}</p></div><span className={`found-job-status ${matchesPreferences ? "included" : "excluded"}`}>{matchesPreferences ? "Included in Job matches" : `Filtered by ${excludedBy}`}</span></div>
                <div className="found-job-meta"><span>{job.listingVerification === "search-result" ? "Unverified web result · snippet only" : job.source}</span><span>{job.posted}</span><span>{job.mode}</span>{job.sourceUrl && <a href={job.sourceUrl} target="_blank" rel="noreferrer">{job.listingVerification === "search-result" ? "Open source result ↗" : "Open original posting ↗"}</a>}</div>
                <details className="found-job-description"><summary>View available description</summary><p className="job-description-text">{job.description ?? job.summary}</p></details>
              </article>;
            })}</div> : <div className="empty-state">{allFoundJobs.length ? "No found jobs match this text search." : "No provider listings have been fetched yet. Search jobs to fill this view."}</div>}
            {visibleFoundJobs.length < filteredFoundJobs.length && <button className="load-more" onClick={() => setFoundVisibleCount((count) => count + 50)}>Show more found jobs ({filteredFoundJobs.length - visibleFoundJobs.length} remaining)</button>}
            {(nextArbeitnowPage !== null || nextJobicyCursor !== null) && <button className="load-more" onClick={() => void fetchMoreJobs()} disabled={loadingMoreJobs || loadingJobs}>{loadingMoreJobs ? "Loading more jobs…" : "Load more from public feeds"}</button>}
            <footer className="page-footer"><span>JOBPILOT <b>·</b> PUBLIC FEED DISCOVERIES</span><span>Source descriptions are shown as provided; verify on the original posting.</span></footer>
          </> : <>
          <div className="greeting-row"><div><div className="eyebrow">{new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase()}</div><h1>Your next opportunity <span>starts here.</span></h1><p className="subheading">A focused view of live roles that match your preferences.</p></div><button className="primary-button" onClick={searchWithPreferences} disabled={!stateLoaded || loadingJobs || loadingMoreJobs}><span>＋</span> {loadingJobs ? "Searching feeds…" : "Search jobs"}</button></div>

          <section className="source-panel search-panel">
            <div>
              <span className="eyebrow">JOB SEARCH PREFERENCES</span>
              <strong>Choose the roles and locations you want</strong>
              <p>CV-suggested titles are ready to edit. Austria is the starting location; change it to any location. These preferences are saved on this device and used to filter and screen listings. All location-eligible jobs remain visible.</p>
            </div>
            <div className="job-search-preferences">
              <label>Job titles<textarea rows={3} value={searchRolesDraft} onChange={(event) => setSearchRolesDraft(event.target.value)} placeholder="Suggested titles from your CV appear here. Add or remove titles; separate alternatives with commas or new lines." /></label>
              <label>Preferred locations<textarea rows={2} value={searchLocationsDraft} onChange={(event) => setSearchLocationsDraft(event.target.value)} placeholder="For example: Vienna, Austria; Remote Europe. Leave blank for broad feed results." /></label>
            </div>
            <label className="optional-web-search"><input type="checkbox" checked={webSearchEnabled} onChange={(event) => setWebSearchEnabled(event.target.checked)} /><span><strong>Also search the web (optional)</strong><small>Uses Ollama Web Search with a free account and API key. Only job-title and location queries leave this computer; your CV and job descriptions stay local. Free starter usage is limited. Results are snippets and must be verified at the source.</small></span></label>
            <div className="source-controls"><button className="primary-button" disabled={!stateLoaded || loadingJobs || loadingMoreJobs} onClick={searchWithPreferences}>{loadingJobs ? "Searching job feeds…" : loadingMoreJobs ? "Loading more jobs…" : liveJobs.length ? "↻ Search jobs" : "Search jobs"}</button><span className="feed-summary">Search checks enabled public feeds{webSearchEnabled ? " and the optional web search" : ""}, then scores eligible listings with the local decision model in small batches. It automatically checks up to three additional provider batches; use “Load more” to continue. Detailed analysis only runs when you request it for a job.</span></div>
            {jobWorkflowBusy && <div className="job-workflow-status" role="status" aria-live="polite"><span className="job-workflow-spinner" aria-hidden="true"/><div><strong>{jobWorkflowHeading}</strong><p>{locationMatchedJobs.length} matching listings available · {decisionScoredCount} decision scores · {detailedAnalyzedCount} detailed reviews available. {loadingMoreJobs ? "The next listings are being fetched and decision-scored; detailed analysis stays off until requested." : nextArbeitnowPage !== null || nextJobicyCursor !== null ? "More feed pages are queued for automatic search and decision-scoring." : "The local decision model is checking the available listings."}</p></div></div>}
            {liveJobs.length > 0 && <div className="match-jobs-action"><button type="button" className="secondary-button" onClick={() => cvText.trim() ? void screenCurrentJobs() : openProfile()} disabled={cvText.trim() ? !localDecisionScreeningReady || pendingMatchCount === 0 || Boolean(aiMatchProgress) || loadingJobs || loadingMoreJobs : false}>{!cvText.trim() ? "Upload CV to score jobs" : aiMatchProgress ? "Scoring locally…" : pendingMatchCount ? `Score ${pendingMatchCount} jobs` : "All jobs scored"}</button><span>{screeningReadinessMessage ?? (pendingMatchCount ? "New listings are decision-scored automatically on this laptop." : "Every location-eligible listing has a score from the selected decision model. Choose a job and request a detailed review when you need one.")}</span></div>}
            <p className="directory-credit">Public sources are free and need no account. Coverage is limited; no no-key provider gives complete Austria-wide vacancy coverage. <a href="https://www.arbeitnow.com/blog/job-board-api" target="_blank" rel="noreferrer">Arbeitnow</a> focuses on Germany and Europe, <a href="https://remotive.com/remote-jobs/api" target="_blank" rel="noreferrer">Remotive</a> is remote-only with a 24-hour publication delay, and <a href="https://jobicy.com/jobs-rss-feed" target="_blank" rel="noreferrer">Jobicy</a> is remote-only and covers a rolling seven-day window.</p>
            {sourceStatuses.length > 0 && <ul className="feed-source-status" aria-label="Job source results">{sourceStatuses.map((source) => <li key={source.source} className={`feed-${source.state}`}><strong>{source.source}</strong><span>{source.state === "failed" ? "Unavailable" : `${source.count} matching`}</span><small>{source.message ?? `${source.fetchedCount} listings received · checked ${new Date(source.checkedAt).toLocaleTimeString()}`}</small></li>)}</ul>}
            <details className="manual-job-panel"><summary>Can’t find a posting? Add it manually</summary><p>Paste the description below. Jobpilot does not fetch job URLs because external sites may block automated imports. A URL can be saved as the original posting link.</p><form onSubmit={(event) => void addManualJob(event)}>
              <div className="manual-job-fields"><label>Job title<input required value={manualJob.role} onChange={(event) => setManualJob((current) => ({ ...current, role: event.target.value }))} /></label><label>Company<input required value={manualJob.company} onChange={(event) => setManualJob((current) => ({ ...current, company: event.target.value }))} /></label><label>Location or remote eligibility<input required value={manualJob.location} onChange={(event) => setManualJob((current) => ({ ...current, location: event.target.value }))} /></label><label>Original posting URL (optional)<input type="url" placeholder="https://…" value={manualJob.url} onChange={(event) => setManualJob((current) => ({ ...current, url: event.target.value }))} /></label></div>
              <label className="manual-description">Paste job description<textarea required rows={6} maxLength={8000} value={manualJob.description} onChange={(event) => setManualJob((current) => ({ ...current, description: event.target.value }))} placeholder="Paste the available job description here." /></label><button className="secondary-button" type="submit">Add posting for review</button>
            </form>{manualJobError && <p role="alert" className="source-error-message">{manualJobError}</p>}{manualJobMessage && <p role="status" className="source-message">{manualJobMessage}</p>}</details>
            {sourceMessage && <p className="source-message" role="status">{sourceMessage}</p>}
            {aiMatchProgress && aiMatchProgress.total > 0 && <div className="ai-assessment-progress" role="status" aria-live="polite">
              <div><span>Decision-model screening: {aiMatchProgress.completed} of {aiMatchProgress.total}</span><button type="button" className="secondary-button" onClick={cancelAiAssessment}>Cancel screening</button></div>
              <progress aria-label="CV matching progress" max={aiMatchProgress.total} value={aiMatchProgress.completed} />
            </div>}
            {cvText && <p className="source-message" role="status">CV ready for local matching · {localAiModels.includes(selectedAiModel) ? `Model: ${selectedAiModel}` : "Start Ollama and select a model to enable AI analysis"}{!isLocalJobpilotPage() && " · open Jobpilot at localhost to keep CV processing on this laptop"}</p>}
            {sourceErrors.length > 0 && <ul className="source-errors" role="status">{sourceErrors.map((error) => <li key={error}>{error}</li>)}</ul>}
            <p className="source-message" role="status">{storageMessage}</p>
          </section>

          <section className={`local-ai-panel ${localAiConnected === null ? "ai-checking" : localAiConnected ? "ai-connected" : "ai-disconnected"}`} aria-labelledby="local-ai-title" aria-live="polite">
            <div className="local-ai-heading"><div><span className="eyebrow">ON-DEVICE AI</span><h2 id="local-ai-title">Local AI status</h2><p>Ollama runs the matching models on this laptop. Optional web search sends only the job-title and location query you choose.</p></div><button type="button" className="secondary-button" onClick={() => void refreshLocalAiStatus()} disabled={checkingLocalAi}>{checkingLocalAi ? "Checking…" : "↻ Refresh status"}</button></div>
            <div className="local-ai-facts">
              <div><span>Connection</span><strong className="ai-connection"><i />{localAiConnected === null ? "Checking" : localAiConnected ? systemOneAvailable ? "Connected · decision API ready" : "Connected · decision API unavailable" : "Not connected"}</strong></div>
              <div><span>Ollama version</span><strong>{localAiRuntimeVersion ? `v${localAiRuntimeVersion}` : localAiConnected ? "Version unavailable" : "—"}</strong></div>
              <div><span>Detailed analysis and drafting model</span><select className="ai-model-picker" aria-label="Select local Ollama chat model" value={selectedAiModel} onChange={(event) => chooseLocalAiModel(event.target.value)} disabled={!localAiModels.length || aiDrafting || checkingLocalAi}><option value="">Choose an installed model</option>{localAiModels.map((model) => <option key={model} value={model}>{model}</option>)}</select><small>{selectedAiModel && localAiModelDetails[selectedAiModel]?.details ? [localAiModelDetails[selectedAiModel].details?.family, localAiModelDetails[selectedAiModel].details?.parameterSize, localAiModelDetails[selectedAiModel].details?.quantizationLevel].filter(Boolean).join(" · ") : selectedAiModel ? "Installed locally · used only for a detailed review or cover-letter request" : "Install a model with Ollama, then refresh"}</small></div>
              <div><span>Decision model for first-stage screening</span><select className="ai-model-picker" aria-label="Select local decision model" value={matchingSettings.decisionModel} onChange={(event) => chooseDecisionModel(event.target.value)} disabled={!localAiModels.length || checkingLocalAi}><option value="">Choose an installed decision model</option>{localAiModels.map((model) => <option key={model} value={model}>{model}</option>)}</select><small>{systemOneAvailable ? "Uses Ollama /v1/systemone. Jobpilot suggests installed tags named for decision or System One use; scoring starts automatically after CV upload and search. Detailed analysis runs only when requested per job." : "Requires Ollama 0.35 or newer."}</small></div>
            </div>
            <details className="matching-settings"><summary>Screening weights and review cutoff</summary>
              <p>Weighted estimate = skills × {matchingSettings.weights.skills}% + experience × {matchingSettings.weights.experience}% + domain × {matchingSettings.weights.domain}% + (1 − explicit disqualifier risk) × {matchingSettings.weights.disqualifier}%. Weights total 100%.</p>
              <div className="matching-settings-grid">{(["skills", "experience", "domain", "disqualifier"] as const).map((key) => <label key={key}>{key === "disqualifier" ? "Explicit disqualifier penalty" : `${key[0].toUpperCase()}${key.slice(1)} evidence`}<input type="number" min="0" max="100" value={matchingSettings.weights[key]} onChange={(event) => updateMatchWeight(key, Number(event.target.value))} />%</label>)}
                <label>Score treated as likely relevant in your feedback<input type="number" min="0" max="100" value={matchingSettings.relevanceScoreThreshold} onChange={(event) => setMatchingSettings((current) => ({ ...current, relevanceScoreThreshold: Math.round(Math.max(0, Math.min(100, Number(event.target.value)))) }))} />%</label>
              </div><small>This cutoff only labels score predictions in your local feedback metrics. It never starts detailed analysis automatically. Scores are estimates, not chances of getting hired.</small>
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

          <div className="section-heading"><div><h2>Job listings <span className="result-count">{filteredRanked.length}</span></h2><p>{hasAnyScreenings ? "All location-eligible jobs are shown and sorted by local decision-model fit estimate. Confidence is separate; neither is a hiring probability." : "All location-eligible jobs are shown. Until local screening finishes, keyword mentions are context only and no match score is shown."}</p></div><span className="filter-summary">Showing {visibleJobs.length} of {filteredRanked.length}</span></div>
          {(nextArbeitnowPage !== null || nextJobicyCursor !== null) && <button className="load-more" onClick={() => void fetchMoreJobs()} disabled={loadingMoreJobs || loadingJobs}>{loadingMoreJobs ? "Loading more jobs…" : "Load more jobs from public feeds"}</button>}
          <div className="jobs-layout">
            <section className="jobs-column">
              <div className="filters">
                <label className="search-box"><span>⌕</span><input id="job-search" placeholder="Search roles or companies..." value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(25); }} /></label>
                <select aria-label="Filter by posting date" value={postedWithin} onChange={(event) => { setPostedWithin(event.target.value as PostedWithin); setVisibleCount(25); }}><option value="any">Any date</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select>
                <select aria-label="Filter by work mode" value={workMode} onChange={(event) => { setWorkMode(event.target.value as WorkMode); setVisibleCount(25); }}><option value="any">Any work mode</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">On-site</option></select>
                <select aria-label="Filter by department" value={department} onChange={(event) => { setDepartment(event.target.value); setVisibleCount(25); }}><option value="">Any department</option>{departments.map((item) => <option key={item} value={item}>{item}</option>)}</select>
                <select aria-label="Filter by minimum local decision score" value={minimumScore} onChange={(event) => { setMinimumScore(Number(event.target.value)); setVisibleCount(25); }}><option value={0}>Any score (including pending)</option><option value={40}>Decision score: 40% or higher</option><option value={60}>Decision score: 60% or higher</option><option value={80}>Decision score: 80% or higher</option></select>
                <select aria-label="Sort jobs" value={sortBy} onChange={(event) => setSortBy(event.target.value as "match" | "newest" | "company")}><option value="match">Sort: Best match score</option><option value="newest">Sort: Newest</option><option value="company">Sort: Company A–Z</option></select>
                <span className="location-filter">Locations: {profile.locations || "Any"}</span>
              </div>
              {filteredRanked.length > 0 ? <>
                <div className="job-list">{visibleJobs.map(({ job, score, confidence, matched, titleMatched, roleMatch }) => <article key={job.id} className={`job-card ${selected?.job.id === job.id ? "selected" : ""}`}><button type="button" className="job-card-main" aria-pressed={selected?.job.id === job.id} onClick={() => { selectJob(job.id); setStatus((current) => current[job.id] ? current : { ...current, [job.id]: "Needs review" }); }}><div className="job-card-top"><div className={`company-logo logo-${job.source.toLowerCase()}`}>{job.company.slice(0, 1)}</div><div className="job-card-indicators"><span className="match-tag">{job.screening?.model === matchingSettings.decisionModel ? `${score}% estimate · ${confidence === null ? "confidence unavailable" : `${confidence}% confidence`}` : job.aiMatch ? `${job.aiMatch.score}% detailed estimate · ${job.aiMatch.model}` : "Match score pending"}</span>{job.screening?.model !== matchingSettings.decisionModel && !job.aiMatch && candidateSkills.length > 0 && <span className="match-context-tag" title="Exact text mentions only; not the local AI fit estimate">{matched.length} keyword {matched.length === 1 ? "match" : "matches"}</span>}{roleMatch && <span className="role-match-tag">Target role</span>}</div></div><div className="job-title">{job.role}</div><div className="company-name">{job.company} <span>·</span> {job.location}</div><div className="job-meta"><span>◷ {job.posted}</span><span>⌂ {job.mode}</span><span className="source-tag">{job.source} · {job.listingVerification === "search-result" ? "search result" : "feed"}</span></div></button><div className="job-card-bottom"><div className="skill-pills">{matched.slice(0, 3).map((skill) => <span className={titleMatched.includes(skill) ? "skill-in-title" : ""} key={skill}>{skill}{titleMatched.includes(skill) && <small>title</small>}</span>)}{matched.length > 3 && <span className="more-skills">+{matched.length - 3}</span>}</div><button type="button" className={`bookmark ${saved.includes(job.id) ? "bookmarked" : ""}`} onClick={() => setSaved((current) => current.includes(job.id) ? current.filter((id) => id !== job.id) : [...current, job.id])} aria-label={saved.includes(job.id) ? "Remove saved job" : "Save job"} aria-pressed={saved.includes(job.id)}>{saved.includes(job.id) ? "★" : "☆"}</button></div></article>)}</div>
                {visibleJobs.length < filteredRanked.length && <button className="load-more" onClick={() => setVisibleCount((count) => count + 25)}>Show more jobs <span>({filteredRanked.length - visibleJobs.length} remaining)</span></button>}
              </> : <div className="empty-state">{liveJobs.length === 0 ? "No jobs loaded yet. Select “Search jobs now” to check public job feeds." : ranked.length === 0 ? query ? "No live jobs match that search. Try another role or company." : emptyJobMessage : "No jobs match these filters. Try a different date, work mode, or department."}</div>}
            </section>

            {selected ? (
              <aside className="detail-card">
                    <div className="detail-actions">
                <span className="detail-source"><i /> {selected.job.listingVerification === "search-result" ? "Unverified web search result · snippet only" : `${selected.job.source} listing`} · <a href={selected.job.sourceAttributionUrl ?? selected.job.sourceUrl} target="_blank" rel="noreferrer">source</a></span>
                  <button className="icon-button" onClick={() => setSaved((current) => current.includes(selected.job.id) ? current.filter((id) => id !== selected.job.id) : [...current, selected.job.id])} aria-label="Save selected job">{saved.includes(selected.job.id) ? "★" : "☆"}</button>
                </div>
                <div className="detail-company"><div className={`company-logo big-logo logo-${selected.job.source.toLowerCase()}`}>{selected.job.company.slice(0, 1)}</div><div><h3>{selected.job.company}</h3><span>{selected.job.location}{selected.job.locationEvidence ? " (mentioned in snippet; unverified)" : ""} · {selected.job.mode}</span>{selected.job.department && <span>{selected.job.department}</span>}</div></div>
                <h2 className="detail-title">{selected.job.role}</h2>
                <div className="detail-sub">{selected.job.mode} <i/> Posted {selected.job.posted} {selected.job.retrievedAt && <><i/> Retrieved {new Date(selected.job.retrievedAt).toLocaleString()}</>}</div>
                <div className="detail-buttons">{selected.job.sourceUrl ? <a href={selected.job.sourceUrl} target="_blank" rel="noreferrer" className="primary-button apply-button">{selected.job.listingVerification === "search-result" ? "Review source result ↗" : "Open original posting ↗"}</a> : <a href="#job-description" className="primary-button apply-button">Review role details ↓</a>}<label className="detail-status-label">Status<select aria-label={`Application status for ${selected.job.company}`} value={status[selected.job.id] ?? "Needs review"} onChange={(event) => setStatus((current) => ({ ...current, [selected.job.id]: event.target.value as ApplicationStatus }))}><option>Needs review</option><option>Approved to prepare</option><option>Applied</option><option>Rejected</option></select></label></div>
                <div className="divider"/>
                <div className="fit-heading"><div><h4>{selected.job.screening?.model === matchingSettings.decisionModel ? "AI estimated fit" : "Local AI estimate pending"} <span className="info-dot">i</span></h4><p>{selected.job.screening?.model === matchingSettings.decisionModel ? "Local decision-model estimate; confidence shown separately" : "Exact CV skill mentions are shown below; they are not a job-match score."}</p></div><div className="score-ring" style={{ "--score": `${selected.job.screening?.model === matchingSettings.decisionModel ? selected.score : 0}%` } as React.CSSProperties}><span>{selected.job.screening?.model === matchingSettings.decisionModel ? `${selected.score}%` : "—"}</span></div></div>
                {selected.job.screening?.model === matchingSettings.decisionModel && <div className="fit-meter"><i style={{ width: `${selected.score}%` }}/></div>}
                {selected.job.screening?.model !== matchingSettings.decisionModel && <p className="fit-explanation">{candidateSkills.length ? `${selected.matched.length} exact keyword ${selected.matched.length === 1 ? "mention" : "mentions"} found among ${candidateSkills.length} profile skills. This is a text count, not a fit score. ` : "No profile skills have been extracted yet. "}{cvText.trim() ? "The local decision-model score appears when screening completes." : "Upload a CV once; its local matching excerpt will be saved so screening can run again after restart."}{selected.job.listingVerification === "search-result" ? " This is only a web-search snippet, not a verified vacancy or complete job description." : ""}</p>}
                {selected.job.screening?.model === matchingSettings.decisionModel && <section className="ai-match-explanation" aria-label="Local decision-model match estimate"><div className="ai-match-title"><h4>Local screening estimate</h4><strong>{selected.job.screening.score}% · {selected.job.screening.confidence === null ? "confidence unavailable" : `${selected.job.screening.confidence}% model confidence`} · {selected.job.screening.model}</strong></div><p>Estimated role fit, not probability of getting hired. Screening confidence controls second-stage review and is not the same as the fit score.</p><div className="screening-breakdown">{Object.entries(selected.job.screening.breakdown).map(([key, value]) => <span key={key}>{key}: {value === null ? "missing" : `${value}%`}</span>)}<span>Explicit disqualifier risk: {selected.job.screening.disqualifierRisk === null ? "missing" : `${selected.job.screening.disqualifierRisk}%`}</span><span>Information: {selected.job.screening.informationStatus.replaceAll("_", " ")}</span></div><small>Score weights: skills {matchingSettings.weights.skills}%, experience {matchingSettings.weights.experience}%, domain {matchingSettings.weights.domain}%, disqualifier penalty {matchingSettings.weights.disqualifier}%.</small><small>AI estimates can be wrong. Verify the original posting and every requirement.</small>{hasCurrentCvAssessment && <div className="match-review-controls"><span>Your review: {selectedMatchReview ? selectedMatchReview.reviewedRelevant ? "Relevant" : "Not relevant" : "Not reviewed"}</span><div><button type="button" className={selectedMatchReview?.reviewedRelevant === true ? "selected-review" : ""} aria-pressed={selectedMatchReview?.reviewedRelevant === true} onClick={() => reviewSelectedMatch(true)}>Relevant</button><button type="button" className={selectedMatchReview?.reviewedRelevant === false ? "selected-review" : ""} aria-pressed={selectedMatchReview?.reviewedRelevant === false} onClick={() => reviewSelectedMatch(false)}>Not relevant</button></div></div>}</section>}
                <section className="detailed-analysis-action" aria-label="Detailed local analysis controls">
                  <button type="button" className="secondary-button" onClick={() => void analyzeJobInDetail(selected.job)} disabled={Boolean(detailedAnalysisJobId)}>{detailedAnalysisJobId === selected.job.id ? "Analyzing this job on this laptop…" : selected.job.detailedAnalysis ? "Run detailed analysis again" : "Analyze this job in detail"}</button>
                  <p>Uses the selected local chat model only for this job when requested. The first-stage score stays separate.</p>
                  {detailedAnalysisError?.jobId === selected.job.id && <p className="source-error-message" role="alert">{detailedAnalysisError.message}</p>}
                  {detailedAnalysisJobId && detailedAnalysisJobId !== selected.job.id && <p role="status">A detailed review for another job is still running.</p>}
                </section>
                {selected.job.detailedAnalysis && <section className="ai-match-explanation detailed-analysis" aria-label="Detailed local CV and job evidence"><div className="ai-match-title"><h4>Detailed local analysis</h4><strong>{selected.job.aiMatch?.score !== undefined ? `${selected.job.aiMatch.score}% detailed estimate · ` : ""}{selected.job.aiMatch?.model ?? selected.job.detailedAnalysis.model}</strong></div><p>{selected.job.aiMatch?.reason ?? selected.job.detailedAnalysis.summary}</p>{selected.job.detailedAnalysis.matchedRequirements.length > 0 && <><h5>Matched requirements</h5><ul>{selected.job.detailedAnalysis.matchedRequirements.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></>}{selected.job.detailedAnalysis.gaps.length > 0 && <><h5>Gaps or unclear requirements</h5><ul>{selected.job.detailedAnalysis.gaps.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></>}{selected.job.detailedAnalysis.evidence.map((item, index) => <blockquote key={`${index}-${item.requirement}`}><strong>{item.requirement}</strong><br/><b>CV:</b> “{item.cvQuote}”<br/><b>Job:</b> “{item.jobQuote}”</blockquote>)}</section>}
                <div className="evidence-label">PROFILE SKILLS MENTIONED IN POSTING <span>{selected.matched.length} found</span></div>
                <div className="evidence-pills">{selected.matched.map((skill) => <span key={skill}>✓ {skill}{selected.titleMatched.includes(skill) && <small> · title</small>}</span>)}</div>
                {selected.missing.length > 0 && <><div className="evidence-label gap-label">PROFILE SKILLS NOT MENTIONED <span>{selected.missing.length}</span></div><div className="evidence-pills missing-pills">{selected.missing.map((skill) => <span key={skill}>! {skill}</span>)}</div><p className="match-caveat">A skill missing from the posting text is not proof that the job requires it.</p></>}
                <div className="divider"/>
                <div id="job-description" className="description"><h4>{selected.job.descriptionKind === "search-snippet" ? "Search result snippet" : "Job description"}</h4><p className="job-description-text">{selected.job.description ?? selected.job.summary}</p>{selected.job.descriptionKind === "search-snippet" && <small>Ollama Web Search returns a short excerpt. Employer, location, availability, and full requirements have not been verified; open the source result before deciding.</small>}{selected.job.locationEvidence && <small>Location preference appeared in the search snippet; confirm it on the source page.</small>}</div>
                <section className="cover-letter-draft" key={selected.job.id}>
                  <div className="cover-letter-heading"><div><h4>Cover letter draft</h4><p>Build an editable first draft for this role.</p></div><button type="button" className="secondary-button" onClick={() => setCoverLetterOpen((open) => !open)}>{coverLetterOpen ? "Close" : "Create draft"}</button></div>
                  {coverLetterOpen && <>
                    <p className="cover-letter-help">Add a reason and a specific, truthful experience example. AI drafting runs through Ollama on this laptop. Review every claim before use.</p>
                    <label>Why are you interested in this role or company?<textarea rows={2} maxLength={2000} value={selectedCoverLetter?.interest ?? ""} onChange={(event) => updateSelectedCoverLetter({ interest: event.target.value })} placeholder="Add a specific reason…" /></label>
                    <label>Relevant example and outcome from your experience<textarea rows={2} maxLength={4000} value={selectedCoverLetter?.evidence ?? ""} onChange={(event) => updateSelectedCoverLetter({ evidence: event.target.value })} placeholder="Describe your contribution and the result…" /></label>
                    <label className="local-model-select">Local AI model<select value={selectedAiModel} onChange={(event) => chooseLocalAiModel(event.target.value)} disabled={!localAiModels.length || aiDrafting}><option value="">Choose an installed model</option>{localAiModels.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
                    <div className="cover-letter-preferences"><label>AI draft tone<select value={selectedCoverLetter?.preferences?.tone ?? "professional"} onChange={(event) => updateSelectedCoverLetter({ preferences: { ...(selectedCoverLetter?.preferences ?? { tone: "professional", language: "English", length: "concise" }), tone: event.target.value as "professional" | "warm" | "direct" } })}><option value="professional">Professional</option><option value="warm">Warm</option><option value="direct">Direct</option></select></label><label>AI draft language<select value={selectedCoverLetter?.preferences?.language ?? "English"} onChange={(event) => updateSelectedCoverLetter({ preferences: { ...(selectedCoverLetter?.preferences ?? { tone: "professional", language: "English", length: "concise" }), language: event.target.value as "English" | "German" } })}><option>English</option><option>German</option></select></label><label>AI draft length<select value={selectedCoverLetter?.preferences?.length ?? "concise"} onChange={(event) => updateSelectedCoverLetter({ preferences: { ...(selectedCoverLetter?.preferences ?? { tone: "professional", language: "English", length: "concise" }), length: event.target.value as "concise" | "standard" } })}><option value="concise">Concise</option><option value="standard">Standard</option></select></label></div>
                    <p className="cover-letter-help">Cover-letter drafting uses your profile and notes. CV text is used only for local job matching, not sent with a cover-letter request.</p>
                    {localAiStatus && <p className="cover-letter-message" role="status">{localAiStatus}</p>}
                    <div className="cover-letter-actions"><button type="button" className="primary-button cover-letter-generate" onClick={() => void generateAiCoverLetter()} disabled={!localAiModels.includes(selectedAiModel) || aiDrafting}>{aiDrafting ? "Generating locally…" : "Generate on this laptop"}</button><button type="button" className="secondary-button cover-letter-generate" onClick={buildCoverLetter}>Use simple template</button></div>
                    {selectedCoverLetter?.draft && <><label>Draft text<textarea rows={11} maxLength={20000} value={selectedCoverLetter.draft} onChange={(event) => updateSelectedCoverLetter({ draft: event.target.value })} /></label>{selectedCoverLetter.claimAudit ? <div className="claim-audit" aria-label="Cover letter source check"><strong>Source-text check · manual review still required</strong><p>{selectedCoverLetter.claimAudit.verifiedClaims.length} quoted claims matched your supplied profile or notes. This confirms the text exists; it does not prove the claim is accurate.</p>{selectedCoverLetter.claimAudit.verifiedClaims.map((item, index) => <blockquote key={`${index}-${item.claim}`}><b>{item.claim}</b><br/>Source ({item.source.replaceAll("-", " ")}): “{item.sourceQuote}”</blockquote>)}{selectedCoverLetter.claimAudit.unverifiedClaims.length > 0 && <><p>Claims without a matching source quote:</p><ul>{selectedCoverLetter.claimAudit.unverifiedClaims.map((claim, index) => <li key={`${index}-${claim}`}>{claim}</li>)}</ul></>}</div> : <p className="cover-letter-help">No source check is attached to this edited or template draft. Review all statements against your experience.</p>}<div className="cover-letter-actions"><button type="button" className="secondary-button" onClick={() => void copyCoverLetter()}>Copy</button><button type="button" className="secondary-button" onClick={downloadCoverLetter}>Download .txt</button></div><p className="cover-letter-help">Saved on this device · Updated {new Date(selectedCoverLetter.updatedAt).toLocaleString()}</p></>}
                    {coverLetterMessage && <p className="cover-letter-message" role="status">{coverLetterMessage}</p>}
                  </>}
                </section>
                <section className="application-kit" aria-labelledby="application-kit-title">
                  <div className="cover-letter-heading"><div><h4 id="application-kit-title">Application preparation</h4><p>Prepare details for the employer form; review and submit there yourself.</p></div><button type="button" className="secondary-button" onClick={() => void copyApplicationPacket()}>Copy application packet</button></div>
                  <p className="ats-detection">For supported ATS pages, install the optional local Chrome/Edge extension using the steps in the README. Open the employer page and click the extension to fill recognized empty fields.</p>
                  {(() => { const guide = detectAtsPlatform(selected.job.sourceUrl); return <>
                    <p className="ats-detection">Detected application platform: <strong>{guide.label}</strong>{guide.platform !== "unknown" ? " · detected from the posting URL" : " · could not identify it from the posting URL"}</p>
                    <ul className="ats-checklist">{guide.preparation.map((item) => <li key={item}>{item}</li>)}</ul>
                  </>; })()}
                  <div className="application-packet-preview"><strong>Ready to copy</strong><span>{profile.name || "Name not provided"}</span>{profile.email && <span>{profile.email}</span>}{profile.phone && <span>{profile.phone}</span>}{profile.linkedin && <span>{profile.linkedin}</span>}{profile.portfolio && <span>{profile.portfolio}</span>}{profile.workAuthorization && <span>Work eligibility: {profile.workAuthorization}</span>}<small>{selectedCoverLetter?.draft ? "Includes your saved cover-letter draft." : "Create a cover-letter draft above to include it."} CV files are not stored; upload your CV on the employer&apos;s site.</small></div>
                  {applicationKitMessage && <p className="cover-letter-message" role="status">{applicationKitMessage}</p>}
                  <button type="button" className="text-button" onClick={openProfile}>Edit application contact details</button>
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
          <details className="cv-text-details"><summary>View saved CV matching excerpt</summary><pre>{(cvSuggestions.sourceText ?? "").slice(0, 12_000)}</pre>{(cvSuggestions.sourceText?.length ?? 0) > 12_000 && <small>Preview limited to 12,000 characters. Job matching uses a locally saved excerpt of up to 10,000 characters.</small>}</details>
          <button type="button" className="secondary-button" onClick={removeSavedCvEvidence}>Remove saved CV matching text</button>
          <p className="cv-file-hint">Your preferred location was not inferred from the CV. Profile role and skill fields below were filled automatically and can be edited. Matching uses the locally saved CV excerpt, not the keyword count shown on each job.</p>
        </div>}
      </section><label>Display name<input value={profileDraft.name} onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })}/></label><label>Target roles<span className="field-hint">Enter the roles you want to apply for, separated by commas or new lines. Filled automatically from your CV analysis; edit this list to steer job discovery.</span><textarea rows={2} value={profileDraft.roles} onChange={(event) => setProfileDraft({ ...profileDraft, roles: event.target.value })}/></label><label>Preferred locations<span className="field-hint">Enter locations explicitly, for example Austria or Vienna, Austria. Separate alternatives with semicolons. Leave blank to show any location. A bare “Remote” listing is excluded unless you choose Remote; broad “Europe” or “EMEA” remote listings require the explicit preference Remote Europe.</span><textarea rows={2} value={profileDraft.locations} onChange={(event) => setProfileDraft({ ...profileDraft, locations: event.target.value })}/></label><label>Skills <span className="field-hint">Filled automatically from your CV analysis. Edit these keywords to steer job discovery; local AI also compares the CV text with each job description.</span><textarea rows={4} value={profileDraft.skills} onChange={(event) => setProfileDraft({ ...profileDraft, skills: event.target.value })}/></label><section className="application-contact-fields"><h3>Application contact details</h3><p>Optional details for your copyable application packet. They stay in the local Jobpilot data file.</p><label>Email<input type="email" maxLength={320} autoComplete="email" value={profileDraft.email ?? ""} onChange={(event) => setProfileDraft({ ...profileDraft, email: event.target.value })}/></label><label>Phone<input type="tel" maxLength={100} autoComplete="tel" value={profileDraft.phone ?? ""} onChange={(event) => setProfileDraft({ ...profileDraft, phone: event.target.value })}/></label><label>LinkedIn profile<input type="url" maxLength={2048} value={profileDraft.linkedin ?? ""} onChange={(event) => setProfileDraft({ ...profileDraft, linkedin: event.target.value })}/></label><label>Portfolio or personal website<input type="url" maxLength={2048} value={profileDraft.portfolio ?? ""} onChange={(event) => setProfileDraft({ ...profileDraft, portfolio: event.target.value })}/></label><label>Work authorization or eligibility<textarea rows={2} maxLength={1000} value={profileDraft.workAuthorization ?? ""} onChange={(event) => setProfileDraft({ ...profileDraft, workAuthorization: event.target.value })} placeholder="Add only if you want this in your application packet"/></label></section><div className="modal-actions"><button className="secondary-button" onClick={() => setProfileDraft(defaultProfile)}>Reset default profile</button><button className="primary-button" onClick={saveProfileDraft}>Save profile</button></div><section className="data-backup" aria-label="Profile and job data backup"><div><strong>Data backup</strong><p>Download a copy of your profile and job tracker, or restore a previous backup.</p></div><div className="data-backup-actions"><button type="button" className="secondary-button" onClick={downloadBackup}>Download backup</button><button type="button" className="secondary-button" onClick={() => backupInput.current?.click()} disabled={backupBusy}>{backupBusy ? "Restoring…" : "Restore backup"}</button><input ref={backupInput} className="visually-hidden" type="file" accept="application/json,.json" aria-label="Choose Jobpilot backup file" onChange={(event) => void restoreBackup(event)}/></div>{backupMessage && <p role="status">{backupMessage}</p>}</section><p className="privacy-explainer">Scanned PDF page images are processed by Tesseract on this laptop; temporary image files are deleted immediately. The original CV file is not saved. A matching excerpt of up to 10,000 extracted characters and its analysis are saved in the unencrypted local state file so scores can run after a restart. This text is sent only to Ollama on this laptop. Use ‘Remove saved CV matching text’ to delete it; your editable role and skill fields remain.</p></section></div>}
    </main>
  );
}
