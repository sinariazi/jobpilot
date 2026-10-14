Warning: truncated output (original token count: 36126)
Total output lines: 1565

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ApplicationStatus, CandidateProfile, CoverLetterDraftRecord, Job, MatchReview, PersistedState, MatchingSettings, MatchWeights } from "@/lib/types";
import { defaultProfile } from "@/lib/types";
import { jobsForReview, matchesTargetRole, scoreJob } from "@/lib/matcher";
import { matchesEligibleRemoteLocation, matchesPreferredLocation } from "@/lib/locations";
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
import { composeTailoredCvText, renderTailoredCvHtml, tailoredCvFilename, type VerifiedCvTailoring } from "@/lib/cv-tailoring";
import { mergeJobPool } from "@/lib/job-pool";
import { addSearchMatches, applyDetailedAnalysisToSearchMatches, applyScreeningsToSearchMatches, hasSearchMatch, mergeSearchMatchesIntoPool, searchPreferenceKey, snapshotSearchMatches, type SearchMatchSnapshot } from "@/lib/search-match-snapshot";

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
  const [screeningErrors, setScreeningErrors] = useState<Record<string, string>>({});
  const [detailedAnalysisJobId, setDetailedAnalysisJobId] = useState("");
  const [detailedAnalysisError, setDetailedAnalysisError] = useState<{ jobId: string; message: string } | null>(null);
  const [cvTailoringJobId, setCvTailoringJobId] = useState("");
  const [cvTailoringError, setCvTailoringError] = useState<{ jobId: string; message: string } | null>(null);
  const [tailoredCvDraft, setTailoredCvDraft] = useState<{ jobId: string; role: string; text: string; verifiedText: string; result: VerifiedCvTailoring } | null>(null);
  const [nextArbeitnowPage, setNextArbeitnowPage] = useState<number | null>(null);
  const [nextJobicyCursor, setNextJobicyCursor] = useState<string | null>(null);
  const [searchMatchSnapshot, setSearchMatchSnapshot] = useState<SearchMatchSnapshot | null>(null);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [storageMessage, setStorageMessage] = useState("Loading saved data from this device…");
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const skipNextStateAutosave = useRef(false);
  const aiMatchAbortController = useRef<AbortController | null>(null);
  const detailedAnalysisAbortController = useRef<AbortController | null>(null);
  const cvTailoringAbortController = useRef<AbortController | null>(null);
  const aiMatchGeneration = useRef(0);
  const activeSearchPreferenceKey = useRef("");
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
  // The API's filtered `jobs` may contain rows absent from its broad discovery
  // pool or the bounded local pool. Keep confirmed matches visible; richer
  // local copies with scores override the unscored API copies.
  const jobs = useMemo(() => mergeSearchMatchesIntoPool(liveJobs, searchMatchSnapshot), [liveJobs, searchMatchSnapshot]);
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
            const migration = await fetch("/api/state?includeState=1", {
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
              strengths: analysis.strengths ?? [],
              improvements: analysis.improvements ?? [],
              topRecommendation: analysis.topRecommendation ?? "",
            } } : {}),
          });
          setCvMessage("Restored the locally saved CV excerpt and analysis. The original CV file was not saved.");
        }
        selectJob(restored.liveJobs?.[0]?.id ?? "");
        setStorageMessage(migrated ? "Existing browser data moved to a private local file." : "Saved on this device.");
        skipNextStateAutosave.current = true;
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
    // Scoring updates the pool once per small batch. Saving the full pool for
    // each batch created a queue of multi-megabyte PUTs that could take many
    // minutes. Keep the UI live and persist one settled snapshot afterwards.
    if (!stateLoaded || aiMatchProgress) return;
    // Loading the saved state is not a user change. Avoid sending the entire
    // restored pool back to the server on every page load or browser tab.
    if (skipNextStateAutosave.current) {
      skipNextStateAutosave.current = false;
      return;
    }
    let cancelled = false;
    const snapshot = {
      profile, saved, status, applicationNotes, applicationFollowUps, coverLetterDrafts, matchReviews, matchCohortKey, matchingSettings,
      // Provider descriptions can be much larger than needed for the saved pool.
      liveJobs: liveJobs.map((job) => ({
        ...job,
        summary: job.summary.slice(0, 4000),
        ...(job.description ? { description: job.description.slice(0, 8000) } : {}),
      })),
      webSearchEnabled,
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
        const result = await response.json().catch(() => null) as { error?: string; warning?: string } | null;
        if (!response.ok) throw new Error(result?.error ?? "Could not save local data.");
        return result?.warning;
      }).then((warning) => {
        if (!cancelled) setStorageMessage(warning ?? "Saved on this device.");
      }).catch((error: unknown) => {
        if (!cancelled) setStorageMessage(error instanceof Error ? error.message : "Could not save local data.");
      });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [profile, saved, status, applicationNotes, applicationFollowUps, coverLetterDrafts, matchReviews, matchCohortKey, matchingSettings, liveJobs, webSearchEnabled, cvText, cvFileName, cvSuggestions, stateLoaded, aiMatchProgress]);

  const currentSearchPreferenceKey = searchPreferenceKey(profile.locations, profile.roles);
  useEffect(() => {
    activeSearchPreferenceKey.current = currentSearchPreferenceKey;
  }, [currentSearchPreferenceKey]);
  const confirmedSearchMatches = useMemo(() => new Set(
    searchMatchSnapshot?.preferenceKey === currentSearchPreferenceKey ? searchMatchSnapshot.listingKeys : [],
  ), [searchMatchSnapshot, currentSearchPreferenceKey]);
  const locationMatchedJobs = useMemo(() => jobs.filter((job) => {
    if (job.source === "Manual") return true;
    if (confirmedSearchMatches.has(job.sourceUrl ?? job.id)) return true;
    const locationMatches = matchesPreferredLocation(job.location, profile.locations, job.mode, job.source, job.sourceLocationScope)
      || matchesEligibleRemoteLocation(job.location, profile.locations, job.mode);
    return locationMatches && (!profile.roles.trim() || matchesTargetRole(job, profile.roles));
  }), [jobs, profile.locations, profile.roles, confirmedSearchMatches]);
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
    const candidateIds = new Set(candidates.map((job) => job.id));
    setScreeningErrors((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !candidateIds.has(id))));
    setAiMatchProgress({ completed: 0, total: candidates.length });
    for (let offset = 0; offset < candidates.length; offset += AI_MATCH_BATCH_SIZE) {
      if (signal.aborted) { cancelled = true; break; }
      const batch = candidates.slice(offset, offset + AI_MATCH_BATCH_SIZE);
      setSourceMessage(`Local decision model screening ${Math.min(offset + batch.length, candidates.length)} of ${candidates.length} jobs…`);
      const settled = await Promise.allSettled(batch.map(async (job) => {
          const response = await fetch("/api/jobs/screen", {
            method: "POST", headers: { "Content-Type": "application/json" }, signal,
            body: JSON.stringify({ model: matchingSettings.decisionModel, cvText: cvForModel.slice(0, 15_000), weights: matchingSettings.weights, preferences: { locations: profile.locations, targetRoles: profile.roles }, job: { company: job.company, role: job.role, location: job.location, mode: job.mode, description: (job.description ?? job.summary).slice(0, 12_000) } }),
          });
          const result = await response.json() as { screening?: NonNullable<Job["screening"]>; error?: string };
          if (!response.ok || !result.screening) throw new Error(result.error ?? "Local decision screening failed.");
          return { job, screening: result.screening };
        }));
      const screened = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const failed = settled.flatMap((result, index) => result.status === "rejected" ? [{ job: batch[index], message: result.reason instanceof Error ? result.reason.message : "Local screening failed." }] : []);
      for (const { job, screening } of screened) screeningById.set(job.id, screening);
      screenedCount += screened.length;
      if (failed.length && !signal.aborted) {
        const messages = [...new Set(failed.map((item) => item.message))];
        const batchError = `${failed.length} ${failed.length === 1 ? "job score could not be calculated" : "job scores could not be calculated"}: ${messages.slice(0, 2).join(" · ")}`;
        error = [error, batchError].filter(Boolean).join(" · ");
        setScreeningErrors((current) => ({ ...current, ...Object.fromEntries(failed.map((item) => [item.job.id, item.message])) }));
      }
      if (screened.length) {
        const succeededIds = new Set(screened.map(({ job }) => job.id));
        setScreeningErrors((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !succeededIds.has(id))));
        setLiveJobs((current) => current.map((item) => screeningById.has(item.id) ? { ...item, screening: screeningById.get(item.id), aiMatch: undefined, detailedAnalysis: undefined } : item));
        // API-confirmed jobs can be retained only in the search snapshot when
        // the broad provider pool is capped. Update those copies too, or the
        // visible cards keep saying “Match score pending” after HTTP 200.
        setSearchMatchSnapshot((current) => applyScreeningsToSearchMatches(current, screeningById));
      }
      setAiMatchProgress({ completed: Math.min(offset + batch.length, candidates.length), total: candidates.length });
      if (signal.aborted) { cancelled = true; break; }
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
    if (detailedAnalysisAbortController.current) {
      detailedAnalysisAbortController.current.abort();
      detailedAnalysisAbortController.current = null;
      setDetailedAnalysisJobId("");
    }
    const controller = new AbortController();
    detailedAnalysisAbortController.current = controller;
    setDetailedAnalysisJobId(job.id);
    const timeout = window.setTimeout(() => {
      controller.abort(new DOMException("The local model took too long to respond.", "TimeoutError"));
    }, 90_000);
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
      const detailResult = { aiMatch, detailedAnalysis: match.detailedAnalysis };
      setLiveJobs((current) => {
        const existsInPool = current.some((item) => item.id === job.id);
        return existsInPool
          ? current.map((item) => item.id === job.id ? { ...item, ...detailResult } : item)
          : mergeJobPool(current, [{ ...job, ...detailResult }], MAX_LOCAL_JOB_POOL);
      });
      // Server-filtered jobs can exist only in the search snapshot (outside
      // the bounded persisted discovery pool). Update that copy too so the
      // selected detail panel renders the successful model response.
      setSearchMatchSnapshot((current) => applyDetailedAnalysisToSearchMatches(current, job.id, detailResult));
    } catch (error) {
      if (controller.signal.aborted) {
        if (controller.signal.reason instanceof DOMException && controller.signal.reason.name === "TimeoutError") {
          setDetailedAnalysisError({ jobId: job.id, message: "The local model took longer than 90 seconds and the request was stopped. Check Local AI status, select a smaller chat model, or try again." });
        }
      } else {
        setDetailedAnalysisError({ jobId: job.id, message: error instanceof Error ? error.message : "Detailed local analysis failed." });
      }
    } finally {
      window.clearTimeout(timeout);
      if (detailedAnalysisAbortController.current === controller) detailedAnalysisAbortController.current = null;
      setDetailedAnalysisJobId((current) => current === job.id ? "" : current);
    }
  }

  async function tailorCvForJob(job: Job) {
    setCvTailoringError(null);
    if (!cvText.trim()) {
      setCvTailoringError({ jobId: job.id, message: "Upload and analyze your CV before tailoring it for a job." });
      return;
    }
    if (!isLocalJobpilotPage()) {
      setCvTailoringError({ jobId: job.id, message: "Open Jobpilot at localhost so your CV and job description stay on this laptop." });
      return;
    }
    if (!localAiModels.includes(selectedAiModel)) {
      setCvTailoringError({ jobId: job.id, message: "Install and select a local chat model in Local AI status, then try again." });
      return;
    }
    if (job.descriptionKind === "search-snippet" || !job.description?.trim()) {
      setCvTailoringError({ jobId: job.id, message: "This listing has no full job description to compare. Open the original posting and add its description as a manual job before tailoring a CV." });
      return;
    }
    cvTailoringAbortController.current?.abort();
    const controller = new AbortController();
    cvTailoringAbortController.current = controller;
    setCvTailoringJobId(job.id);
    const timeout = window.setTimeout(() => controller.abort(new DOMException("CV tailoring took too long.", "TimeoutError")), 95_000);
    try {
      const response = await fetch("/api/cv/tailor", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ model: selectedAiModel, cvText: cvText.slice(0, MAX_CV_MATCH_CHARS), targetRole: job.role, company: job.company, jobDescription: job.description.slice(0, 8_000) }),
      });
      const result = await response.json() as VerifiedCvTailoring & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Local CV tailoring failed.");
      const text = composeTailoredCvText({
        name: profile.name === "Candidate" ? "" : profile.name,
        contact: { email: profile.email, phone: profile.phone, linkedin: profile.linkedin, portfolio: profile.portfolio },
        targetRole: job.role,
        sections: result,
      });
      setTailoredCvDraft({ jobId: job.id, role: job.role, text, verifiedText: text, result });
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason instanceof DOMException && controller.signal.reason.name === "TimeoutError") {
        setCvTailoringError({ jobId: job.id, message: "CV tailoring took too long and was stopped. Check Ollama, select a smaller local chat model, or try again." });
      } else if (!controller.signal.aborted) {
        setCvTailoringError({ jobId: job.id, message: error instanceof Error ? error.message : "Local CV tailoring failed." });
      }
    } finally {
      window.clearTimeout(timeout);
      if (cvTailoringAbortController.current === controller) cvTailoringAbortController.current = null;
      setCvTailoringJobId((current) => current === job.id ? "" : current);
    }
  }

  function downloadTailoredCv() {
    if (!tailoredCvDraft) return;
    const blob = new Blob([renderTailoredCvHtml(tailoredCvDraft.text)], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = tailoredCvFilename(tailoredCvDraft.role);
    anchor.click();
    URL.revokeObjectURL(url);
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
      const cohortKey = await createMatchCohortKey(sug…11126 tokens truncated…icy</a> is remote-only and covers a rolling seven-day window.</p>
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
            <div className="stat-card"><div className="stat-label">JOBS WITH SCORES</div><div className="stat-bottom"><strong>{decisionScoredCount}</strong><span className="stat-note">Local decision estimates · {locationMatchedJobs.length} eligible</span></div></div>
            <div className="stat-card"><div className="stat-label">SAVED JOBS <span>ⓘ</span></div><div className="stat-bottom"><strong>{String(saved.length).padStart(2, "0")}</strong><span className="stat-note">Kept for later review</span></div><div className="saved-stat-icon">☆</div></div>
            <div className="stat-card source-card"><div className="stat-label">JOB SOURCES <span>ⓘ</span></div><div className="source-logos"><b className="gh">↗</b><span>{liveJobs.length ? `${new Set(liveJobs.map((job) => job.source)).size} feeds searched` : "Ready to search"}</span></div><div className="source-foot">Public job feeds <i/> Europe + remote</div></div>
          </div>

          {hasCurrentCvAssessment && <section className="match-calibration-panel" aria-labelledby="match-calibration-title">
            <div className="match-calibration-heading"><div><span className="eyebrow">LOCAL FEEDBACK</span><h2 id="match-calibration-title">Review screening quality</h2><p>Review assessed jobs in the detail panel. Include strong, borderline, and poor fits across score bands; reviewing only high scores can hide missed matches. Reviews are stored on this device and grouped by CV and decision model.</p></div><span className="calibration-sample-count">{currentModelMetrics.total} reviewed</span></div>
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
                <div className="job-list">{visibleJobs.map(({ job, score, confidence, matched, titleMatched, roleMatch }) => <article key={job.id} className={`job-card ${selected?.job.id === job.id ? "selected" : ""}`}><button type="button" className="job-card-main" aria-pressed={selected?.job.id === job.id} onClick={() => { selectJob(job.id); setStatus((current) => current[job.id] ? current : { ...current, [job.id]: "Needs review" }); }}><div className="job-card-top"><div className={`company-logo logo-${job.source.toLowerCase()}`}>{job.company.slice(0, 1)}</div><div className="job-card-indicators"><span className="match-tag" title={screeningErrors[job.id] ?? screeningReadinessMessage ?? undefined}>{job.screening?.model === matchingSettings.decisionModel ? `${score}% estimate · ${confidence === null ? "confidence unavailable" : `${confidence}% confidence`}` : job.aiMatch ? `${job.aiMatch.score}% detailed estimate · ${job.aiMatch.model}` : screeningErrors[job.id] ? "Score unavailable · retry" : screeningReadinessMessage ? "AI setup needed" : "Match score pending"}</span>{job.screening?.model !== matchingSettings.decisionModel && !job.aiMatch && candidateSkills.length > 0 && <span className="match-context-tag" title="Exact text mentions only; not the local AI fit estimate">{matched.length} keyword {matched.length === 1 ? "match" : "matches"}</span>}{roleMatch && <span className="role-match-tag">Target role</span>}</div></div><div className="job-title">{job.role}</div><div className="company-name">{job.company} <span>·</span> {job.location}</div><div className="job-meta"><span>◷ {job.posted}</span><span>⌂ {job.mode}</span><span className="source-tag">{job.source} · {job.listingVerification === "search-result" ? "search result" : "feed"}</span></div></button><div className="job-card-bottom"><div className="skill-pills">{matched.slice(0, 3).map((skill) => <span className={titleMatched.includes(skill) ? "skill-in-title" : ""} key={skill}>{skill}{titleMatched.includes(skill) && <small>title</small>}</span>)}{matched.length > 3 && <span className="more-skills">+{matched.length - 3}</span>}</div><button type="button" className={`bookmark ${saved.includes(job.id) ? "bookmarked" : ""}`} onClick={() => setSaved((current) => current.includes(job.id) ? current.filter((id) => id !== job.id) : [...current, job.id])} aria-label={saved.includes(job.id) ? "Remove saved job" : "Save job"} aria-pressed={saved.includes(job.id)}>{saved.includes(job.id) ? "★" : "☆"}</button></div></article>)}</div>
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
                <div className="fit-heading"><div><h4>{selected.job.screening?.model === matchingSettings.decisionModel ? "AI estimated fit" : screeningErrors[selected.job.id] ? "Local score unavailable" : screeningReadinessMessage ? "Local AI setup needed" : "Local AI estimate pending"} <span className="info-dot">i</span></h4><p>{selected.job.screening?.model === matchingSettings.decisionModel ? "Local decision-model estimate; confidence shown separately" : screeningErrors[selected.job.id] ?? screeningReadinessMessage ?? "Exact CV skill mentions are shown below; they are not a job-match score."}</p></div><div className="score-ring" style={{ "--score": `${selected.job.screening?.model === matchingSettings.decisionModel ? selected.score : 0}%` } as React.CSSProperties}><span>{selected.job.screening?.model === matchingSettings.decisionModel ? `${selected.score}%` : "—"}</span></div></div>
                {selected.job.screening?.model === matchingSettings.decisionModel && <div className="fit-meter"><i style={{ width: `${selected.score}%` }}/></div>}
                {selected.job.screening?.model !== matchingSettings.decisionModel && <p className="fit-explanation">{candidateSkills.length ? `${selected.matched.length} exact keyword ${selected.matched.length === 1 ? "mention" : "mentions"} found among ${candidateSkills.length} profile skills. This is a text count, not a fit score. ` : "No profile skills have been extracted yet. "}{cvText.trim() ? "The local decision-model score appears when screening completes." : "Upload a CV once; its local matching excerpt will be saved so screening can run again after restart."}{selected.job.listingVerification === "search-result" ? " This is only a web-search snippet, not a verified vacancy or complete job description." : ""}</p>}
                {selected.job.screening?.model === matchingSettings.decisionModel && <section className="ai-match-explanation" aria-label="Local decision-model match estimate"><div className="ai-match-title"><h4>Local screening estimate</h4><strong>{selected.job.screening.score}% · {selected.job.screening.confidence === null ? "confidence unavailable" : `${selected.job.screening.confidence}% model confidence`} · {selected.job.screening.model}</strong></div><p>Estimated role fit, not probability of getting hired. Screening confidence controls second-stage review and is not the same as the fit score.</p><div className="screening-breakdown">{Object.entries(selected.job.screening.breakdown).map(([key, value]) => <span key={key}>{key}: {value === null ? "missing" : `${value}%`}</span>)}<span>Explicit disqualifier risk: {selected.job.screening.disqualifierRisk === null ? "missing" : `${selected.job.screening.disqualifierRisk}%`}</span><span>Information: {selected.job.screening.informationStatus.replaceAll("_", " ")}</span><span>CV or job evidence compacted for model input: {selected.job.screening.evidenceTruncated === undefined ? "unknown for earlier score" : selected.job.screening.evidenceTruncated ? "yes" : "no"}</span></div><small>Score weights: skills {matchingSettings.weights.skills}%, experience {matchingSettings.weights.experience}%, domain {matchingSettings.weights.domain}%, disqualifier penalty {matchingSettings.weights.disqualifier}%.</small><small>AI estimates can be wrong. Verify the original posting and every requirement.</small>{hasCurrentCvAssessment && <div className="match-review-controls"><span>Your review: {selectedMatchReview ? selectedMatchReview.reviewedRelevant ? "Relevant" : "Not relevant" : "Not reviewed"}</span><div><button type="button" className={selectedMatchReview?.reviewedRelevant === true ? "selected-review" : ""} aria-pressed={selectedMatchReview?.reviewedRelevant === true} onClick={() => reviewSelectedMatch(true)}>Relevant</button><button type="button" className={selectedMatchReview?.reviewedRelevant === false ? "selected-review" : ""} aria-pressed={selectedMatchReview?.reviewedRelevant === false} onClick={() => reviewSelectedMatch(false)}>Not relevant</button></div></div>}</section>}
                <section className="detailed-analysis-action" aria-label="Detailed local analysis controls">
                  <button type="button" className="secondary-button" onClick={() => void analyzeJobInDetail(selected.job)} disabled={detailedAnalysisJobId === selected.job.id}>{detailedAnalysisJobId === selected.job.id ? "Analyzing this job on this laptop…" : selected.job.detailedAnalysis ? "Run detailed analysis again" : "Analyze this job in detail"}</button>
                  {detailedAnalysisJobId === selected.job.id && <button type="button" className="secondary-button" onClick={() => detailedAnalysisAbortController.current?.abort()}>Cancel analysis</button>}
                  <p>Uses the selected local chat model only for this job when requested. The first-stage score stays separate.</p>
                  {detailedAnalysisError?.jobId === selected.job.id && <p className="source-error-message" role="alert">{detailedAnalysisError.message}</p>}
                  {detailedAnalysisJobId && detailedAnalysisJobId !== selected.job.id && <p role="status">A different job is being analyzed. Starting a review here will stop that request.</p>}
                </section>
                {selected.job.detailedAnalysis && <section className="ai-match-explanation detailed-analysis" aria-label="Detailed local CV and job evidence"><div className="ai-match-title"><h4>Detailed local analysis</h4><strong>{selected.job.aiMatch?.score !== undefined ? `${selected.job.aiMatch.score}% detailed estimate · ` : ""}{selected.job.aiMatch?.model ?? selected.job.detailedAnalysis.model}</strong></div><p role="status">Analysis complete. Review the comparison below.</p><p>{selected.job.aiMatch?.reason ?? selected.job.detailedAnalysis.summary}</p>{selected.job.detailedAnalysis.matchedRequirements.length > 0 && <><h5>Matched requirements</h5><ul>{selected.job.detailedAnalysis.matchedRequirements.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></>}{selected.job.detailedAnalysis.gaps.length > 0 && <><h5>Gaps or unclear requirements</h5><ul>{selected.job.detailedAnalysis.gaps.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></>}{selected.job.detailedAnalysis.evidence.map((item, index) => <blockquote key={`${index}-${item.requirement}`}><strong>{item.requirement}</strong><br/><b>CV:</b> “{item.cvQuote}”<br/><b>Job:</b> “{item.jobQuote}”</blockquote>)}</section>}
                <section className="cv-tailoring-panel" aria-label="Tailored CV export">
                  <div className="cv-tailoring-heading"><div><h4>Tailor CV for this job</h4><p>Selects relevant excerpts from the saved CV text. It does not invent or rewrite experience.</p></div><button type="button" className="secondary-button" onClick={() => void tailorCvForJob(selected.job)} disabled={cvTailoringJobId === selected.job.id}>{cvTailoringJobId === selected.job.id ? "Selecting verified CV evidence…" : tailoredCvDraft?.jobId === selected.job.id ? "Tailor again" : "Tailor CV"}</button></div>
                  <p className="cv-tailoring-help">Uses the selected local Ollama chat model and this posting’s full description. Every model-selected excerpt is checked against your saved CV text. Your original CV file is unchanged; no file is saved on the Jobpilot server.</p>
                  {profile.name === "Candidate" && <p className="cv-tailoring-help">Your profile still has its default name. Add your name under Candidate profile before exporting a ready-to-send CV.</p>}
                  {cvTailoringJobId === selected.job.id && <p className="cv-tailoring-progress" role="status">The local model is selecting evidence from your CV and comparing it with this role.</p>}
                  {cvTailoringError?.jobId === selected.job.id && <p className="source-error-message" role="alert">{cvTailoringError.message}</p>}
                  {tailoredCvDraft?.jobId === selected.job.id && <>
                    <div className="cv-tailoring-audit" role="status"><strong>Source check: {(["profile", "skills", "experience", "education"] as const).reduce((count, section) => count + tailoredCvDraft.result[section].length, 0)} excerpts verified</strong><span>{tailoredCvDraft.result.rejectedCount ? `${tailoredCvDraft.result.rejectedCount} unsupported excerpt${tailoredCvDraft.result.rejectedCount === 1 ? " was" : "s were"} excluded.` : "No unsupported excerpts were returned."} Review the content and formatting before using it.</span></div>
                    <details className="cv-tailoring-evidence"><summary>Review selected CV evidence</summary>{(["profile", "skills", "experience", "education"] as const).map((section) => tailoredCvDraft.result[section].length > 0 && <div key={section}><strong>{section.replaceAll("_", " ")}</strong><ul>{tailoredCvDraft.result[section].map((excerpt, index) => <li key={`${section}-${index}`}>{excerpt}</li>)}</ul></div>)}</details>
                    <label className="cv-tailoring-editor">Editable CV draft<textarea rows={16} maxLength={30000} value={tailoredCvDraft.text} onChange={(event) => setTailoredCvDraft((current) => current ? { ...current, text: event.target.value } : current)} /></label>
                    {tailoredCvDraft.text !== tailoredCvDraft.verifiedText && <p className="cv-tailoring-help">You edited the source-checked draft. The edited text is no longer verified against the original CV; review every statement yourself.</p>}
                    <div className="cv-tailoring-export"><button type="button" className="primary-button" onClick={downloadTailoredCv}>Download print-ready CV</button><span>Open the downloaded HTML file, then choose Print / Save as PDF. Your original CV is not replaced.</span></div>
                  </>}
                </section>
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
        <div className="cv-import-heading"><div><h3 id="cv-import-title">Analyze CV</h3><p>Upload once. Local Ollama analyzes your experience, suggests roles and skills, and gives CV-specific strengths and improvement ideas. Your name and preferred locations stay unchanged.</p></div><span className="local-only-tag">ON THIS DEVICE</span></div>
        <label className="cv-file-label" htmlFor="cv-file">{cvParsing ? "Reading CV…" : cvAnalyzing ? "Analyzing with Ollama…" : cvFileName ? "Choose a different CV" : "Choose a CV file"}<input id="cv-file" type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event) => void parseSelectedCv(event)} disabled={cvParsing || cvAnalyzing}/></label>
        <p className="cv-file-hint">PDF, DOCX, or TXT · up to 12 MB. Scanned PDF pages are converted to images in your browser and read by Tesseract on this laptop. CV pages are not sent to a hosted OCR service.</p>
        <label className="local-model-select">OCR language<select aria-label="OCR language" value={ocrLanguage} onChange={(event) => setOcrLanguage(event.target.value as "eng" | "deu" | "eng+deu")} disabled={cvParsing || cvAnalyzing}><option value="eng">English</option><option value="deu">German</option><option value="eng+deu">English and German</option></select></label>
        {cvError && <p className="cv-error" role="alert">{cvError}</p>}
        {cvMessage && <p className="cv-message" role="status">{cvMessage}</p>}
        {cvAnalysisStatus && <p className="cv-message" role="status">{cvAnalysisStatus}</p>}
        {cvSuggestions && <div className="cv-preview">
          <div className="cv-analysis-summary"><span className="eyebrow">CV ANALYSIS {(cvParsing || cvAnalyzing) && "· IN PROGRESS"}</span><strong className="cv-file-name">{cvFileName}</strong><p>{cvSuggestions.analysis?.summary ?? (cvAnalyzing ? "Ollama is analyzing your experience, skills, and suitable job titles…" : "AI summary is not available. Profile fields were extracted from readable CV sections.")}</p></div>
          {cvSuggestions.analysis && <div className="cv-analysis-facts"><p><strong>Seniority</strong><span>{cvSuggestions.analysis.seniority}</span></p><p><strong>Domains</strong><span>{cvSuggestions.analysis.domains.join(" · ") || "Not identified"}</span></p></div>}
          <div className="cv-analysis-facts"><p><strong>Suggested job titles</strong><span>{cvSuggestions.roles || (cvParsing || cvAnalyzing ? "Analyzing CV for role titles…" : "No role titles detected")}</span></p><p><strong>Skills and expertise</strong><span>{cvSuggestions.skills || (cvParsing || cvAnalyzing ? "Analyzing CV for skills…" : "No skills detected")}</span></p></div>
          {Boolean(cvSuggestions.analysis?.highlights.length) && <div className="cv-highlights"><strong>Experience evidence</strong><ul>{cvSuggestions.analysis?.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul></div>}
          {cvSuggestions.analysis && <section className="cv-feedback" aria-label="CV improvement feedback"><h4>How to strengthen this CV</h4>{cvSuggestions.analysis.topRecommendation && <p className="cv-top-recommendation"><strong>Top suggestion:</strong> {cvSuggestions.analysis.topRecommendation}</p>}<div className="cv-feedback-columns"><div><strong>Strengths in your CV</strong>{cvSuggestions.analysis.strengths.length ? <ul>{cvSuggestions.analysis.strengths.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No specific strengths could be confirmed from the extracted text.</p>}</div><div><strong>Recommended improvements</strong>{cvSuggestions.analysis.improvements.length ? <ul>{cvSuggestions.analysis.improvements.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No specific changes were identified from the extracted text. Review the CV against each role you apply for.</p>}</div></div><small>Feedback is based on extracted CV text, which can miss layout or column content. Add achievements or metrics only when you can verify them. These suggestions may improve clarity and relevance; they cannot guarantee an interview.</small></section>}
          {cvSuggestions.notes.filter((note) => !(cvParsing || cvAnalyzing) || !/no skills section|no dated role titles/i.test(note)).map((note) => <p className="cv-file-hint" key={note}>{note}</p>)}
          {cvPreviewUrl && <details className="cv-document-details"><summary>View original CV PDF</summary><iframe title="Uploaded CV PDF preview" src={cvPreviewUrl}/></details>}
          <details className="cv-text-details"><summary>View saved CV matching excerpt</summary><pre>{(cvSuggestions.sourceText ?? "").slice(0, 12_000)}</pre>{(cvSuggestions.sourceText?.length ?? 0) > 12_000 && <small>Preview limited to 12,000 characters. Job matching uses a locally saved excerpt of up to 10,000 characters.</small>}</details>
          <div className="cv-evidence-actions">
            <button type="button" className="primary-button" onClick={() => void reanalyzeSavedCv()} disabled={cvAnalyzing || cvParsing || !cvText.trim() || !selectedAiModel || !localAiModels.includes(selectedAiModel)}>{cvAnalyzing ? "Analyzing CV…" : "Re-analyze saved CV"}</button>
            <button type="button" className="secondary-button" onClick={removeSavedCvEvidence}>Remove saved CV matching text</button>
          </div>
          <p className="cv-file-hint">Re-analysis uses the saved extracted CV text with the selected Ollama model on this laptop. It does not need the original file; changed CV feedback clears old job scores so they can be recalculated.</p>
          <p className="cv-file-hint">Your preferred location was not inferred from the CV. Profile role and skill fields below were filled automatically and can be edited. Matching uses the locally saved CV excerpt, not the keyword count shown on each job.</p>
        </div>}
      </section><label>Display name<input value={profileDraft.name} onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })}/></label><label>Target roles<span className="field-hint">Enter the roles you want to apply for, separated by commas or new lines. Filled automatically from your CV analysis; edit this list to steer job discovery.</span><textarea rows={2} value={profileDraft.roles} onChange={(event) => setProfileDraft({ ...profileDraft, roles: event.target.value })}/></label><label>Preferred locations<span className="field-hint">Enter locations explicitly, for example Austria or Vienna, Austria. Separate alternatives with semicolons. Leave blank to show any location. A bare “Remote” listing is excluded unless you choose Remote; broad “Europe” or “EMEA” remote listings require the explicit preference Remote Europe.</span><textarea rows={2} value={profileDraft.locations} onChange={(event) => setProfileDraft({ ...profileDraft, locations: event.target.value })}/></label><label>Skills <span className="field-hint">Filled automatically from your CV analysis. Edit these keywords to steer job discovery; local AI also compares the CV text with each job description.</span><textarea rows={4} value={profileDraft.skills} onChange={(event) => setProfileDraft({ ...profileDraft, skills: event.target.value })}/></label><section className="application-contact-fields"><h3>Application contact details</h3><p>Optional details for your copyable application packet. They stay in the local Jobpilot data file.</p><label>Email<input type="email" maxLength={320} autoComplete="email" value={profileDraft.email ?? ""} onChange={(event) => setProfileDraft({ ...profileDraft, email: event.target.value })}/></label><label>Phone<input type="tel" maxLength={100} autoComplete="tel" value={profileDraft.phone ?? ""} onChange={(event) => setProfileDraft({ ...profileDraft, phone: event.target.value })}/></label><label>LinkedIn profile<input type="url" maxLength={2048} value={profileDraft.linkedin ?? ""} onChange={(event) => setProfileDraft({ ...profileDraft, linkedin: event.target.value })}/></label><label>Portfolio or personal website<input type="url" maxLength={2048} value={profileDraft.portfolio ?? ""} onChange={(event) => setProfileDraft({ ...profileDraft, portfolio: event.target.value })}/></label><label>Work authorization or eligibility<textarea rows={2} maxLength={1000} value={profileDraft.workAuthorization ?? ""} onChange={(event) => setProfileDraft({ ...profileDraft, workAuthorization: event.target.value })} placeholder="Add only if you want this in your application packet"/></label></section><div className="modal-actions"><button className="secondary-button" onClick={() => setProfileDraft(defaultProfile)}>Reset default profile</button><button className="primary-button" onClick={saveProfileDraft}>Save profile</button></div><section className="data-backup" aria-label="Profile and job data backup"><div><strong>Data backup</strong><p>Download a copy of your profile and job tracker, or restore a previous backup.</p></div><div className="data-backup-actions"><button type="button" className="secondary-button" onClick={downloadBackup}>Download backup</button><button type="button" className="secondary-button" onClick={() => backupInput.current?.click()} disabled={backupBusy}>{backupBusy ? "Restoring…" : "Restore backup"}</button><input ref={backupInput} className="visually-hidden" type="file" accept="application/json,.json" aria-label="Choose Jobpilot backup file" onChange={(event) => void restoreBackup(event)}/></div>{backupMessage && <p role="status">{backupMessage}</p>}</section><p className="privacy-explainer">Scanned PDF page images are processed by Tesseract on this laptop; temporary image files are deleted immediately. The original CV file is not saved. A matching excerpt of up to 10,000 extracted characters and its analysis are saved in the unencrypted local state file so scores can run after a restart. This text is sent only to Ollama on this laptop. Use ‘Remove saved CV matching text’ to delete it; your editable role and skill fields remain.</p></section></div>}
    </main>
  );
}
