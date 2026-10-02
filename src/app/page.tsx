"use client";

import { useEffect, useMemo, useState } from "react";
import type { CandidateProfile, Job } from "@/lib/types";
import { demoJobs } from "@/lib/jobs";
import { scoreJob } from "@/lib/matcher";

const defaultProfile: CandidateProfile = {
  name: "Demo Candidate",
  roles: "Full-Stack Engineer, AI Engineer, Solution Architect",
  locations: "Vienna, Austria; Remote Europe",
  skills: "TypeScript, React, Next.js, Node.js, PostgreSQL, AWS, Docker, Kubernetes, CI/CD, REST APIs, System design, Playwright",
};

const STORAGE_KEY = "jobpilot-local-v1";

function readStoredState() {
  if (typeof window === "undefined") return { profile: defaultProfile, saved: [] as string[], status: {} as Record<string, string> };
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return { profile: defaultProfile, saved: [] as string[], status: {} as Record<string, string> };
    const parsed = JSON.parse(stored) as { profile?: CandidateProfile; saved?: string[]; status?: Record<string, string> };
    return { profile: parsed.profile ?? defaultProfile, saved: parsed.saved ?? [], status: parsed.status ?? {} };
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return { profile: defaultProfile, saved: [] as string[], status: {} as Record<string, string> };
  }
}

export default function Home() {
  const [initialState] = useState(readStoredState);
  const [profile, setProfile] = useState<CandidateProfile>(initialState.profile);
  const [selectedId, setSelectedId] = useState(demoJobs[0].id);
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("All locations");
  const [saved, setSaved] = useState<string[]>(initialState.saved);
  const [status, setStatus] = useState<Record<string, string>>(initialState.status);
  const [profileOpen, setProfileOpen] = useState(false);
  const [liveJobs, setLiveJobs] = useState<Job[]>([]);
  const [greenhouseSlugs, setGreenhouseSlugs] = useState("stripe, linear, notion");
  const [loadingJobs, setLoadingJobs] = useState(false);
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
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ profile, saved, status }));
  }, [profile, saved, status]);

  const ranked = useMemo(() => jobs.map((job) => ({ job, ...scoreJob(job, candidateSkills) }))
    .filter(({ job }) => `${job.role} ${job.company} ${job.location}`.toLowerCase().includes(query.toLowerCase()))
    .filter(({ job }) => location === "All locations" || (location === "Vienna" ? job.location.includes("Vienna") : job.location.includes("Europe") || job.location.includes("Zurich")))
    .sort((a, b) => b.score - a.score), [query, location, candidateSkills, jobs]);
  const selected = ranked.find(({ job }) => job.id === selectedId) ?? ranked[0];
  const strongMatches = jobs.filter((job) => scoreJob(job, candidateSkills).score >= 75).length;
  const reviewedCount = Object.keys(status).length;

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
        <button className="nav-item active"><span>▦</span> Overview</button>
        <button className="nav-item"><span>⌕</span> Job matches <b className="nav-count">{ranked.length}</b></button>
        <button className="nav-item"><span>▤</span> Applications <span className="nav-soon">Soon</span></button>
        <button className="nav-item" onClick={openProfile}><span>♧</span> Candidate profile</button>
        <div className="sidebar-bottom">
          <div className="local-status"><i /> Local workspace <span>●</span></div>
          <button className="profile-chip profile-chip-button" onClick={openProfile}><div className="avatar">{profile.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</div><div><strong>{profile.name}</strong><small>Private to this device</small></div><span className="more">···</span></button>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> Overview</div><div className="topbar-right"><span className="privacy-pill"><i /> LOCAL ONLY</span><button className="icon-button" aria-label="Edit candidate profile" onClick={openProfile}>⚙</button><div className="avatar small">{profile.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</div></div></header>
        <div className="content">
          <div className="greeting-row"><div><div className="eyebrow">FRIDAY, OCTOBER 2</div><h1>Your next opportunity <span>starts here.</span></h1><p className="subheading">A focused view of roles that fit your experience and career direction.</p></div><button className="primary-button" onClick={() => document.getElementById("greenhouse-slugs")?.focus()}><span>＋</span> Find new jobs</button></div>

          <section className="source-panel"><div><strong>Connect a public Greenhouse board</strong><p>Enter employer board slugs, separated by commas. Example: jobs.acme.com → <code>acme</code></p></div><div className="source-controls"><input id="greenhouse-slugs" value={greenhouseSlugs} onChange={(event) => setGreenhouseSlugs(event.target.value)} aria-label="Greenhouse board slugs" placeholder="company-slug, another-slug"/><button className="secondary-button" disabled={loadingJobs || !greenhouseSlugs.trim()} onClick={fetchLiveJobs}>{loadingJobs ? "Fetching…" : "Fetch listings"}</button></div>{sourceMessage && <p className="source-message" role="status">{sourceMessage}</p>}{sourceErrors.length > 0 && <ul className="source-errors">{sourceErrors.map((error) => <li key={error}>{error}</li>)}</ul>}</section>

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
              <div className="job-list">{ranked.map(({ job, score, matched }) => <button key={job.id} className={`job-card ${selected?.job.id === job.id ? "selected" : ""}`} onClick={() => { setSelectedId(job.id); setStatus((current) => current[job.id] ? current : { ...current, [job.id]: "Needs review" }); }}><div className="job-card-top"><div className={`company-logo log