"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ApplicationStatus, CandidateProfile, Job, PersistedState } from "@/lib/types";
import { defaultProfile } from "@/lib/types";
import { scoreJob } from "@/lib/matcher";
import { matchesPreferredLocation } from "@/lib/locations";
import { parseGreenhouseBoardReference } from "@/lib/greenhouse-input";
import type { GreenhouseCompany } from "@/lib/company-directory";

const LEGACY_STORAGE_KEY = "jobpilot-local-v1";

export default function Home() {
  const [profile, setProfile] = useState<CandidateProfile>(defaultProfile);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const [status, setStatus] = useState<Record<string, ApplicationStatus>>({});
  const [profileOpen, setProfileOpen] = useState(false);
  const [activeView, setActiveView] = useState<"overview" | "applications">("overview");
  const [liveJobs, setLiveJobs] = useState<Job[]>([]);
  const [greenhouseSlugs, setGreenhouseSlugs] = useState("");
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyResults, setCompanyResults] = useState<GreenhouseCompany[]>([]);
  const [selectedCompanies, setSelectedCompanies] = useState<GreenhouseCompany[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState("");
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [storageMessage, setStorageMessage] = useState("Loading saved data from this device…");
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const [sourceMessage, setSourceMessage] = useState("");
  const [sourceErrors, setSourceErrors] = useState<string[]>([]);
  const [profileDraft, setProfileDraft] = useState<CandidateProfile>(defaultProfile);
  const candidateSkills = useMemo(() => profile.skills.split(",").map((skill) => skill.trim()).filter(Boolean), [profile.skills]);
  const jobs = useMemo(() => {
    const unique = new Map<string, Job>();
    liveJobs.forEach((job) => unique.set(job.sourceUrl ?? job.id, job));
    return [...unique.values()];
  }, [liveJobs]);

  useEffect(() => {
    const queryText = companyQuery.trim();
    if (queryText.length < 2) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setDirectoryLoading(true);
      setDirectoryError("");
      void fetch(`/api/companies/greenhouse?query=${encodeURIComponent(queryText)}`, { signal: controller.signal })
        .then(async (response) => {
          const result = await response.json() as { companies?: GreenhouseCompany[]; error?: string };
          if (!response.ok) throw new Error(result.error ?? "Company search failed.");
          setCompanyResults(result.companies ?? []);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setCompanyResults([]);
            setDirectoryError(error instanceof Error ? error.message : "Company search is temporarily unavailable.");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setDirectoryLoading(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [companyQuery]);

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

  const preferredJobs = useMemo(() => jobs.filter((job) => matchesPreferredLocation(job.location, profile.locations)), [jobs, profile.locations]);
  const ranked = useMemo(() => preferredJobs.map((job) => ({ job, ...scoreJob(job, candidateSkills) }))
    .filter(({ job }) => `${job.role} ${job.company} ${job.location}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.score - a.score), [query, candidateSkills, preferredJobs]);
  const selected = ranked.find(({ job }) => job.id === selectedId) ?? ranked[0];
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
    setProfileOpen(true);
  }

  async function fetchLiveJobs() {
    const enteredBoards = greenhouseSlugs.split(",").map((entry) => entry.trim()).filter(Boolean);
    const slugs = enteredBoards.map(parseGreenhouseBoardReference);
    if (slugs.some((slug) => slug === null)) {
      setSourceErrors(["Paste a Greenhouse board link or board ID. Other job-board websites are not supported yet."]);
      return;
    }
    const boards = [...new Set([...selectedCompanies.map((company) => company.slug), ...slugs.filter((slug): slug is string => slug !== null)])];
    if (boards.length === 0) {
      setSourceErrors(["Search for and select at least one company, or paste a Greenhouse board link."]);
      return;
    }
    setLoadingJobs(true);
    setSourceMessage("");
    setSourceErrors([]);
    try {
      const response = await fetch("/api/jobs/greenhouse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slugs: boards }),
      });
      const result = await response.json() as { jobs?: Job[]; errors?: string[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not fetch jobs.");
      setLiveJobs(result.jobs ?? []);
      setSourceErrors(result.errors ?? []);
      const matchingJobs = (result.jobs ?? []).filter((job) => matchesPreferredLocation(job.location, profile.locations));
      setSourceMessage(result.jobs?.length
        ? `Found ${result.jobs.length} live listing${result.jobs.length === 1 ? "" : "s"}; ${matchingJobs.length} match your preferred locations.`
        : "No open jobs were found on these company boards. Try another company’s Careers page.");
      setSelectedId(matchingJobs[0]?.id ?? "");
    } catch (error) {
      setSourceMessage(error instanceof Error ? error.message : "Could not fetch listings.");
    } finally {
      setLoadingJobs(false);
    }
  }

  function toggleCompany(company: GreenhouseCompany) {
    setSelectedCompanies((current) => current.some((item) => item.slug === company.slug)
      ? current.filter((item) => item.slug !== company.slug)
      : [...current, company]);
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
          <div className="greeting-row"><div><div className="eyebrow">{new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase()}</div><h1>Your next opportunity <span>starts here.</span></h1><p className="subheading">A focused view of live roles that match your preferences.</p></div><button className="primary-button" onClick={() => document.getElementById("company-search")?.focus()}><span>＋</span> Find new jobs</button></div>

          <section className="source-panel">
            <div>
              <span className="eyebrow">JOB SOURCES</span>
              <strong>Search companies and find jobs</strong>
              <p>Search the company directory and select one or more employers. Jobpilot will check their public Greenhouse listings.</p>
            </div>
            <label className="source-input-label" htmlFor="company-search">Company name</label>
            <div className="source-controls">
              <input id="company-search" value={companyQuery} onChange={(event) => { setCompanyQuery(event.target.value); setCompanyResults([]); setDirectoryError(""); setDirectoryLoading(false); }} aria-label="Search companies" aria-describedby="source-input-help" placeholder="Start typing a company name" autoComplete="off" />
              <button className="secondary-button" disabled={loadingJobs || (!selectedCompanies.length && !greenhouseSlugs.trim())} onClick={fetchLiveJobs}>{loadingJobs ? "Loading jobs…" : `Load jobs${selectedCompanies.length ? ` (${selectedCompanies.length} selected)` : ""}`}</button>
            </div>
            <p id="source-input-help" className="source-input-help">Type at least two letters. Job results are filtered using your preferred locations in Candidate profile.</p>
            <p className="directory-credit">Directory data: <a href="https://github.com/outscal/OpenJobs" target="_blank" rel="noreferrer">OpenJobs</a>. Listings are checked when you load them.</p>
            {directoryLoading && <p className="directory-status" role="status">Searching companies…</p>}
            {directoryError && <p className="directory-error" role="alert">{directoryError}</p>}
            {!directoryLoading && !directoryError && companyQuery.trim().length >= 2 && companyResults.length === 0 && <p className="directory-status" role="status">No Greenhouse companies found. Try another name or add a link below.</p>}
            {companyResults.length > 0 && <ul className="company-picker-results">{companyResults.map((company) => {
              const checked = selectedCompanies.some((item) => item.slug === company.slug);
              return <li key={company.slug}><label><input type="checkbox" checked={checked} onChange={() => toggleCompany(company)} /><span><strong>{company.name}</strong><small>{company.slug}</small></span></label></li>;
            })}</ul>}
            {selectedCompanies.length > 0 && <div className="selected-companies"><span>Selected companies</span><ul>{selectedCompanies.map((company) => <li key={company.slug}>{company.name}<button type="button" aria-label={`Remove ${company.name}`} onClick={() => toggleCompany(company)}>×</button></li>)}</ul></div>}
            <details className="source-help">
              <summary>Can’t find a company?</summary>
              <p>Only companies with a public Greenhouse board appear in this directory. If the company is missing, paste its Greenhouse board or job link here. Other hiring platforms are not supported yet.</p>
              <label className="source-input-label" htmlFor="greenhouse-slugs">Greenhouse board or job link</label>
              <input id="greenhouse-slugs" className="manual-board-input" value={greenhouseSlugs} onChange={(event) => setGreenhouseSlugs(event.target.value)} aria-label="Greenhouse board or job link" placeholder="boards.greenhouse.io/company-name" />
            </details>
            {sourceMessage && <p className="source-message" role="status">{sourceMessage}</p>}
            {sourceErrors.length > 0 && <ul className="source-errors" role="alert">{sourceErrors.map((error) => <li key={error}>{error}</li>)}</ul>}
            <p className="source-message" role="status">{storageMessage}</p>
          </section>

          <div className="stats-grid">
            <div className="stat-card"><div className="stat-label">JOBS REVIEWED</div><div className="stat-bottom"><strong>{reviewedCount}</strong><span className="stat-note">of {preferredJobs.length} live jobs in your locations</span></div></div>
            <div className="stat-card"><div className="stat-label">JOBS WITH SKILL MENTIONS</div><div className="stat-bottom"><strong>{matchedJobs}</strong><span className="stat-note">At least one profile skill mentioned</span></div></div>
            <div className="stat-card"><div className="stat-label">SAVED JOBS <span>ⓘ</span></div><div className="stat-bottom"><strong>{String(saved.length).padStart(2, "0")}</strong><span className="stat-note">Kept for later review</span></div><div className="saved-stat-icon">☆</div></div>
            <div className="stat-card source-card"><div className="stat-label">JOB SOURCES <span>ⓘ</span></div><div className="source-logos"><b className="gh">G</b><span>{liveJobs.length ? "Connected" : "Ready"}</span></div><div className="source-foot">Live listings <i/> Greenhouse board API</div></div>
          </div>

          <div className="section-heading"><div><h2>Job listings <span className="result-count">{ranked.length}</span></h2><p>Sorted by the number of profile skills explicitly mentioned in each posting.</p></div></div>
          <div className="jobs-layout">
            <section className="jobs-column">
              <div className="filters"><label className="search-box"><span>⌕</span><input id="job-search" placeholder="Search roles or companies..." value={query} onChange={(event) => setQuery(event.target.value)} /></label><span className="location-filter">Locations: {profile.locations || "Any"}</span></div>
              <div className="job-list">{ranked.map(({ job, score, matched }) => <article key={job.id} className={`job-card ${selected?.job.id === job.id ? "selected" : ""}`}><button type="button" className="job-card-main" aria-pressed={selected?.job.id === job.id} onClick={() => { setSelectedId(job.id); setStatus((current) => current[job.id] ? current : { ...current, [job.id]: "Needs review" }); }}><div className="job-card-top"><div className={`company-logo logo-${job.source.toLowerCase()}`}>{job.company.slice(0, 1)}</div><span className="match-tag">{score}% match</span></div><div className="job-title">{job.role}</div><div className="company-name">{job.company} <span>·</span> {job.location}</div><div className="job-meta"><span>◷ {job.posted}</span><span>⌂ {job.mode}</span><span className="source-tag">{job.source} · live</span></div></button><div className="job-card-bottom"><div className="skill-pills">{matched.slice(0, 3).map((skill) => <span key={skill}>{skill}</span>)}{matched.length > 3 && <span className="more-skills">+{matched.length - 3}</span>}</div><button type="button" className={`bookmark ${saved.includes(job.id) ? "bookmarked" : ""}`} onClick={() => setSaved((current) => current.includes(job.id) ? current.filter((id) => id !== job.id) : [...current, job.id])} aria-label={saved.includes(job.id) ? "Remove saved job" : "Save job"} aria-pressed={saved.includes(job.id)}>{saved.includes(job.id) ? "★" : "☆"}</button></div></article>)}</div>
              {ranked.length === 0 && <div className="empty-state">{liveJobs.length === 0 ? "No jobs loaded yet. Add a company job-board link above to get started." : query ? "No live jobs match that search. Try another role or company." : `No fetched jobs match ${profile.locations || "your preferred locations"}. Edit the Candidate profile or try another company board.`}</div>}
            </section>

            {selected ? (
              <aside className="detail-card">
                <div className="detail-actions">
                <span className="detail-source"><i /> {selected.job.source} listing</span>
                  <button className="icon-button" onClick={() => setSaved((current) => current.includes(selected.job.id) ? current.filter((id) => id !== selected.job.id) : [...current, selected.job.id])} aria-label="Save selected job">{saved.includes(selected.job.id) ? "★" : "☆"}</button>
                </div>
                <div className="detail-company"><div className={`company-logo big-logo logo-${selected.job.source.toLowerCase()}`}>{selected.job.company.slice(0, 1)}</div><div><h3>{selected.job.company}</h3><span>{selected.job.location} · {selected.job.mode}</span>{selected.job.department && <span>{selected.job.department}</span>}</div></div>
                <h2 className="detail-title">{selected.job.role}</h2>
                <div className="detail-sub">{selected.job.mode} <i/> Posted {selected.job.posted} {selected.job.retrievedAt && <><i/> Retrieved {new Date(selected.job.retrievedAt).toLocaleString()}</>}</div>
                <div className="detail-buttons">{selected.job.sourceUrl ? <a href={selected.job.sourceUrl} target="_blank" rel="noreferrer" className="primary-button apply-button">Open original posting ↗</a> : <a href="#job-description" className="primary-button apply-button">Review role details ↓</a>}<label className="detail-status-label">Status<select aria-label={`Application status for ${selected.job.company}`} value={status[selected.job.id] ?? "Needs review"} onChange={(event) => setStatus((current) => ({ ...current, [selected.job.id]: event.target.value as ApplicationStatus }))}><option>Needs review</option><option>Approved to prepare</option><option>Applied</option><option>Rejected</option></select></label></div>
                <div className="divider"/>
                <div className="fit-heading"><div><h4>Your match <span className="info-dot">i</span></h4><p>Based on skills in your candidate profile</p></div><div className="score-ring" style={{ "--score": `${selected.score}%` } as React.CSSProperties}><span>{selected.score}%</span></div></div>
                <div className="fit-meter"><i style={{ width: `${selected.score}%` }}/></div>
                <div className="evidence-label">PROFILE SKILLS MENTIONED IN POSTING <span>{selected.matched.length} found</span></div>
                <div className="evidence-pills">{selected.matched.map((skill) => <span key={skill}>✓ {skill}</span>)}</div>
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
      {profileOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileOpen(false); }}><section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title"><div className="modal-heading"><div><span className="eyebrow">YOUR LOCAL SEARCH PROFILE</span><h2 id="profile-title">Candidate profile</h2><p>These editable details are stored in a file on this device.</p></div><button className="icon-button" onClick={() => setProfileOpen(false)} aria-label="Close profile">×</button></div><label>Display name<input value={profileDraft.name} onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })}/></label><label>Target roles<span className="field-hint">TODO: Target roles are saved but are not yet used to rank listings.</span><textarea rows={2} value={profileDraft.roles} onChange={(event) => setProfileDraft({ ...profileDraft, roles: event.target.value })}/></label><label>Preferred locations<span className="field-hint">Only jobs matching these locations are shown. Separate options with semicolons.</span><textarea rows={2} value={profileDraft.locations} onChange={(event) => setProfileDraft({ ...profileDraft, locations: event.target.value })}/></label><label>Skills <span className="field-hint">Enter skills separated by commas. Ranking checks for exact mentions in each posting.</span><textarea rows={4} value={profileDraft.skills} onChange={(event) => setProfileDraft({ ...profileDraft, skills: event.target.value })}/></label><div className="modal-actions"><button className="secondary-button" onClick={() => setProfileDraft(defaultProfile)}>Reset default profile</button><button className="primary-button" onClick={() => { setProfile({ ...profileDraft, name: profileDraft.name.trim() || "Candidate" }); setProfileOpen(false); }}>Save profile</button></div><p className="privacy-explainer">Local files are not encrypted. Avoid importing a real CV or storing sensitive personal data until encryption is implemented.</p></section></div>}
    </main>
  );
}
