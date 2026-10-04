# Jobpilot

A local-first job-search assistant built with Next.js and TypeScript. It searches multiple public job feeds automatically, filters listings against the candidate's preferred locations and profile evidence, and explains which target roles and skills matched.

> **Current scope:** Jobpilot is an early-stage, local-first job-search and application-preparation agent. It searches public feeds from configured providers, but does not cover every employer or vacancy. With a CV loaded and Ollama running locally, a configurable decision model quickly screens location-eligible jobs; only shortlisted or uncertain results go to detailed local LLM analysis. CV parsing runs in the browser; extracted text and job descriptions used for matching are sent only to Ollama on this laptop. Jobpilot does not yet tailor CVs or submit applications.

## Working now

- Searches three broad public job feeds automatically; no company names, board slugs, or employer setup are required. Each listing links to its provider or original listing, with visible source attribution.
- Filters listings using locations in the editable candidate profile. Common English/German aliases for Vienna, Graz, Linz, Salzburg, Innsbruck, Klagenfurt, Bregenz, St. Pölten, Munich, Cologne, Zurich, Geneva, and Prague are normalized; some city-only listings can match their country. An empty location means any location; an unqualified “Remote” listing is not assumed to be available in a specific country.
- Filters loaded listings by keywords, posting age, work mode, department, and minimum estimated score; sorts by best match, newest, or company name. Without a successful CV assessment, “best match” prioritizes target-role matches and exact skill evidence. The fallback percentage measures skill overlap only, not overall fit. Results appear in batches of 25; **Show more** reveals fetched jobs, while **Load more jobs** requests more provider listings.
- Imports text-based and scanned PDF, DOCX, and TXT CVs. Scanned PDF pages are rendered in the browser and OCR'd by local Tesseract, with English, German, or both selectable; no page image is sent to a hosted OCR service. PDF text extraction preserves visual line breaks, detects repeated column gutters (including columns with independent vertical baselines) and full-width headings, and recognizes common English and German section names, including inline skill headings. Dated role entries handle common title/date layouts. When local Ollama is available, it analyzes the CV, shows an in-app preview for PDFs, extracted text, summary, and evidence, and automatically fills and saves target roles and skills in the local profile. Name and preferred location are not inferred. Review the extracted role and skill suggestions against the original CV. The selected file and full text remain in memory and are not saved.
- When a CV and local Ollama are available, the app sends every fetched location-eligible job and a compact CV excerpt to the configurable decision model through Ollama `/v1/systemone`. The first stage scores skills, experience, and domain fit; checks explicit material-disqualifier risk; reports missing information and model confidence; and combines outputs using editable whole-percentage weights that total 100 (default: 40/30/20/10). Detailed analysis runs only above the configurable score threshold (default 65), below its confidence threshold (default 60), or when CV/job information is missing or unclear. Every location-eligible listing remains visible, including low-scoring listings. The detail view keeps the local screening score/confidence separate from second-stage analysis and shows matched requirements, gaps, and exact CV/job evidence quotes when the model provides valid source spans. Scores are estimates, not probabilities of hiring. The second-stage Ollama chat model is independently configurable. CV and job text are sent only to a loopback Ollama service; there is no cloud AI fallback. Users can label screened jobs as relevant or not relevant; observed false positives/negatives and other review metrics are scoped to that model and CV fingerprint. Because users choose which jobs to review, this feedback is a selected sample and does not establish general accuracy or calibration.
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

- Extend location normalization beyond the current limited English/German alias set. Other languages, city/country relationships, and inconsistent feed formats still need coverage. Ambiguous remote listings are excluded for country-specific preferences unless a compatible region is stated or known from the feed query.
- Add a licensed, broad-coverage job search provider to find roles beyond the current public feeds and geographies; public feeds do not contain every employer or vacancy.
- Add more job-source adapters after checking each provider's API and display/attribution terms.
- Add pagination for Remotive and Jobicy if their public APIs support it; initial search retrieves one Remotive response and up to 100 Jobicy listings. Arbeitnow's next pages can now be requested with **Load more jobs**.
- Encrypt local profile and tracker data, which can include sensitive details accepted from a CV.
- Tailor and export the candidate's CV using verified CV source material; current analysis extracts profile evidence but does not generate tailored CV files.
- Add application-form preparation and employer-specific ATS integrations. Jobpilot currently opens the original posting but does not fill or submit external forms.
- Improve AI drafting with editable user preferences, structured outputs, and stronger source-to-claim verification; AI drafting currently creates cover-letter text only.
- Formally review accessibility and the existing responsive layout across supported browsers and screen sizes; responsive breakpoints exist, but this review has not been completed.
- Add automated end-to-end tests for the main job search, details, profile, and tracking workflows.
- Evaluate the local decision model on a real, human-reviewed set of strong, borderline, and poor job matches from the user's CV; the repository has no such reviewed dataset, so actual false-positive and false-negative rates have not yet been measured. Current tests verify score math, routing, and failure cases using synthetic response fixtures only.

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

