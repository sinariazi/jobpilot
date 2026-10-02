# Jobpilot

A local-first job-search assistant built with Next.js and TypeScript. It searches multiple public job feeds automatically, filters listings against the candidate's preferred locations, and ranks roles using profile target titles and transparent skill matching.

> **Current scope:** Jobpilot searches public feeds from Arbeitnow (Europe-wide), Remotive (remote), and Jobicy (Europe remote). This improves discovery without requiring employer names, but it does not cover every employer or job board. It does not parse CVs, generate application documents, submit applications, or use an AI model. The profile, review decisions, saved jobs, and fetched listings are stored in a local file on this device.

## Working now

- Searches three broad public job feeds automatically; no company names, board slugs, or employer setup are required. Each listing links to its provider or original listing, with visible source attribution.
- Filters listings using locations in the editable candidate profile. New profiles have no location preference until the user enters one.
- Ranks matching target role titles first, then sorts by exact, normalized mentions of user-entered skills in the role title and description. The UI shows which skills were mentioned; this is a text overlap indicator, not a probability of getting the job.
- Caches the Remotive feed for six hours in keeping with its published request guidance, the Jobicy feed for at least one hour in keeping with its polling guidance, and Arbeitnow feeds for 30 minutes.
- Saves live listings, saved jobs, application statuses, and the candidate profile to local JSON storage.
- Includes a manual application tracker. It never submits an application.
- Migrates prior browser-local profile and review state on first launch.
- Lint, typecheck, Vitest, and production build run in GitHub Actions.

## TODO

- Evaluate semantic skill matching and add explainable ranking criteria; ranking currently counts exact normalized skill mentions only.
- Add a licensed, broad-coverage job search provider to find roles beyond the current public feeds and geographies; public feeds do not contain every employer or vacancy.
- Add more job-source adapters after checking each provider's API and display/attribution terms.
- Add filters for date, work mode, and department; the current search box only searches title, company, and location.
- Add pagination or incremental loading for large result sets.
- Import CV details only after the user reviews and confirms extracted profile facts.
- Encrypt local data before supporting CVs or other sensitive personal information.
- Draft application documents for user review; AI-assisted drafting is not implemented.
- Add export and backup/restore for the local profile and application tracker.
- Add accessibility and responsive-layout review across supported browsers and screen sizes.
- Add automated end-to-end tests for the main job search, details, profile, and tracking workflows.
- Decide whether application submission will remain manual; the current tracker never submits applications.

The app fetches public listings from its configured feeds and applies location and role preferences locally. Candidate profile fields are not sent to feed providers. Feed coverage, update frequency, and availability depend on each provider.

## Tech stack

- Next.js 16, React 19, TypeScript
- Node.js file APIs for local JSON persistence
- Arbeitnow, Remotive, and Jobicy public job feeds
- Vitest, ESLint, TypeScript

## Run locally

Requirements: Node.js 20.9 or newer and npm.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

The app stores data in `~/.jobpilot/state.json` (the current user's home directory). You can change the folder with `JOBPILOT_DATA_DIR`. Keep the app bound to `localhost`; don't expose it on your network.

**Privacy:** The local file is not encrypted. Its folder and file use restrictive permissions on macOS and Linux, but this is not a substitute for encryption. Don't import a real CV or store sensitive personal data yet. Nothing from the candidate profile is sent to the Greenhouse API; the app only fetches public job listings. The old browser-local profile is moved to the local file on first launch and removed from browser storage after that succeeds.

## Search jobs

Select **Search jobs now** in the overview. Jobpilot retrieves listings from public feeds and filters them against preferred locations in the local profile. Add target role titles to rank those titles first and skills to see exact text matches. The app preserves each provider's job URL and displays source attribution. Remotive listings are delayed by 24 hours; its public API asks consumers to request data no more than four times per day, so the app caches that feed for six hours. Jobicy requests are cached for at least one hour per its polling guidance.

## Development checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

GitHub Actions runs these checks for pushes and pull requests.

## Privacy and repository contents

This repository contains no seeded job listings, employer boards, or personal candidate facts. The generic profile label is a UI default; all candidate preferences come from the user's profile. Public feed endpoint URLs are integration constants. Test fixtures use example values only to verify behavior. Do not commit a real CV, personal job-search profile, credentials, or `.env` files. Local state is stored outside the repository.
