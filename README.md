# Jobpilot

A local-first job-search assistant prototype built with Next.js and TypeScript. It ranks sample roles using transparent skill matching, lets you review evidence and gaps, and can fetch listings from Greenhouse public boards.

> **Prototype status:** This early portfolio project does not parse CVs, generate application documents, submit applications, or use an AI model. Job and candidate data start as demo data. The profile, review decisions, saved jobs, and fetched listings are stored in a local file on this device.

## Features

- Editable candidate search profile with target roles, locations, and skills.
- Explainable skill-overlap scores with matched and missing requirements.
- Search, location filtering, saved jobs, and review/preparation status.
- On-demand Greenhouse public-board listing fetch with source URLs and retrieval times.
- Fetched listings and review state persist after reloads.
- One-time migration of the previous browser-local profile and review data.
- Vitest coverage for matching and local persistence.

The review action only records approval to prepare materials. It never submits an application. Greenhouse board slugs are entered explicitly; the app does not crawl job boards.

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

## Roadmap

1. Import a CV into structured facts that the user reviews and confirms, after adding encryption at rest.
2. Add another permitted public job source and a more detailed application history.
3. Improve matching with separate role, location, and skills evidence.
4. Draft tailored documents from verified facts, with preview and explicit human approval.
5. Add a local model connection and evaluate its outputs against known examples.

## Privacy and repository contents

This repository contains generic candidate and job examples only. Do not commit a real CV, personal job-search profile, credentials, or `.env` files. Local state is stored outside the repository.