### Optional: enable OCR for scanned CVs

OCR uses Tesseract installed on this laptop. On macOS, install English OCR support with:

```bash
brew install tesseract
```

To read German CVs, also install Tesseract's additional language data:

```bash
brew install tesseract-lang
```

Check that the selected language appears in `tesseract --list-langs`, then restart Jobpilot. The CV profile has an OCR language selector for English, German, or both. OCR works only when Jobpilot is open at `http://localhost:3000`. It handles up to 20 scanned pages in one CV. If `tesseract` is not on `PATH`, set `TESSERACT_PATH` in `.env.local` to its executable path and restart the app. The OCR engine and language files run locally; if Tesseract is absent, text-based PDF, DOCX, and TXT extraction still works.

**Privacy:** CV parsing runs in the browser. For scanned PDFs, page images are rendered in the browser and sent only to Jobpilot on localhost; the local Tesseract process reads a temporary image file that is deleted immediately after OCR. The selected CV file is never sent to Ollama or saved. Extracted CV text is sent from the browser to the local Jobpilot app and then to Ollama at a loopback address on the same laptop for profile analysis after upload and for job matching when you search; it remains in memory and is not written to the local state file. Extracted role and skill fields are automatically saved to the local JSON state file, which is not encrypted. AI match explanations, scores, and the user's match-review labels are stored locally. A SHA-256 fingerprint of extracted CV text is stored with those labels so calibration feedback is reused only for the same CV; the CV itself is not stored. Cover-letter notes and drafts are also stored locally and in unencrypted JSON backups. Jobpilot sends no candidate data to job-feed providers. For AI cover-letter drafting, job details, profile name and skills, and entered interest/evidence notes are sent to local Ollama; full CV text is not included in a cover-letter request. Keep Jobpilot bound to localhost.

## Local AI setup

### 1. Install and start Ollama

