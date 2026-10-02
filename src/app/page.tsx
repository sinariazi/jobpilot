"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ApplicationStatus, CandidateProfile, Job, PersistedState } from "@/lib/types";
import { defaultProfile } from "@/lib/types";
import { matchesTargetRole, scoreJob } from "@/lib/matcher";
import { matchesPreferredLocation } from "@/lib/locations";
import { matchesDepartment, matchesPostedWithin, matchesWorkMode, type PostedWithin, type WorkMode } from "@/lib/job-filters";
import type { CvSuggestions } from "@/lib/cv-parser";
import { createBackup, parseBackup } from "@/lib/backup";

const LEGACY_STORAGE_KEY = "jobpilot-local-v1";
const MAX_BACKUP_BYTES = 23_000_000;

export default function Home() {
  const [profile, setProfile] = useState<CandidateProfile>(defaultProfile);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [postedWithin, setPostedWithin] = useState<PostedWithin>("any");
  const [workMode, setWorkMode] = useState<WorkMode>("any");
  const [department, setDepartment] = useState("");
  const [visibleCount, setVisibleCount] = useState(25);
  const [saved, setSaved] = useState<string[]>([]);
  const [status, setStatus] = useState<Record<string, ApplicationStatus>>({});
  const [profileOpen, setProfileOpen] = useState(false);
  const [activeView, setActiveView] = useState<"overview" | "applications">("overview");
  const [liveJobs, setLiveJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [storageMessage, setStorageMessage] = useState("Loading saved data from this device…");
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const backupInput = useRef<HTMLInputElement>(null);
  const [sourceMessage, setSourceMessage] = useState("");
  const [sourceErrors, setSourceErrors] = useState<string[]>([]);
  const [profileDraft, setProfileDraft] = useState<CandidateProfile>(defaultProfile);
  const [cvSuggestions, setCvSuggestions] = useState<CvSuggestions | null>(null);
  const [cvFileName, setCvFileName] = useState("");
  const [cvParsing, setCvParsing] = useState(false);
  const [cvError, setCvError] = useState("");
  const [cvMessage, setCvMessage] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [includeCvRoles, setIncludeCvRoles] = useState(true);
  const [includeCvSkills, setIncludeCvSkills] = useState(true);
  const candidateSkills = useMemo(() => profile.skills.split(",").map((skill) => skill.trim()).filter(Boolean), [profile.skills]);
  const jobs = useMemo(() => {
    const unique = new Map<string, Job>();
    liveJobs.forEach((job) => unique.set(job.sourceUrl ?? job.id, job));
    return [...unique.values()];
  }, [liveJobs]);

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
        setLiveJobs(restored.liveJobs ?? []);
        setSelectedId(restored.liveJobs?.[0]?.id ?? "");
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

  useEffect(() => {
    if (!stateLoaded) return;
    let cancelled = false;
    const snapshot = { profile, saved, status, liveJobs } satisfies PersistedState;
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
  }, [profile, saved, status, liveJobs, stateLoaded]);

  const preferredJobs = useMemo(() => jobs.filter((job) => matchesPreferredLocation(job.location, profile.locations, job.mode, job.source)), [jobs, profile.locations]);
  const ranked = useMemo(() => preferredJobs.map((job) => ({ job, ...scoreJob(job, candidateSkills), roleMatch: matchesTargetRole(job, profile.roles) }))
    .filter(({ job }) => `${job.role} ${job.company} ${job.location} ${job.department ?? ""}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(b.roleMatch) - Number(a.roleMatch) || b.titleMatched.length - a.titleMatched.length || b.score - a.score), [query, candidateSkills, preferredJobs, profile.roles]);
  const filteredRanked = useMemo(() => ranked.filter(({ job }) => matchesPostedWithin(job, postedWithin) && matchesWorkMode(job, workMode) && matchesDepartment(job, department)), [ranked, postedWithin, workMode, department]);
  const visibleJobs = filteredRanked.slice(0, visibleCount);
  const departments = useMemo(() => [...new Set(preferredJobs.map((job) => job.department?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b)), [preferredJobs]);
  const selected = filteredRanked.find(({ job }) => job.id === selectedId) ?? filteredRanked[0];
  const matchedJobs = preferredJobs.filter((job) => scoreJob(job, candidateSkills).matched.length > 0).length;
  const reviewedCount = preferredJobs.filter((job) => status[job.id]).length;
  const applicationJobs = jobs.filter((job) => saved.includes(job.id) || status[job.id]);
  const applicationGroups: Array<{ title: string; items: Job[] }> = [
    { title: "Needs review", items: applicationJobs.filter((job) => !status[job.id] || status[job.id] === "Needs review") },
    { title: "Approved to prepare", items: applicationJobs.filter((job) => status[job.id] === "Approved to prepare") },
    { title: "Applied", items: applicationJobs.filter((job) => status[job.id] === "Applied") },
    { title: "Rejected", items: applicationJobs.filter((job) => status[job.id] === "Rejected") },
  ];

  function openProfile() {
    setProfileDraft(profile);
    setCvSuggestions(null);
    setCvFileName("");
    setCvError("");
    setCvMessage("");
    setProfileOpen(true);
  }

  async function parseSelectedCv(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setCvParsing(true);
    setCvError("");
    setCvMessage("");
    try {
      const { parseCvFile } = await import("@/lib/cv-parser");
      const suggestions = await parseCvFile(file);
      setCvSuggestions(suggestions);
      setCvFileName(file.name);
      setCvMessage("Text extracted in this browser. The CV was not uploaded or saved.");
    } catch (error) {
      setCvSuggestions(null);
      setCvFileName("");
      setCvError(error instanceof Error ? error.message : "Could not read this CV.");
    } finally {
      setCvParsing(false);
    }
  }

  function downloadBackup() {
    const backup = createBackup({ profile, saved, status, liveJobs });
    const url = URL.createObjectURL(new Blob([backup], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `jobpilot-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setBackupMessage("Backup downloaded. Store the file somewhere safe; it contains your local profile and job tracking data.");
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
    if (!window.confirm("Restore this backup? It will replace the profile, saved jobs, application statuses, and fetched listings on this device.")) {
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
      setLiveJobs(result.liveJobs);
      setSelectedId(result.liveJobs[0]?.id ?? "");
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

  function applyCvSuggestions() {
    if (!cvSuggestions) return;
    const merge = (current: string, added: string) => {
      const values = [...current.split(/[,;\n|]+/), ...added.split(/[,;\n|]+/)]
        .map((value) => value.trim())
        .filter(Boolean);
      const unique = new Map(values.map((value) => [value.toLocaleLowerCase(), value]));
      return [...unique.values()].join(", ");
    };
    setProfileDraft((current) => ({
      ...current,
      ...(includeCvRoles && cvSuggestions.roles ? { roles: merge(current.roles, cvSuggestions.roles) } : {}),
      ...(includeCvSkills && cvSuggestions.skills ? { skills: merge(current.skills, cvSuggestions.skills) } : {}),
    }));
    setCvMessage("Suggestions added to the profile draft. Review them, then choose Save profile to keep the changes.");
  }

  async function fetchLiveJobs() {
    setLoadingJobs(true);
    setSourceMessage("");
    setSourceErrors([]);
    try {
      const response = await fetch("/api/jobs/search", { cache: "no-store" });
      const result = await response.json() as { jobs?: Job[]; errors?: string[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not fetch jobs.");
      setLiveJobs(result.jobs ?? []);
      setSourceErrors(result.errors ?? []);
      const matchingJobs = (result.jobs ?? []).filter((job) => matchesPreferredLocation(job.location, profile.locations, job.mode, job.source));
      setSourceMessage(result.jobs?.length
        ? `Searched public job feeds and found ${result.jobs.length} listings; ${matchingJobs.length} match your preferred locations. Your target roles are ranked first.`
        : "No listings came back from the public job feeds. Try again later.");
      setSourceErrors(result.errors ?? []);
      setSelectedId(matchingJobs[0]?.id ?? "");
    } catch (error) {
      setSourceMessage(error instanceof Error ? error.message : "Could not fetch listings.");
    } finally {
      setLoadingJobs(false);
    }
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
              <div className="application-summary"><strong>{applicationJobs.length}</strong><span>roles in your tracker</span><span className="summary-divider"/><span>{applicationGroups.find((group) => group.title === "Applied")?.items.length ?? 0} applied</span><span>{saved.length} saved</span></div>
              <div className="application-board">{applicationGroups.map((group) => <section className="application-column" key={group.title}><div className="application-column-heading"><h2>{group.title}</h2><span>{group.items.length}</span></div>{group.items.length ? group.items.map((job) => <article className="application-card" key={job.id}><div className="application-company"><div className={`company-logo logo-${job.source.toLowerCase()}`}>{job.company.slice(0, 1)}</div><div><strong>{job.company}</strong><span>{job.location}</span></div></div><h3>{job.role}</h3><div className="application-card-footer"><span>{job.source}</span><select aria-label={`Update ${job.company} application status`} value={status[job.id] ?? "Needs review"} onChange={(event) => setStatus((current) => ({ ...current, [job.id]: event.target.value as ApplicationStatus }))}><option>Needs review</option><option>Approved to prepare</option><option>Applied</option><option>Rejected</option></select></div></article>) : <p className="application-empty">No roles here yet.</p>}</section>)}</div>
              <p className="application-footnote">Status changes are saved on this device. “Applied” is a manual record; Jobpilot never submits applications.</p>
            </>
          ) : <>
          <div className="greeting-row"><div><div className="eyebrow">{new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase()}</div><h1>Your next opportunity <span>starts here.</span></h1><p className="subheading">A focused view of live roles that match your preferences.</p></div><button className="primary-button" onClick={fetchLiveJobs} disabled={loadingJobs}><span>＋</span> {loadingJobs ? "Searching feeds…" : "Search jobs"}</button></div>

          <section className="source-panel search-panel">
            <div>
              <span className="eyebrow">AUTOMATIC JOB SEARCH</span>
              <strong>Search across public job feeds</strong>
              <p>Jobpilot checks multiple public feeds automatically, then filters by your preferred locations and ranks your target roles and skills. No company names or board links needed.</p>
            </div>
            <div className="source-controls">
              <button className="primary-button" disabled={loadingJobs} onClick={fetchLiveJobs}>{loadingJobs ? "Searching job feeds…" : liveJobs.length ? "↻ Search for new jobs" : "Search jobs now"}</button>
              <span className="feed-summary">Europe listings plus remote roles · Profile stays on this device</span>
            </div>
            <p className="directory-credit">Sources: <a href="https://www.arbeitnow.com/" target="_blank" rel="noreferrer">Arbeitnow</a>, <a href="https://remotive.com/remote-jobs/api" target="_blank" rel="noreferrer">Remotive</a>, and <a href="https://jobicy.com/jobs-rss-feed" target="_blank" rel="noreferrer">Jobicy</a>. Feed coverage varies; it does not include every employer.</p>
            {sourceMessage && <p className="source-message" role="status">{sourceMessage}</p>}
            {sourceErrors.length > 0 && <ul className="source-errors" role="status">{sourceErrors.map((error) => <li key={error}>{error}</li>)}</ul>}
            <p className="source-message" role="status">{storageMessage}</p>
          </section>

          <div className="stats-grid">
            <div className="stat-card"><div className="stat-label">JOBS REVIEWED</div><div className="stat-bottom"><strong>{reviewedCount}</strong><span className="stat-note">of {preferredJobs.length} live jobs in your locations</span></div></div>
            <div className="stat-card"><div className="stat-label">JOBS WITH SKILL MENTIONS</div><div className="stat-bottom"><strong>{matchedJobs}</strong><span className="stat-note">At least one profile skill mentioned</span></div></div>
            <div className="stat-card"><div className="stat-label">SAVED JOBS <span>ⓘ</span></div><div className="stat-bottom"><strong>{String(saved.length).padStart(2, "0")}</strong><span className="stat-note">Kept for later review</span></div><div className="saved-stat-icon">☆</div></div>
            <div className="stat-card source-card"><div className="stat-label">JOB SOURCES <span>ⓘ</span></div><div className="source-logos"><b className="gh">↗</b><span>{liveJobs.length ? `${new Set(liveJobs.map((job) => job.source)).size} feeds searched` : "Ready to search"}</span></div><div className="source-foot">Public job feeds <i/> Europe + remote</div></div>
          </div>

          <div className="section-heading"><div><h2>Job listings <span className="result-count">{filteredRanked.length}</span></h2><p>Target role matches first, then skills named in the title, then total skill mentions.</p></div><span className="filter-summary">Showing {visibleJobs.length} of {filteredRanked.length}</span></div>
          <div className="jobs-layout">
            <section className="jobs-column">
              <div className="filters">
                <label className="search-box"><span>⌕</span><input id="job-search" placeholder="Search roles or companies..." value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(25); }} /></label>
                <select aria-label="Filter by posting date" value={postedWithin} onChange={(event) => { setPostedWithin(event.target.value as PostedWithin); setVisibleCount(25); }}><option value="any">Any date</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select>
                <select aria-label="Filter by work mode" value={workMode} onChange={(event) => { setWorkMode(event.target.value as WorkMode); setVisibleCount(25); }}><option value="any">Any work mode</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">On-site</option></select>
                <select aria-label="Filter by department" value={department} onChange={(event) => { setDepartment(event.target.value); setVisibleCount(25); }}><option value="">Any department</option>{departments.map((item) => <option key={item} value={item}>{item}</option>)}</select>
                <span className="location-filter">Locations: {profile.locations || "Any"}</span>
              </div>
              {filteredRanked.length > 0 ? <>
                <div className="job-list">{visibleJobs.map(({ job, score, matched, titleMatched }) => <article key={job.id} className={`job-card ${selected?.job.id === job.id ? "selected" : ""}`}><button type="button" className="job-card-main" aria-pressed={selected?.job.id === job.id} onClick={() => { setSelectedId(job.id); setStatus((current) => current[job.id] ? current : { ...current, [job.id]: "Needs review" }); }}><div className="job-card-top"><div className={`company-logo logo-${job.source.toLowerCase()}`}>{job.company.slice(0, 1)}</div><span className="match-tag">{score}% match</span></div><div className="job-title">{job.role}</div><div className="company-name">{job.company} <span>·</span> {job.location}</div><div className="job-meta"><span>◷ {job.posted}</span><span>⌂ {job.mode}</span><span className="source-tag">{job.source} · feed</span></div></button><div className="job-card-bottom"><div className="skill-pills">{matched.slice(0, 3).map((skill) => <span className={titleMatched.includes(skill) ? "skill-in-title" : ""} key={skill}>{skill}{titleMatched.includes(skill) && <small>title</small>}</span>)}{matched.length > 3 && <span className="more-skills">+{matched.length - 3}</span>}</div><button type="button" className={`bookmark ${saved.includes(job.id) ? "bookmarked" : ""}`} onClick={() => setSaved((current) => current.includes(job.id) ? current.filter((id) => id !== job.id) : [...current, job.id])} aria-label={saved.includes(job.id) ? "Remove saved job" : "Save job"} aria-pressed={saved.includes(job.id)}>{saved.includes(job.id) ? "★" : "☆"}</button></div></article>)}</div>
                {visibleJobs.length < filteredRanked.length && <button className="load-more" onClick={() => setVisibleCount((count) => count + 25)}>Show more jobs <span>({filteredRanked.length - visibleJobs.length} remaining)</span></button>}
              </> : <div className="empty-state">{liveJobs.length === 0 ? "No jobs loaded yet. Select “Search jobs now” to check public job feeds." : ranked.length === 0 ? query ? "No live jobs match that search. Try another role or company." : `No fetched jobs match ${profile.locations || "your preferred locations"}. Update your preferred locations or try searching the feeds again.` : "No jobs match these filters. Try a different date, work mode, or department."}</div>}
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
                <div className="fit-heading"><div><h4>Your match <span className="info-dot">i</span></h4><p>Profile skills mentioned in the posting</p></div><div className="score-ring" style={{ "--score": `${selected.score}%` } as React.CSSProperties}><span>{selected.score}%</span></div></div>
                <div className="fit-meter"><i style={{ width: `${selected.score}%` }}/></div>
                <div className="evidence-label">PROFILE SKILLS MENTIONED IN POSTING <span>{selected.matched.length} found</span></div>
                <div className="evidence-pills">{selected.matched.map((skill) => <span key={skill}>✓ {skill}{selected.titleMatched.includes(skill) && <small> · title</small>}</span>)}</div>
                {selected.missing.length > 0 && <><div className="evidence-label gap-label">PROFILE SKILLS NOT MENTIONED <span>{selected.missing.length}</span></div><div className="evidence-pills missing-pills">{selected.missing.map((skill) => <span key={skill}>! {skill}</span>)}</div><p className="match-caveat">A skill missing from the posting text is not proof that the job requires it.</p></>}
                <div className="divider"/>
                <div id="job-description" className="description"><h4>Job description</h4><p className="job-description-text">{selected.job.description ?? selected.job.summary}</p></div>
                <div className="review-note"><span>◉</span><p><strong>Human review required</strong><br/>Approval only authorizes preparation; it does not submit an application.</p></div>
              </aside>
            ) : <aside className="detail-card empty-detail">Select a job to inspect its match evidence.</aside>}
          </div>
          <footer className="page-footer"><span>JOBPILOT <b>·</b> LOCAL-FIRST JOB SEARCH</span><span>Live listings · Nothing is submitted automatically</span></footer>
          </>}
        </div>
      </section>
      {profileOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileOpen(false); }}><section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title"><div className="modal-heading"><div><span className="eyebrow">YOUR LOCAL SEARCH PROFILE</span><h2 id="profile-title">Candidate profile</h2><p>These editable details are stored in a file on this device.</p></div><button className="icon-button" onClick={() => setProfileOpen(false)} aria-label="Close profile">×</button></div><section className="cv-import" aria-labelledby="cv-import-title"><div className="cv-import-heading"><div><h3 id="cv-import-title">Import from CV</h3><p>Extract role titles and skills locally, then review suggestions before saving your profile.</p></div><span className="local-only-tag">ON THIS DEVICE</span></div><label className="cv-file-label" htmlFor="cv-file">{cvParsing ? "Reading CV…" : "Choose a CV file"}<input id="cv-file" type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event) => void parseSelectedCv(event)} disabled={cvParsing}/></label><p className="cv-file-hint">PDF, DOCX, or TXT · up to 12 MB · Scanned PDFs need OCR (not implemented yet)</p>{cvError && <p className="cv-error" role="alert">{cvError}</p>}{cvMessage && <p className="cv-message" role="status">{cvMessage}</p>}{cvSuggestions && <div className="cv-preview"><strong className="cv-file-name">{cvFileName}</strong>{cvSuggestions.pageCount && <span className="cv-page-count">{cvSuggestions.pageCount} PDF pages</span>}<label className="cv-option"><input type="checkbox" checked={includeCvRoles} onChange={(event) => setIncludeCvRoles(event.target.checked)}/> Add past role titles as target role suggestions <small>(review before saving)</small></label><textarea aria-label="Role titles extracted from CV" rows={2} value={cvSuggestions.roles} onChange={(event) => setCvSuggestions({ ...cvSuggestions, roles: event.target.value })} placeholder="No role titles detected"/><label className="cv-option"><input type="checkbox" checked={includeCvSkills} onChange={(event) => setIncludeCvSkills(event.target.checked)}/> Add extracted skills</label><textarea aria-label="Skills extracted from CV" rows={3} value={cvSuggestions.skills} onChange={(event) => setCvSuggestions({ ...cvSuggestions, skills: event.target.value })} placeholder="No skills detected"/>{cvSuggestions.notes.map((note) => <p className="cv-file-hint" key={note}>{note}</p>)}<p className="cv-file-hint">CV addresses are not imported as preferred job locations. Your source file and extracted text are not uploaded or stored by this importer.</p><button type="button" className="secondary-button" onClick={applyCvSuggestions} disabled={(!includeCvRoles || !cvSuggestions.roles) && (!includeCvSkills || !cvSuggestions.skills)}>Add selected suggestions to profile draft</button></div>}</section><label>Display name<input value={profileDraft.name} onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })}/></label><label>Target roles<span className="field-hint">Enter role titles separated by commas, semicolons, or new lines. Matching titles are ranked first.</span><textarea rows={2} value={profileDraft.roles} onChange={(event) => setProfileDraft({ ...profileDraft, roles: event.target.value })}/></label><label>Preferred locations<span className="field-hint">Only jobs matching these work-location preferences are shown. Use semicolons for multiple options. CV addresses are not used.</span><textarea rows={2} value={profileDraft.locations} onChange={(event) => setProfileDraft({ ...profileDraft, locations: event.target.value })}/></label><label>Skills <span className="field-hint">Enter skills separated by commas. Ranking checks for exact mentions in each posting.</span><textarea rows={4} value={profileDraft.skills} onChange={(event) => setProfileDraft({ ...profileDraft, skills: event.target.value })}/></label><div className="modal-actions"><button className="secondary-button" onClick={() => setProfileDraft(defaultProfile)}>Reset default profile</button><button className="primary-button" onClick={() => { setProfile({ ...profileDraft, name: profileDraft.name.trim() || "Candidate" }); setProfileOpen(false); }}>Save profile</button></div><section className="data-backup" aria-label="Profile and job data backup"><div><strong>Data backup</strong><p>Download a copy of your profile and job tracker, or restore a previous backup.</p></div><div className="data-backup-actions"><button type="button" className="secondary-button" onClick={downloadBackup}>Download backup</button><button type="button" className="secondary-button" onClick={() => backupInput.current?.click()} disabled={backupBusy}>{backupBusy ? "Restoring…" : "Restore backup"}</button><input ref={backupInput} className="visually-hidden" type="file" accept="application/json,.json" aria-label="Choose Jobpilot backup file" onChange={(event) => void restoreBackup(event)}/></div>{backupMessage && <p role="status">{backupMessage}</p>}</section><p className="privacy-explainer">The CV itself is parsed in your browser and is not saved. Role and skill suggestions you accept are stored in the local profile file, which is not encrypted.</p></section></div>}
    </main>
  );
}
