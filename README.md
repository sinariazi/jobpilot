# Jobpilot

A local-first job-search assistant built with Next.js and TypeScript. It searches multiple public job feeds automatically, filters listings against the candidate's preferred locations and profile evidence, and explains which target roles and skills matched.

> **Current scope:** Jobpilot is an early-stage, local-first job-search and application-preparation agent. It searches public feeds from Arbeitnow (Europe-wide), Remotive (remote), and Jobicy (Europe remote), but does not cover every employer or vacancy. With a CV loaded and Ollama running locally, the selected model assesses job fit and gives evidence-based explanations. CV parsing runs in the browser; extracted text is sent only to Ollama on this laptop for profile analysis and job matching. Jobpilot does not yet tailor CVs or submit applications.

## Working now

- Searches three broad public job feeds automatically; no company names, board slugs, or employer setup are required. Each listing links to its provider or original listing, with visible source attribution.
- Filters listings using locations in the editable candidate profile. Common English/German aliases for Vienna, Graz, Linz, Salzburg, Innsbruck, Klagenfurt, Bregenz, St. Pölten, Munich, Cologne, Zurich, Geneva, and Prague are normalized; some city-only listings can match their country. An empty location means any location; an unqualified “Remote” listing is not assumed to be available in a specific country.
- Filters loaded listings by keywords, posting age, work mode, and department when those feed details are available; sorts by best match, newest, or company name. Without a successful CV assessment, “best match” prioritizes target-role matches and exact skill evidence. The fallback percentage measures skill overlap only, not overall fit. Results appear in batches of 25; **Show more** reveals fetched jobs, while **Load more jobs from Arbeitnow** requests the next provider pages.
- Imports text-based PDF, DOCX, and TXT CVs in the browser. When local Ollama is available, it analyzes the CV, shows an in-app preview for PDFs, extracted text, summary, and evidence, and automatically fills and saves target roles and skills in the local profile. Name and preferred location are not inferred. The selected file and full text remain in memory and are not saved.
- When a CV and local Ollama model are available, semantically assesses up to 60 location-eligible jobs per search in batches of four, using at most the first 30,000 CV text characters for responsiveness. Results include a relevance decision, fit estimate, and the CV evidence behind the match; no CV text is stored.
- Without local AI matching, hides listings without an exact profile signal: a target-role match, a profile skill in the title, or at least one (for profiles with one or two skills) / two (for larger profiles) skills in the title or description. Keyword percentages are text overlap indicators, not probabilities of getting a job.
- Caches the Remotive feed for six hours in keeping with its published request guidance, the Jobicy feed for at least one hour in keeping with its polling guidance, and Arbeitnow feeds for 30 minutes.
- Saves live listings, saved jobs, application statuses, per-job notes and follow-up dates, and editable cover-letter drafts to local JSON storage. Follow-up dates show upcoming, due-today, or overdue reminders in the tracker; no operating-system notification is sent.
- Exports and restores a versioned JSON backup of the local profile, listings, saved jobs, application statuses, notes, follow-up dates, and cover-letter drafts; restores are validated and require confirmation.
- Includes a manual application tracker with status and private per-job notes. It never submits an application.
- Creates an editable cover-letter first draft for a selected job using its role and company, exact profile skill overlaps, and user-entered interest and experience details. Missing personal claims are shown as placeholders; drafts are saved locally and included in backups.
- Can create an AI-written cover-letter draft with an Ollama model running locally. Jobpilot discovers installed models and lets the user choose one. Inference is sent only to the loopback Ollama service on this laptop; there is no hosted AI provider or API key. An offline template remains available when Ollama is unavailable.
- Migrates prior browser-local profile and review state on first launch.
- Lint, typecheck, Vitest, and production build run in GitHub Actions.

## TODO

- Expand AI assessment beyond the first 60 location-eligible jobs and add progress/cancellation controls for larger searches.
- Improve inference resilience and latency for slower local models; small batches and a 30,000-character CV limit reduce context pressure, but model speed varies by laptop.
- Calibrate local-model fit estimates and evaluate false-positive/false-negative rates against reviewed matches; model explanations are estimates and can be wrong.
- Extend location normalization beyond the current limited English/German alias set. Other languages, city/country relationships, and inconsistent feed formats still need coverage. Ambiguous remote listings are excluded for country-specific preferences unless a compatible region is stated or known from the feed query.
- Add a licensed, broad-coverage job search provider to find roles beyond the current public feeds and geographies; public feeds do not contain every employer or vacancy.
- Add more job-source adapters after checking each provider's API and display/attribution terms.
- Add pagination for Remotive and Jobicy if their public APIs support it; initial search retrieves one Remotive response and up to 100 Jobicy listings. Arbeitnow's next pages can now be requested with **Load more jobs**.
- Add OCR for scanned/image-only CVs; current parsing requires selectable text.
- Improve parsing of multi-column CVs and varied section layouts. Text extraction can reorder or omit content; review the role and skill fields produced by the CV analysis.
- Encrypt local profile and tracker data, which can include sensitive details accepted from a CV.
- Tailor and export the candidate's CV using verified CV source material; current analysis extracts profile evidence but does not generate tailored CV files.
- Add application-form preparation and employer-specific ATS integrations. Jobpilot currently opens the original posting but does not fill or submit external forms.
- Improve AI drafting with editable user preferences, structured outputs, and stronger source-to-claim verification; AI drafting currently creates cover-letter text only.
- Formally review accessibility and the existing responsive layout across supported browsers and screen sizes; responsive breakpoints exist, but this review has not been completed.
- Add automated end-to-end tests for the main job search, details, profile, and tracking workflows.

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

