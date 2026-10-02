# Jobpilot

A local-first job-search assistant built with Next.js and TypeScript. It searches multiple public job feeds automatically, filters listings against the candidate's preferred locations, and ranks roles using profile target titles and transparent skill matching.

> **Current scope:** Jobpilot searches public feeds from Arbeitnow (Europe-wide), Remotive (remote), and Jobicy (Europe remote). This improves discovery without requiring employer names, but it does not cover every employer or job board. CV import extracts reviewable suggestions from text-based files in the browser. It does not generate application documents, submit applications, or use an AI model. The profile, review decisions, saved jobs, and fetched listings are stored in a local file on this device.

## Working now

- Searches three broad public job feeds automatically; no company names, board slugs, or employer setup are required. Each listing links to its provider or original listing, with visible source attribution.
- Filters listings using locations in the editable candidate profile. New profiles have no location preference until the user enters one.
- Filters loaded listings by keywords, posting age, work mode, and department when those feed details are available. Results appear in batches of 25; **Show more** reveals additional jobs already fetched.
- Ranks target role title matches first, then skills explicitly mentioned in the job title, then overall profile skill coverage. The UI marks title evidence; the percentage is a text overlap indicator, not a probability of getting the job.
- Imports text-based PDF, DOCX, and TXT CVs in the browser and proposes past role titles and skills for review. The CV file and extracted full text are not uploaded or saved; only fields the user accepts and then saves are written to the local profile.
- Caches the Remotive feed for six hours in keeping with its published request guidance, the Jobicy feed for at least one hour in keeping with its polling guidance, and Arbeitnow feeds for 30 minutes.
- Saves live listings, saved jobs, application statuses, and the candidate profile to local JSON storage.
- Exports and restores a versioned JSON backup of the local profile, listings, saved jobs, and application statuses; restores are validated and require confirmation.
- Includes a manual application tracker. It never submits an application.
- Migrates prior browser-local profile and review state on first launch.
- Lint, typecheck, Vitest, and production build run in GitHub Actions.

## TODO

- Add semantic skill matching; matching currently counts exact normalized phrases only, though ranking shows and prioritizes title evidence.
- Add a licensed, broad-coverage job search provider to find roles beyond the current public feeds and geographies; public feeds do not contain every employer or vacancy.
- Add more job-source adapters after checking each provider's API and display/attribution terms.
- Add further filters only when source feeds provide reliable structured fields; current filters cover posting age, inferred work mode, and available department tags.
- Add provider-side pagination so searches can retrieve more than each feed's current fetched batch; “Show more” currently reveals jobs already retrieved.
- Add OCR for scanned/image-only CVs; current parsing requires selectable text.
- Improve layout-aware parsing for multi-column CVs and more heading formats; extraction is heuristic and suggestions require user review.
- Encrypt local profile and tracker data, which can include sensitive details accepted from a CV.
- Draft application documents for user review; AI-assisted drafting is not implemented.
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

Requirements: Node.js 22.13 or newer and npm.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

The app stores data in `~/.jobpilot/state.json` (the current user's home directory). You can change the folder with `JOBPILOT_DATA_DIR`. Keep the app bound to `localhost`; don't expose it on your network.

**Privacy:** CV parsing runs in the browser. The selected file and extracted full text are held in memory for parsing and are not uploaded or saved. If you accept suggestions and save the profile, those role and skill fields are written to the local JSON state file, which is not encrypted. Downloaded backups are also unencrypted JSON. Nothing from the candidate profile is sent to job feed providers. The old browser-local profile is moved to the local file on first launch and removed from browser storage after that succeeds.

## Search jobs

Select **Search jobs now** in the overview. Jobpilot retrieves listings from public feeds and filters them against preferred locations in the local profile. Add target role titles to rank title matches first. Skills named in a job title are prioritized next, followed by overall profile skill coverage; the displayed percentage is the share of profile skills found in the posting text.

Use the keyword box to search role, company, location, and department text. The posting-age filter offers any date, the last 7 days, or the last 30 days; listings without a publication date are omitted when a date range is selected. Work-mode filtering uses the feed's mode and location text, so an employer's listing is the source of truth. Department choices come from the current results and appear only when a feed provides department information. **Show more jobs** displays 25 more entries from the retrieved batch; it does not request another batch from the providers.

The app preserves each provider's job URL and displays source attribution. Remotive listings are delayed by 24 hours; its public API asks consumers to request data no more than four times per day, so the app caches that feed for six hours. Jobicy requests are cached for at least one hour per its polling guidance.

## Back up or restore local data

Open **Candidate profile** and use the **Data backup** controls. **Download backup** saves a versioned JSON file containing the profile, fetched listings, saved jobs, and application statuses. **Restore backup** accepts a Jobpilot backup, validates it, and asks for confirmation before replacing the current local state. Keep backup files private: they contain profile data and are not encrypted.

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
