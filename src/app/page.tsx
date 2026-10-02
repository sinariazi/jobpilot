"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ApplicationStatus, CandidateProfile, Job, PersistedState } from "@/lib/types";
import { defaultProfile } from "@/lib/types";
import { demoJobs } from "@/lib/jobs";
import { scoreJob } from "@/lib/matcher";

const LEGACY_STORAGE_KEY = "jobpilot-local-v1";

export default function Home() {
  const [profile, setProfile] = useState<CandidateProfile>(defaultProfile);
  const [selectedId, setSelectedId] = useState(demoJobs[0].id);
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("All locations");
  const [saved, setSaved] = useState<string[]>([]);
  const [status, setStatus] = useState<Record<string, ApplicationStatus>>({});
  const [profileOpen, setProfileOpen] = useState(false);
  const [activeView, setActiveView] = useState<"overview" | "applications">("overview");
  const [liveJobs, setLiveJobs] = useState<Job[]>([]);
  const [greenhouseSlugs, setGreenhouseSlugs] = useState("stripe, linear, notion");
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
    [...demoJobs, ...liveJobs].forEach((job) => unique.set(job.sourceUrl ?? job.id, job));
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
        setSelectedId(restored.liveJobs?.[0]?.id ?? demoJobs[0].id);
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
        if (!response.ok) throw new Error("Could not save local data.");
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

  const ranked = useMemo(() => jobs.map((job) => ({ job, ...scoreJob(job, candidateSkills) }))
    .filter(({ job }) => `${job.role} ${job.company} ${job.location}`.toLowerCase().includes(query.toLowerCase()))
    .filter(({ job }) => location === "All locations" || (location === "Vienna" ? job.location.includes("Vienna") : job.location.includes("Europe") || job.location.includes("Zurich")))
    .sort((a, b) => b.score - a.score), [query, location, candidateSkills, jobs]);
  const selected = ranked.find(({ job }) => job.id === selectedId) ?? ranked[0];
  const strongMatches = jobs.filter((job) => scoreJob(job, candidateSkills).score >= 75).length;
  const reviewedCount = Object.keys(status).length;
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
    setLoadingJobs(true);
    setSourceMessage("");
    setSourceErrors([]);
    try {
      const response = await fetch("/api/jobs/greenhouse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slugs: greenhouseSlugs.split(",").map((slug) => slug.trim()).filter(Boolean) }),
      });
      const result = await response.json() as { jobs?: Job[]; errors?: string[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not fetch jobs.");
      setLiveJobs(result.jobs ?? []);
      setSourceErrors(result.errors ?? []);
      setSourceMessage(`Loaded ${result.jobs?.length ?? 0} live listing${result.jobs?.length === 1 ? "" : "s"}.`);
      if (result.jobs?.length) setSelectedId(result.jobs[0].id);
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
              <div className="application-board">{applicationGroups.map((group) => <section className="application-column" key={group.title}><div className="application-column-heading"><h2>{group.title}</h2><span>{group.items.length}</span></div>{group.items.length ? group.items.map((job) => <article className="application-card" key={job.id}><div className="application-company"><div className={`company-logo logo-${job.source.toLowerCase()}`}>{job.company.slice(0, 1)}</div><div><strong>{job.company}</strong><span>{job.location}</span></div></div><h3>{job.role}</h3><div className="application-card-footer"><span>{job.source}{job.isLive ? " · live" : " · sample"}</span><select aria-label={`Update ${job.company} application status`} value={status[job.id] ?? "Needs review"} onChange={(event) => setStatus((current) => ({ ...current, [job.id]: event.target.value as ApplicationStatus }))}><option>Needs review</option><option>Approved to prepare</option><option>Applied</option><option>Rejected</option></select></div></article>) : <p className="application-empty">No roles here yet.</p>}</section>)}</div>
              <p className="application-footnote">Status changes are saved on this device. “Applied” is a manual record; Jobpilot never submits applications.</p>
            </>
          ) : <>
          <div className="greeting-row"><div><div className="eyebrow">FRIDAY, OCTOBER 2</div><h1>Your next opportunity <span>starts here.</span></h1><p className="subheading">A focused view of roles that fit your experience and career direction.</p></div><button className="primary-button" onClick={() => document.getElementById("greenhouse-slugs")?.focus()}><span>＋</span> Find new jobs</button></div>

          <section className="source-panel"><div><strong>Connect a public Greenhouse board</strong><p>Enter employer board slugs, separated by commas. Example: jobs.acme.com → <code>acme</code></p></div><div className="source-controls"><input id="greenhouse-slugs" value={greenhouseSlugs} onChange={(event) => setGreenhouseSlugs(event.target.value)} aria-label="Greenhouse board slugs" placeholder="company-slug, another-slug"/><button className="secondary-button" disabled={loadingJobs || !greenhouseSlugs.trim()} onClick={fetchLiveJobs}>{loadingJobs ? "Fetching…" : "Fetch listings"}</button></div>{sourceMessage && <p className="source-message" role="status">{sourceMessage}</p>}{sourceErrors.length > 0 && <ul className="source-errors">{sourceErrors.map((error) => <li key={error}>{error}</li>)}</ul>}<p className="source-message" role="status">{storageMessage}</p></section>

          <div className="stats-grid">
            <div className="stat-card"><div className="stat-label">JOBS REVIEWED <span>ⓘ</span></div><div className="stat-bottom"><strong>{reviewedCount}</strong><span className="stat-note">of {jobs.length} sample jobs</span></div><div className="mini-bars"><i/><i/><i/><i/><i/><i/><i/></div></div>
            <div className="stat-card"><div className="stat-label">STRONG MATCHES <span>ⓘ</span></div><div className="stat-bottom"><strong>{String(strongMatches).padStart(2, "0")}</strong><span className="stat-note">Above 75% fit</span></div><div className="match-meter"><i style={{ width: `${strongMatches / jobs.length * 100}%` }} /></div></div>
            <div className="stat-card"><div className="stat-label">SAVED JOBS <span>ⓘ</span></div><div className="stat-bottom"><strong>{String(saved.length).padStart(2, "0")}</strong><span className="stat-note">Kept for later review</span></div><div className="saved-stat-icon">☆</div></div>
            <div className="stat-card source-card"><div className="stat-label">JOB SOURCES <span>ⓘ</span></div><div className="source-logos"><b className="gh">G</b><span>{liveJobs.length ? "Connected" : "Ready"}</span></div><div className="source-foot">Demo listings <i/> Greenhouse public board API</div></div>
          </div>

          <div className="section-heading"><div><h2>Top job matches <span className="result-count">{ranked.length}</span></h2><p>Ranked by skill overlap, role relevance, and your preferences.</p></div><button className="text-button">View all matches <span>→</span></button></div>
          <div className="jobs-layout">
            <section className="jobs-column">
              <div className="filters"><label className="search-box"><span>⌕</span><input id="job-search" placeholder="Search roles or companies..." value={query} onChange={(event) => setQuery(event.target.value)} /></label><select value={location} onChange={(event) => setLocation(event.target.value)} aria-label="Filter by location"><option>All locations</option><option>Vienna</option><option>Remote / Zurich</option></select><button className="filter-button">☷ Filters</button></div>
              <div className="job-list">{ranked.map(({ job, score, matched }) => <button key={job.id} className={`job-card ${selected?.job.id === job.id ? "selected" : ""}`} onClick={() => { setSelectedId(job.id); setStatus((current) => current[job.id] ? current : { ...current, [job.id]: "Needs review" }); }}><div className="job-card-top"><div className={`company-logo logo-${job.source.toLowerCase()}`}>{job.company.slice(0, 1)}</div><span className="match-tag">{score}% match</span></div><div className="job-title">{job.role}</div><div className="company-name">{job.company} <span>·</span> {job.location}</div><div className="job-meta"><span>◷ {job.posted}</span><span>⌂ {job.mode}</span><span className="source-tag">{job.source} · demo</span></div><div className="job-card-bottom"><div className="skill-pills">{matched.slice(0, 3).map((skill) => <span key={skill}>{skill}</span>)}{matched.length > 3 && <span className="more-skills">+{matched.length - 3}</span>}</div><span className={`bookmark ${saved.includes(job.id) ? "bookmarked" : ""}`} onClick={(event) => { event.stopPropagation(); setSaved((current) => current.includes(job.id) ? current.filter((id) => id !== job.id) : [...current, job.id]); }} aria-label="Save job">{saved.includes(job.id) ? "★" : "☆"}</span></div></button>)}</div>
              {ranked.length === 0 && <div className="empty-state">No jobs match those filters. Try another search or location.</div>}
              <button className="load-more" onClick={() => setQuery("")}>Show all jobs <span>→</span></button>
            </section>

            {selected ? (
              <aside className="detail-card">
                <div className="detail-actions">
                <span className="detail-source"><i /> {selected.job.source}{selected.job.isLive ? " live listing" : " demo listing"}</span>
                  <button className="icon-button" onClick={() => setSaved((current) => current.includes(selected.job.id) ? current.filter((id) => id !== selected.job.id) : [...current, selected.job.id])} aria-label="Save selected job">{saved.includes(selected.job.id) ? "★" : "☆"}</button>
                  <button className="icon-button" aria-label="More options">···</button>
                </div>
                <div className="detail-company"><div className={`company-logo big-logo logo-${selected.job.source.toLowerCase()}`}>{selected.job.company.slice(0, 1)}</div><div><h3>{selected.job.company}</h3><span>{selected.job.location} · {selected.job.mode}</span></div></div>
                <h2 className="detail-title">{selected.job.role}</h2>
                <div className="detail-sub">Full-time <i/> Posted {selected.job.posted} {selected.job.retrievedAt && <><i/> Retrieved {new Date(selected.job.retrievedAt).toLocaleString()}</>}</div>
                <div className="detail-buttons"><a href="#job-description" className="primary-button apply-button">Review details <span>↓</span></a><button className="secondary-button" onClick={() => setStatus((current) => ({ ...current, [selected.job.id]: current[selected.job.id] === "Approved to prepare" ? "Needs review" : "Approved to prepare" }))}>{status[selected.job.id] === "Approved to prepare" ? "✓ Approved to prepare" : "Approve preparation"}</button></div>
                <div className="divider"/>
                <div className="fit-heading"><div><h4>Your match <span className="info-dot">i</span></h4><p>Based on skills in your candidate profile</p></div><div className="score-ring" style={{ "--score": `${selected.score}%` } as React.CSSProperties}><span>{selected.score}%</span></div></div>
                <div className="fit-meter"><i style={{ width: `${selected.score}%` }}/></div>
                <div className="evidence-label">MATCHING SKILLS <span>{selected.matched.length} found</span></div>
                <div className="evidence-pills">{selected.matched.map((skill) => <span key={skill}>✓ {skill}</span>)}</div>
                {selected.missing.length > 0 && <><div className="evidence-label gap-label">GAPS TO REVIEW <span>{selected.missing.length} requirement{selected.missing.length === 1 ? "" : "s"}</span></div><div className="evidence-pills missing-pills">{selected.missing.map((skill) => <span key={skill}>! {skill}</span>)}</div></>}
                <div className="divider"/>
                <div id="job-description" className="description"><h4>Role summary</h4><p>{selected.job.summary}</p><h4>Source and next step</h4>{selected.job.sourceUrl ? <p><a href={selected.job.sourceUrl} target="_blank" rel="noreferrer">Open original posting ↗</a></p> : <p>This role is sample data with no live source link.</p>}</div>
                <div className="review-note"><span>◉</span><p><strong>Human review required</strong><br/>Approval only authorizes preparation; it does not submit an application.</p></div>
              </aside>
            ) : <aside className="detail-card empty-detail">Select a job to inspect its match evidence.</aside>}
          </div>
          <footer className="page-footer"><span>JOBPILOT <b>·</b> LOCAL-FIRST JOB SEARCH</span><span>Sample data · Nothing is submitted automatically</span></footer>
          </>}
        </div>
      </section>
      {profileOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileOpen(false); }}><section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title"><div className="modal-heading"><div><span className="eyebrow">YOUR LOCAL SEARCH PROFILE</span><h2 id="profile-title">Candidate profile</h2><p>These editable details are stored in a file on this device.</p></div><button className="icon-button" onClick={() => setProfileOpen(false)} aria-label="Close profile">×</button></div><label>Display name<input value={profileDraft.name} onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })}/></label><label>Target roles<textarea rows={2} value={profileDraft.roles} onChange={(event) => setProfileDraft({ ...profileDraft, roles: event.target.value })}/></label><label>Preferred locations<textarea rows={2} value={profileDraft.locations} onChange={(event) => setProfileDraft({ ...profileDraft, locations: event.target.value })}/></label><label>Skills <span className="field-hint">Separate skills with commas. Matching updates immediately after saving.</span><textarea rows={4} value={profileDraft.skills} onChange={(event) => setProfileDraft({ ...profileDraft, skills: event.target.value })}/></label><div className="modal-actions"><button className="secondary-button" onClick={() => setProfileDraft(defaultProfile)}>Reset demo profile</button><button className="primary-button" onClick={() => { setProfile({ ...profileDraft, name: profileDraft.name.trim() || "Candidate" }); setProfileOpen(false); }}>Save profile</button></div><p className="privacy-explainer">Local files are not encrypted. Avoid importing a real CV or storing sensitive personal data until encryption is implemented.</p></section></div>}
    </main>
  );
}