**Privacy:** CV parsing runs in the browser. The selected CV file is never sent to Ollama or saved. Extracted CV text is sent from the browser to the local Jobpilot app and then to Ollama at a loopback address on the same laptop for profile analysis after upload and for job matching when you search; it remains in memory and is not written to the local state file. Extracted role and skill fields are automatically saved to the local JSON state file, which is not encrypted. AI match explanations and scores are saved with local job listings, but the CV itself is not. Cover-letter notes and drafts are also stored locally and in unencrypted JSON backups. Jobpilot sends no candidate data to job-feed providers. For AI cover-letter drafting, job details, profile name and skills, and entered interest/evidence notes are sent to local Ollama; full CV text is not included in a cover-letter request. Keep Jobpilot bound to localhost.

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

Open <http://localhost:3000> and choose the installed model in the **Local AI status** panel. Open **Candidate profile → Analyze CV** and select a text-based CV. Jobpilot shows a summary and evidence, then fills and saves target roles and skills automatically; review or edit those fields. The extracted CV text stays in memory. Return to the overview and select **Search jobs now**. Jobpilot sends the extracted text only to local Ollama and compares it with up to 60 location-eligible listings. Re-upload your CV after restarting Jobpilot. If the model returns incomplete results, try a smaller installed model; exact profile matches remain visible as a fallback. To draft a cover letter, select a job, open **Create draft**, enter a specific interest and a true experience example, and select **Generate on this laptop**. Review every result; the model's fit assessment can be wrong.

### If Jobpilot cannot see the model

1. Make sure the Ollama app is open and still running.
2. In Terminal, run `ollama ls` and confirm the model appears. If it does not, repeat the `ollama pull <model-name>` command using the model name from the [Ollama library](https://ollama.com/library).
3. Reload Jobpilot so it checks Ollama again. The model picker lists only models Ollama has installed.
4. If you changed Ollama's default local address or port, copy `.env.example` to `.env.local`, set `OLLAMA_BASE_URL` to Ollama's **local loopback** address, and restart Jobpilot. Jobpilot rejects remote addresses to keep candidate text on your laptop.

No AI API key or hosted AI account is needed. Jobpilot sends extracted CV text to Ollama on this laptop for profile analysis and job matching. It does not send the CV file itself. For cover-letter drafting it sends job details, profile name and skills, and the notes you enter, but not the CV text. Job discovery still needs an internet connection. Model speed and output quality depend on your model and laptop hardware.

## Search jobs

Select **Search jobs now** in the overview. Jobpilot retrieves listings from public feeds and filters them against preferred locations. Common English/German aliases for Vienna, Graz, Linz, Salzburg, Innsbruck, Klagenfurt, Bregenz, St. Pölten, Munich, Cologne, Zurich, Geneva, and Prague are normalized; city-only listings for these places can match their country. This alias coverage is intentionally limited and does not replace review of the employer posting. If you imported a CV and selected an installed Ollama model, Jobpilot compares up to the first 30,000 CV text characters with up to 60 location-eligible postings locally, in batches of four, and shows the model's relevance decision, estimated fit, and supporting CV evidence. If the model is unavailable, Jobpilot falls back to exact target-role and skill phrase matching. AI scores are estimates, not hiring probabilities; review each posting yourself.

Enter preferred locations explicitly in **Candidate profile**. Separate alternatives with semicolons, for example `Austria; Remote Europe`. Leave the field blank only if you want jobs from any location. CV addresses are not imported or used as preferences. A generic `Remote` label does not identify eligible countries; select `Remote` explicitly if you want all such postings.

Use the keyword box to search role, company, location, and department text. The posting-age filter offers any date, the last 7 days, or the last 30 days; listings without a publication date are omitted when a date range is selected. Work-mode filtering uses the feed's mode and location text, so an employer's listing is the source of truth. Department choices come from the current results and appear only when a feed provides department information. **Show more jobs** displays 25 more entries from the current batch. **Load more jobs from Arbeitnow** fetches up to five subsequent provider pages; new listings are deduplicated and are compared with the CV locally when Ollama is ready.

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
