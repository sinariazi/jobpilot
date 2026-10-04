# Jobpilot

A local-first job-search assistant built with Next.js and TypeScript. It searches multiple public job feeds automatically, filters listings against the candidate's preferred locations and profile evidence, and explains which target roles and skills matched.

> **Current scope:** Jobpilot is an early-stage, local-first job-search and application-preparation agent. It searches public feeds from Arbeitnow (Europe-wide), Remotive (remote), and Jobicy (Europe remote), but does not cover every employer or vacancy. Matching is deterministic. When Ollama is running on the same laptop, Jobpilot can use an installed local model to draft a cover letter; candidate text stays on the laptop. CV import currently extracts role and skill suggestions only. Jobpilot does not yet tailor CVs or submit applications.

## Working now

- Searches three broad public job feeds automatically; no company names, board slugs, or employer setup are required. Each listing links to its provider or original listing, with visible source attribution.
- Filters listings using locations in the editable candidate profile. An empty location means any location; an unqualified “Remote” listing is not assumed to be available in a specific country.
- Filters loaded listings by keywords, posting age, work mode, and department when those feed details are available. Results appear in batches of 25; **Show more** reveals additional jobs already fetched.
- Hides listings without a profile relevance signal: a target-role match, a profile skill in the title, or at least one (for profiles with one or two skills) / two (for larger profiles) skills in the title or description. The UI marks title evidence; the percentage is a text overlap indicator, not a probability of getting the job.
- Imports text-based PDF, DOCX, and TXT CVs in the browser and proposes past role titles and skills for review. The CV file and extracted full text are not uploaded or saved; only fields the user accepts and then saves are written to the local profile.
- Caches the Remotive feed for six hours in keeping with its published request guidance, the Jobicy feed for at least one hour in keeping with its polling guidance, and Arbeitnow feeds for 30 minutes.
- Saves live listings, saved jobs, application statuses, per-job notes, and editable cover-letter drafts to local JSON storage.
- Exports and restores a versioned JSON backup of the local profile, listings, saved jobs, application statuses, notes, and cover-letter drafts; restores are validated and require confirmation.
- Includes a manual application tracker with status and private per-job notes. It never submits an application.
- Creates an editable cover-letter first draft for a selected job using its role and company, exact profile skill overlaps, and user-entered interest and experience details. Missing personal claims are shown as placeholders; drafts are saved locally and included in backups.
- Can create an AI-written cover-letter draft with an Ollama model running locally. Jobpilot discovers installed models and lets the user choose one. Inference is sent only to the loopback Ollama service on this laptop; there is no hosted AI provider or API key. An offline template remains available when Ollama is unavailable.
- Migrates prior browser-local profile and review state on first launch.
- Lint, typecheck, Vitest, and production build run in GitHub Actions.

## TODO

- Add local-model semantic CV-to-job matching. Current filtering is deterministic exact-phrase matching, so related wording and equivalent job titles can be missed; it does not send the CV to Ollama.
- Improve location normalization for city/country aliases and location formats used by job feeds. Ambiguous remote listings are excluded for country-specific preferences unless a compatible region is stated or known from the feed query.
- Add a licensed, broad-coverage job search provider to find roles beyond the current public feeds and geographies; public feeds do not contain every employer or vacancy.
- Add more job-source adapters after checking each provider's API and display/attribution terms.
- Add further filters only when source feeds provide reliable structured fields; current filters cover posting age, inferred work mode, and available department tags.
- Add provider-side pagination so searches can retrieve more than each feed's current fetched batch; “Show more” currently reveals jobs already retrieved.
- Add OCR for scanned/image-only CVs; current parsing requires selectable text.
- Improve layout-aware parsing for multi-column CVs and more heading formats; extraction is heuristic and suggestions require user review.
- Encrypt local profile and tracker data, which can include sensitive details accepted from a CV.
- Tailor and export the candidate's CV using verified CV source material; CV import currently extracts role and skill suggestions only.
- Add application-form preparation and employer-specific ATS integrations. Jobpilot currently opens the original posting but does not fill or submit external forms.
- Improve AI drafting with editable user preferences, structured outputs, and stronger source-to-claim verification; the current AI feature only drafts a cover letter.
- Add accessibility and responsive-layout review across supported browsers and screen sizes.
- Add automated end-to-end tests for the main job search, details, profile, and tracking workflows.
- Add optional follow-up dates and reminders to the application tracker.
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

