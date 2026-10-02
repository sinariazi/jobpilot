# Jobpilot

A local-first job-search assistant built with Next.js and TypeScript. It fetches live listings from Greenhouse boards, filters them against the candidate's preferred locations, and ranks jobs using transparent skill matching.

> **Current scope:** The app does not parse CVs, generate application documents, submit applications, or use an AI model. It shows live Greenhouse listings only. The profile, review decisions, saved jobs, and fetched listings are stored in a local file on this device.

## Working now

- Fetches live listings from Greenhouse board slugs entered by the user. No fake job cards or preset boards are included.
- Filters listings using locations in the editable candidate profile. New profiles have no location preference until the user enters one.
- Sorts jobs by exact, normalized mentions of user-entered skills in the role title and description. The UI shows which entered skills were mentioned; this is a text overlap indicator, not a probability of getting the job.
- Saves live listings, saved jobs, application statuses, and the candidate profile to local JSON storage.
- Includes a manual application tracker. It never submits an application.
- Migrates prior browser-local profile and review state on first launch.
- Lint, typecheck, Vitest, and production build run in GitHub Actions.

## TODO

- Use candidate target roles when ranking listings; they are saved but currently do not affect results.
- Evaluate semantic skill matching and add explainable ranking criteria; ranking currently counts exact normalized skill mentions only.
- Discover job boards and listings automatically; users currently enter Greenhouse board slugs themselves.
- Add job-source adapters beyond Greenhouse.
- Add filters for date, work mode, and department; the current search box only searches title, company, and location.
- Add pagination or incremental loading for large result sets.
- Import CV details only after the user reviews and confirms extracted profile facts.
- Encrypt local data before supporting CVs or other sensitive personal information.
- Draft application documents for user review; AI-assisted drafting is not implemented.
- Add export and backup/restore for the local profile and application tracker.
- Add accessibility and responsive-layout review across supported browsers and screen sizes.
- Add automated end-to-end tests for the main job search, details, profile, and tracking workflows.
- Decide whether application submission will remain manual; the current tracker never submits applications.

Greenhouse board slugs are entered explicitly. The app does not crawl job boards. Target roles are stored but do not currently affect ranking.

## Tech stack

- Next.js 16, React 19, TypeScript
- Node.js file APIs for local JSON persistence
- Greenhouse Job Board API for optional live listings
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

## Fetch Greenhouse listings

Enter one or more public Greenhouse board slugs, separated by commas, then select **Fetch listings**. For example, `boards.greenhouse.io/acme` uses the slug `acme`.

The app calls the public Greenhouse Job Board API from a Next.js route. It only retrieves listings and does not submit applications. See the [Greenhouse Job Board API documentation](https://docs.greenhouse.io/job-board.html).

## Development checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

GitHub Actions runs these checks for pushes and pull requests.

## Privacy and repository contents

This repository contains no seeded job listings, employer boards, or personal candidate facts. The generic profile label is a UI default; all candidate preferences come from the user's profile. Greenhouse is the only implemented listings integration and its public API endpoint is an integration constant. Test fixtures use example values only to verify behavior. Do not commit a real CV, personal job-search profile, credentials, or `.env` files. Local state is stored outside the repository.
