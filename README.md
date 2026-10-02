# Jobpilot

A local-first job-search assistant prototype built with Next.js and TypeScript. It ranks sample roles using transparent skill matching, lets you review evidence and gaps, and can fetch listings from Greenhouse public boards.

> **Prototype status:** This is an early portfolio project. It does not parse CVs, generate application documents, submit applications, or use an AI model. Job and candidate data are demo data. Candidate settings are stored in browser local storage, which is not encrypted.

## Features

- Editable candidate search profile with target roles, locations, and skills.
- Explainable skill-overlap scores with matched and missing requirements.
- Search, location filtering, saved jobs, and review/preparation status.
- On-demand Greenhouse public-board listing fetch with source URLs and retrieval times.
- Duplicate handling for listings and per-board error reporting.
- Vitest coverage for the matching logic.

The review action only records approval to prepare materials. It never submits an application. Greenhouse board slugs are entered explicitly; the app does not crawl job boards.

## Tech stack

- Next.js 16, React 19, TypeScript
- Browser `localStorage` for prototype state
- Greenhouse Job Board API for optional live listings
- Vitest, ESLint, TypeScript

## Run locally

Requirements: Node.js 20.9 or newer and npm.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

Candidate profile details and review state remain in the current browser on the current device. Do not enter sensitive personal information. Live listings are held in page memory and must be fetched again after a reload.

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

1. Import a CV into structured facts that the user reviews and confirms.
2. Add another permitted public job source and persistent local job history.
3. Improve matching with separate role, location, and skills evidence.
4. Draft tailored CVs and cover letters from verified facts, with preview and explicit human approval.
5. Add secure local persistence before supporting sensitive candidate data.

## Privacy

The repository contains sample candidate and job data only. Do not commit a real CV, personal job-search profile, credentials, or `.env` files. Browser local storage is not encrypted.