Download Ollama for your operating system from [ollama.com/download](https://ollama.com/download), install it, and open the Ollama app. Leave it running while you use Jobpilot. Ollama is the local program that loads and runs the AI model on your laptop.

### 2. Download a model

Open Terminal (on macOS, open **Applications → Utilities → Terminal**) and run this example:

```bash
ollama pull MODEL_NAME
```

Replace `MODEL_NAME` with a model tag from the [Ollama model library](https://ollama.com/library). For detailed analysis and drafting, choose a compatible chat model. For first-stage screening, install an Ollama decision model that supports `/v1/systemone`; do not assume that a standard chat model supports this endpoint. Model names and versions are not baked into Jobpilot: the app lists tags installed by the user and the selection is saved locally. Larger models can require more disk space and memory. After downloading, check that Ollama can see it:

```bash
ollama ls
```

The model name shown by `ollama list` is the name Jobpilot will show you.

### 3. Start Jobpilot and select the model

In the Jobpilot project folder, start the app if it is not already running:

```bash
npm run dev
```

Open <http://localhost:3000> and choose the installed chat model and the installed decision model in the **Local AI status** panel. The `/v1/systemone` API requires Ollama 0.35 or newer. Jobpilot checks the local Ollama version, lists installed tags, and reports an actionable error if this endpoint is unsupported or the selected model is missing/incompatible. Open **Candidate profile → Analyze CV** and select a text-based or scanned CV. Scanned PDFs require the optional local Tesseract installation described above; choose the OCR language. Jobpilot shows a summary and evidence, then fills and saves target roles and skills automatically; review or edit those fields. The extracted CV text stays in memory. Return to the overview and select **Search jobs now**. The decision model screens each currently fetched, location-eligible listing; the slower chat model analyzes only jobs over the score threshold, below the confidence threshold, or with missing/unclear information. Adjust thresholds and weights under **Screening weights and detailed-analysis thresholds**. Watch or cancel progress. If Ollama or a model fails, listings remain visible and Jobpilot does not send candidate data to a hosted model. Re-upload your CV after restarting Jobpilot. To draft a cover letter, select a job, open **Create draft**, enter a specific interest and a true experience example, and select **Generate on this laptop**. Review every estimate and citation; models can be wrong.

### If Jobpilot cannot see the model

1. Make sure the Ollama app is open and still running.
2. Run `ollama --version`; upgrade to Ollama 0.35 or newer to use local decision screening.
3. Run `ollama ls` and confirm both selected model tags are installed. A chat model may not support `/v1/systemone`; select a decision model that Ollama documents for this endpoint. Refresh local AI status after installing models.
4. If screening says the endpoint is unsupported, check the reported Ollama version and update Ollama. If it says the model is missing or unsupported, install/select another local decision model. A timeout may indicate model size or memory pressure; choose a smaller compatible model.
5. If you changed Ollama's default local address or port, copy `.env.example` to `.env.local`, set `OLLAMA_BASE_URL` to Ollama's **local loopback** address, and restart Jobpilot. `OLLAMA_MODEL` can set the preferred detailed chat model and `OLLAMA_DECISION_MODEL` the preferred decision model; both can be changed in the UI. Jobpilot rejects remote Ollama addresses to keep candidate text on your laptop.

No AI API key or hosted AI account is needed. Jobpilot sends extracted CV text to Ollama on this laptop for profile analysis and job matching. It does not send the CV file itself. For cover-letter drafting it sends job details, profile name and skills, and the notes you enter, but not the CV text. Job discovery still needs an internet connection. Model speed and output quality depend on your model and laptop hardware.

## Search jobs

Select **Search jobs now** in the overview. Jobpilot retrieves listings from public feeds and filters them against preferred locations. Common English/German aliases are normalized; location filtering remains based on the configured profile. The local decision model returns a 0–100 weighted screening estimate and confidence as separate values. Confidence is the mean of model-provided confidence values across the fit categories and information-status answer; when the model supplies none, confidence is shown as unavailable and the job is sent to detailed analysis. The score defaults to 40% skills, 30% experience, 20% domain, and 10% inverse explicit-disqualifier risk. Default routing sends scores of 65 or higher, confidence below 60, and any missing/unclear CV or job information to detailed analysis; these settings are editable. Detailed analysis shows matched requirements, gaps, and CV/job quotations only when the quoted spans occur in the submitted extracted CV/job text. Use score sorting and the minimum-score filter to navigate results. Low-score roles are never hidden by the matcher itself. Use progress controls to cancel. New pages are screened without repeating jobs already screened by the selected decision model and configuration. Mark results relevant/not relevant to inspect observed false positives and false negatives for that model, CV, and matching configuration. These are user-reviewed sample metrics; they are not a general accuracy claim or hiring probability. If Ollama or the decision endpoint is unavailable, Jobpilot shows an actionable error and leaves the listings available without AI scores; it does not fall back to hosted AI.

Enter preferred locations explicitly in **Candidate profile**. Separate alternatives with semicolons, for example `Austria; Remote Europe`. Leave the field blank only if you want jobs from any location. CV addresses are not imported or used as preferences. A generic `Remote` label does not identify eligible countries; select `Remote` explicitly if you want all such postings.

Use the keyword box to search role, company, location, and department text. The posting-age filter offers any date, the last 7 days, or the last 30 days; listings without a publication date are omitted when a date range is selected. Work-mode filtering uses the feed's mode and location text, so an employer's listing is the source of truth. Department choices come from the current results and appear only when a feed provides department information. **Show more jobs** displays 25 more entries from the current batch. **Load more jobs from Arbeitnow** fetches up to five subsequent provider pages; new listings are deduplicated and are compared with the CV locally when Ollama is ready.

The app preserves each provider's job URL and displays source attribution. Remotive listings are delayed by 24 hours; its public API asks consumers to request data no more than four times per day, so the app caches that feed for six hours. Jobicy requests are cached for at least one hour per its polling guidance.

## Back up or restore local data

Open **Candidate profile** and use the **Data backup** controls. **Download backup** saves a versioned JSON file containing the profile, fetched listings, saved jobs, application statuses, notes, cover-letter drafts, and local match-review calibration data. **Restore backup** accepts a Jobpilot backup, validates it, and asks for confirmation before replacing the current local state. Keep backup files private: they contain profile data and are not encrypted.

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