**Privacy:** CV parsing runs in the browser. The selected file and extracted full text are held in memory for parsing and are not uploaded or saved. If you accept suggestions and save the profile, those role and skill fields are written to the local JSON state file, which is not encrypted. Cover-letter source notes and drafts are also stored locally and in downloaded backups, which are unencrypted JSON. Jobpilot sends no candidate data to job-feed providers. For AI cover-letter drafting, job details, profile name and skills, and entered interest/evidence notes are sent to Ollama on the same laptop. The CV file and full extracted text are not sent to the model. The old browser-local profile is moved to the local file on first launch and removed from browser storage after that succeeds.

## Local AI setup

### 1. Install and start Ollama

Download Ollama for your operating system from [ollama.com/download](https://ollama.com/download), install it, and open the Ollama app. Leave it running while you use Jobpilot. Ollama is the local program that loads and runs the AI model on your laptop.

### 2. Download a model

Open Terminal (on macOS, open **Applications → Utilities → Terminal**) and run this example:

```bash
ollama pull qwen3:4b
```

This downloads the model to your laptop. You can choose another model from the [Ollama model library](https://ollama.com/library); larger models can require more disk space and memory. After downloading, check that Ollama can see it:

```bash
ollama ls
```

The model name shown by `ollama list` is the name Jobpilot will show you.

### 3. Start Jobpilot and select the model

In the Jobpilot project folder, start the app if it is not already running:

```bash
npm run dev
```

Open <http://localhost:3000>, search for jobs, select one, and open **Create draft** in the job details. Choose the installed model from **Local AI model**, enter your interest and a true example from your experience, then select **Generate on this laptop**. Jobpilot saves the draft locally; review it before using it.

### If Jobpilot cannot see the model

1. Make sure the Ollama app is open and still running.
2. In Terminal, run `ollama ls` and confirm the model appears. If it does not, repeat the `ollama pull <model-name>` command using the model name from the [Ollama library](https://ollama.com/library).
3. Reload Jobpilot so it checks Ollama again. The model picker lists only models Ollama has installed.
4. If you changed Ollama's default local address or port, copy `.env.example` to `.env.local`, set `OLLAMA_BASE_URL` to Ollama's **local loopback** address, and restart Jobpilot. Jobpilot rejects remote addresses to keep candidate text on your laptop.

No AI API key or hosted AI account is needed. Jobpilot sends the selected job details, your profile name and skills, and the notes you enter to Ollama on this laptop. It does not send the CV file or full CV text to the model. Job discovery still needs an internet connection. Model speed and output quality depend on your model and laptop hardware.

## Search jobs

Select **Search jobs now** in the overview. Jobpilot retrieves listings from public feeds and filters them against preferred locations and saved profile evidence. Jobs must match a target role, a profile skill in the title, or the minimum skill overlap before they appear. Matching uses exact normalized phrases; semantic similarity is not implemented yet. The displayed percentage is the share of profile skills found in the posting text, not an estimate of hiring chances.

Enter preferred locations explicitly in **Candidate profile**. Separate alternatives with semicolons, for example `Austria; Remote Europe`. Leave the field blank only if you want jobs from any location. CV addresses are not imported or used as preferences. A generic `Remote` label does not identify eligible countries; select `Remote` explicitly if you want all such postings.

Use the keyword box to search role, company, location, and department text. The posting-age filter offers any date, the last 7 days, or the last 30 days; listings without a publication date are omitted when a date range is selected. Work-mode filtering uses the feed's mode and location text, so an employer's listing is the source of truth. Department choices come from the current results and appear only when a feed provides department information. **Show more jobs** displays 25 more entries from the retrieved batch; it does not request another batch from the providers.

The app preserves each provider's job URL and displays source attribution. Remotive listings are delayed by 24 hours; its public API asks consumers to request data no more than four times per day, so the app caches that feed for six hours. Jobicy requests are cached for at least one hour per its polling guidance.

## Back up or restore local data

Open **Candidate profile** and use the **Data backup** controls. **Download backup** saves a versioned JSON file containing the profile, fetched listings, saved jobs, application statuses, notes, and cover-letter drafts. **Restore backup** accepts a Jobpilot backup, validates it, and asks for confirmation before replacing the current local state. Keep backup files private: they contain profile data and are not encrypted.

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
