# Jobpilot

Jobpilot is a job-search helper that runs on your computer. It finds public job listings, compares them with your CV using Ollama (a local AI app), and helps you prepare application drafts. You review every result and submit applications yourself.

## Get started (no coding experience needed)

Follow these steps in order. You only need to do the setup once.

### 1. Install Node.js

Download and install **Node.js 22.13 or newer** from [nodejs.org](https://nodejs.org/). Choose the regular installer for your computer and accept the suggested options. If the installer asks, allow it to install npm too. Restart your computer if the installer asks you to.

### 2. Download Jobpilot

1. Open the [Jobpilot GitHub page](https://github.com/sinariazi/jobpilot).
2. Click the green **Code** button, then **Download ZIP**.
3. Open your Downloads folder and extract/unzip the downloaded file. You should now have a folder named `jobpilot-main`.

### 3. Install Ollama for local AI

1. Download Ollama from [ollama.com/download](https://ollama.com/download) and install it.
2. Open the Ollama app and leave it running while you use Jobpilot.
3. Install a local chat model from the [Ollama model library](https://ollama.com/library). For example, open the model's page, follow its **CLI** instructions, and run the shown `ollama pull ...` command in a terminal. Models take disk space and may take several minutes to download.
4. For automatic CV-to-job scoring, update Ollama to 0.35 or newer and install a decision model that supports `/v1/systemone`, such as `nimble`, `tev1`, or `tev1:0.8b` (run `ollama pull nimble` in Terminal). A normal chat model does not work for this step. If you skip this, you can still browse jobs, but automatic decision-model scores will not be available.

### 4. Open a terminal in the Jobpilot folder

The terminal is an app where you paste the commands below.

- **Windows:** Open the extracted `jobpilot-main` folder in File Explorer. Click the address bar, type `powershell`, then press **Enter**.
- **Mac:** Open **Applications → Utilities → Terminal**, type `cd ~/Downloads/jobpilot-main`, then press **Enter**. If you extracted the folder somewhere else, use that folder's location instead.
- **Linux:** Open Terminal and go to the extracted folder. For the default Downloads location, type `cd ~/Downloads/jobpilot-main` and press **Enter**.

### 5. Install and start Jobpilot

In that terminal window, run these commands one at a time. Press **Enter** after each command and wait for it to finish:

```bash
npm install
npm run dev
```

Keep this terminal window open. When it says the server is ready, open [http://localhost:3000](http://localhost:3000) in your web browser. Jobpilot is now running on your computer.

### 6. Set up your profile and find jobs

1. In Jobpilot, click **Candidate profile**.
2. Under **Analyze CV**, choose your CV file (PDF, DOCX, or TXT). For a scanned PDF, see [Scanned CVs](#scanned-cvs-optional).
3. Review the CV summary, suggested job titles, and skills. Edit anything that is incorrect. Enter your preferred locations (for example, `Austria`) and click **Save profile**.
4. In **Local AI status**, choose the Ollama chat model you installed. If available, choose a compatible decision model too. Jobpilot discovers models installed on your computer.
5. On the main page, review or edit the CV-suggested **Job titles** and set **Preferred locations**. Click **Search jobs** to fetch listings for those locations and screen them with the configured local models. Target titles guide ranking and screening; all location-eligible listings remain visible so a different job-title wording does not hide a relevant role. Select a result to read its details, evidence, and original job posting.

### Optional: fill basic employer form fields locally

The Chromium extension works with **Chrome and Edge** on Greenhouse, Lever, Ashby, Workday, SmartRecruiters, and Workable application pages. It reads your saved contact details from Jobpilot on `localhost`. When you click **Fill empty fields**, those values are inserted into the employer's page, where that employer can read them as usual. No data goes to a Jobpilot-hosted service.

1. Keep Jobpilot running at [http://localhost:3000](http://localhost:3000), then open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Turn on **Developer mode** and select **Load unpacked**.
3. Select the `extension/chromium` folder inside the Jobpilot folder you downloaded.
4. Open an application form on a supported ATS, click the Jobpilot extension icon, then click **Fill empty fields**.
5. Review every filled value and complete the employer's questions yourself. Jobpilot never uploads a CV, fills screening questions, or submits the form.

The extension fills only recognized, empty name and contact fields and a saved cover-letter field when the current posting matches a saved Jobpilot job. It does not overwrite existing values or interact with file uploads, checkboxes, passwords, or submit buttons. Reload an application page if you installed the extension while that page was already open. Remove it from the browser extensions page when you no longer need it.

To use Jobpilot another day, open Ollama, open a terminal in the `jobpilot-main` folder, run `npm run dev`, and visit [http://localhost:3000](http://localhost:3000). To stop Jobpilot, focus the terminal window and press **Ctrl+C**. Your profile and saved job tracker remain on this computer.

## If something goes wrong

- **`npm` is not recognized / command not found:** Install Node.js from [nodejs.org](https://nodejs.org/), close and reopen the terminal, then try again.
- **The page does not open:** Make sure the terminal is still running `npm run dev`, then refresh `http://localhost:3000`.
- **No Ollama models appear:** Open the Ollama app, install a model, and refresh Jobpilot. To check installed models, run `ollama ls` in a terminal.
- **Decision screening returns an error:** Update Ollama to 0.35 or newer and install/select a decision model compatible with `/v1/systemone`, such as `nimble` or `tev1`. Ordinary chat models may appear in Ollama but cannot answer this API. If it still fails, check the local AI status and restart Ollama. Jobpilot does not send your CV or job text to a hosted AI service instead.
- **Model takes a long time or fails:** Try a smaller model that fits your computer's memory. Jobpilot can still show fetched jobs without AI scores.
- **Need help with the command window?** Leave the message visible and share the exact error text when asking for help. Do not share your CV or personal profile data.

## What Jobpilot does

- Searches public job feeds automatically; you do not need to enter company names or board slugs. Public feeds do not include every vacancy.
- Loads further pages from Arbeitnow and Jobicy when their APIs return a next-page link or cursor. Remotive's [public API](https://github.com/remotive-io/remote-jobs-api) returns its active result set in one response and currently documents no page or cursor parameter, so Jobpilot fetches that feed once per cache period rather than inventing pagination.
- Filters by locations in your profile. Leave preferred locations blank only if you want jobs from any location. A generic “Remote” listing is not assumed to be available in Austria unless the listing/feed indicates it.
- Uses local Ollama `/v1/systemone` decision screening for a fast first estimate, then a local chat model for shortlisted, uncertain, or incomplete cases. You can adjust score weights and detailed-analysis thresholds in the app. Scores are estimates, not hiring probabilities. All location-eligible jobs remain visible, including low-scoring jobs; load additional provider pages when available.
- The default score weights are skills 40%, experience 30%, domain fit 20%, and penalty for explicit disqualifiers 10%. Detailed analysis runs by default at scores of 65 or higher, confidence below 60, or whenever important information is missing/unclear. Change these settings in Jobpilot; the score is not a probability of being hired.
- Shows score breakdowns, confidence when the model provides it, missing information, and detailed matched requirements/gaps with source evidence when available. Verify every result against the original listing.
- Lets you save jobs, track application status, add private notes and follow-up dates, and create editable cover-letter drafts. A local Chrome/Edge extension can fill recognized empty contact fields and a matching saved cover-letter draft on Greenhouse, Lever, Ashby, Workday, SmartRecruiters, and Workable forms. Add contact details in **Candidate profile**. You review all fields and submit applications yourself; the extension does not upload CVs or answer employer screening questions.
- Stores profile and job-tracker data on this device in `~/.jobpilot/state.json` (or the folder set by `JOBPILOT_DATA_DIR`). The file is not encrypted. Use **Candidate profile → Data backup** to save or restore a local backup.

## CV privacy and local AI

The CV file is read in your browser and is not saved by Jobpilot. Extracted CV text is held in memory and sent to Ollama on this same computer for CV analysis and job matching. Job descriptions used for matching are also sent only to local Ollama. Jobpilot has no hosted AI fallback. Public feeds do not receive candidate profile data. Extracted role and skill suggestions, AI scores/explanations, review labels, profile fields, and tracker data are stored locally; the stored data is not encrypted. Cover-letter generation sends the job details, profile name and skills, and notes you enter to local Ollama, but not the full CV text. Keep Jobpilot bound to `localhost`; do not expose it to your network.

Job discovery needs an internet connection. AI matching needs Ollama and installed models. The model's speed and quality depend on the model and your computer. User-reviewed match feedback is a selected sample and does not establish general accuracy or calibration.

### Scanned CVs (optional)

Text-based PDF, DOCX, and TXT CVs work without extra OCR software. Scanned PDFs need Tesseract OCR installed on the computer. On macOS with Homebrew, open Terminal and run:

```bash
brew install tesseract tesseract-lang
```

Restart Jobpilot and choose English, German, or both in the CV upload section. The browser renders pages and sends them only to Jobpilot on localhost; Tesseract processes temporary local image files, which are deleted after OCR. Up to 20 scanned pages are supported. If Tesseract is not installed, text-based CV extraction continues to work.

## Current limitations (TODO)

- Broaden location/country normalization and cover more languages and inconsistent feed formats.
- Encrypt local profile, tracker, and backup data.
- Tailor and export a CV from verified source material; currently Jobpilot analyzes CVs but does not generate tailored CV files.
- Improve cover-letter drafting preferences, structured output, and source-to-claim checks.
- Review accessibility and responsive layouts across supported browsers and screen sizes.
- Add end-to-end tests for job search, job details, profile, tracking, and extension prefill on live ATS pages. Automated extension tests currently cover supported hosts, field mapping, and local access controls only.
- Evaluate local decision scores against a real human-reviewed set of strong, borderline, and poor matches. No such reviewed dataset is currently available, so false-positive/false-negative rates and model calibration have not been established.

## For developers

Requirements: Node.js 22.13 or newer and npm.

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

GitHub Actions runs these checks on pushes and pull requests. Public feed endpoints and test fixtures are integration/test data; the repository contains no real CV or personal candidate profile. Do not commit CVs, personal job-search data, credentials, or `.env` files.

## Solution architecture showcase

Jobpilot is designed as a single-user, local-first application. The browser handles CV file reading and text extraction; a local Next.js server coordinates job feeds, profile analysis, matching, and persistence. Ollama performs inference on the same computer. The optional Chromium extension reads only application fields from Jobpilot's local endpoint after the user clicks its fill button. Public providers supply job listings and do not receive candidate profile or CV data.

### System context and trust boundaries

```mermaid
flowchart TB
    person["Candidate"] --> browser["Browser UI: CV extraction and review"]
    browser --> app["Local Jobpilot server: Next.js UI and API"]
    browser --> extension["Optional local Chromium extension"]
    extension -->|"User-clicked contact fields over loopback"| app
    extension -->|"Fill recognized empty fields only"| ats["Supported employer ATS page"]
    app -->|"Public listing requests"| feeds["Job feeds: Arbeitnow, Remotive, Jobicy"]
    feeds -->|"Listings"| app
    app -->|"Loopback only: CV text and job descriptions"| ollama["Ollama: decision and chat models on this computer"]
    ollama -->|"Scores and analysis"| app
    app -->|"Profile, jobs, scores, drafts"| state["Local JSON state file"]
    app --> browser
```

The CV file is not stored. Extracted text stays in memory for analysis and matching; only accepted profile fields and job results are persisted. Scanned-page OCR uses local Tesseract through the localhost app. The local state file and backups are currently unencrypted, as listed in TODO.

### Job-search and two-stage matching flow

```mermaid
flowchart TB
    start["Upload CV and set location preferences"] --> extract["Extract text in browser; optional local OCR"]
    extract --> cv["Analyze CV with Ollama; review suggestions"]
    cv --> search["Fetch and normalize public listings"]
    search --> filter["Apply location filters; retain eligible listings"]
    filter --> screen["Decision model scores skills, experience, domain, risk, and missing information"]
    screen --> route{"Score threshold, low confidence, or unclear information?"}
    route -->|"Yes"| detailed["Local chat model checks requirements, gaps, and evidence"]
    route -->|"No"| estimate["Keep first-stage estimate"]
    detailed --> results["Show score, confidence, breakdown, analysis, and original posting"]
    estimate --> results
    results --> human["Candidate reviews and decides whether to apply"]
```

Default screening weights are 40% skills, 30% experience, 20% domain fit, and 10% inverse explicit-disqualifier risk. The default detailed-analysis route is a score of 65 or higher, confidence below 60, or missing/unclear information. Users can change these values in the app. Scores are estimates, not hiring probabilities; the local model's accuracy has not been established on a human-reviewed benchmark.

### Runtime interaction

```mermaid
sequenceDiagram
    participant UI as Browser UI
    participant App as Local Jobpilot API
    participant Feed as Public job feeds
    participant AI as Ollama on localhost
    participant Disk as Local JSON state

    Note over UI: Candidate uploads CV and reviews profile
    UI->>App: Send extracted text for analysis
    App->>AI: Analyze CV on this computer
    AI-->>App: Summary, roles, skills, evidence
    App->>Disk: Save accepted profile fields
    Note over UI: Candidate starts a job search
    UI->>App: Search with location preferences
    App->>Feed: Request public listings
    Feed-->>App: Return job listings
    App->>AI: Score each eligible job via /v1/systemone
    AI-->>App: Normalized category scores and confidence
    opt Shortlisted, uncertain, or incomplete result
        App->>AI: Detailed comparison using local chat model
        AI-->>App: Matches, gaps, and evidence
    end
    App->>Disk: Save listings and assessments, not raw CV text
    App-->>UI: Return all eligible jobs and their analysis
    UI-->>User: Display results for human review
```

### Key architecture decisions

| Decision | Why it fits this application | Trade-off or current boundary |
|---|---|---|
| Keep orchestration in the local Next.js application | One installable TypeScript project serves the UI and local APIs without a separate hosted backend. | The app is a single-user local tool, not a multi-user service. |
| Use adapters to map provider listings into a shared job type | Feed-specific fields are normalized before location filtering, display, and matching. | Coverage and pagination depend on each provider's public API and terms. |
| Split matching into a fast decision stage and a detailed stage | A lightweight estimate can screen many listings; slower evidence-focused analysis is reserved for selected or uncertain cases. | Both stages depend on local model compatibility, hardware, and model quality. |
| Keep CV and contact data away from job-feed providers and hosted AI | CV text goes only to Ollama on loopback; the extension fetches selected contact fields locally after a user click. | The ATS receives values filled into its page; job discovery needs internet, and local JSON data is not encrypted. |
| Preserve human review and show estimates separately | Scores, confidence, and detailed analysis remain distinguishable; original postings stay available. | The agent does not submit applications, and score calibration awaits reviewed examples. |

This design demonstrates local data-boundary design, integration of heterogeneous APIs, explicit decision routing, failure-aware AI orchestration, and human-in-the-loop workflow design. Remaining boundaries—encryption, broader feed coverage, ATS-specific questions and uploads, and measured score accuracy—are documented in [Current limitations](#current-limitations-todo).
