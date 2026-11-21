# Auto-Applier 🚀

A modular, stealth-configured automation engine built with Node.js and Puppeteer to find, filter, and bulk-apply to tech roles across **Naukri**, **Wellfound (AngelList)**, **Indeed**, **Instahyre**, **Foundit**, **Internshala**, and **TimesJobs**.

---

## ⚡ Quick Command Cheat Sheet

| Platform | Apply Command | Login / Setup Command | Database Output |
| :--- | :--- | :--- | :--- |
| **Naukri** | `npm run apply:naukri` *(or `npm run apply`)* | `npm run login:naukri` | `data/applied_jobs.json` |
| **Wellfound** | `npm run apply:wellfound` | `npm run login:wellfound` | `data/applied_wellfound.json` |
| **Indeed** | `npm run apply:indeed` | `npm run login:indeed` | `data/applied_indeed.json` |
| **Instahyre** | `npm run apply:instahyre` | `npm run login:instahyre` | `data/applied_instahyre.json` |
| **Foundit** | `npm run apply:foundit` | `npm run login:foundit` | `data/applied_foundit.json` |
| **Internshala** | `npm run apply:internshala` | `npm run login:internshala` | `data/applied_internshala.json` |
| **TimesJobs** | `npm run apply:timesjobs` | `npm run login:timesjobs` | `data/applied_timesjobs.json` |

---

## 🚀 Getting Started

### 1. Installation
Clone the repository and install dependencies:

```bash
git clone https://github.com/MayureshTardekar/Auto-Applier.git
cd Auto-Applier
npm install
```

### 2. Configure Environment
Copy `.env.example` to create your local `.env`:

```bash
cp .env.example .env
```

Set your browser path and application preferences:
```env
HEADLESS=false
BROWSER_EXECUTABLE_PATH=C:\Users\YOUR_USERNAME\AppData\Local\BraveSoftware\Brave-Browser\Application\brave.exe
MAX_APPLIES_PER_RUN=30
MAX_APPLIES_PER_DAY=30
EXPECTED_CTC_LAKHS=9.5
```

### 3. Add Your Resume
Place your resume as `Resume.pdf` in the project root directory.

---

## 🎯 Platform Setup & Usage

### 1. Naukri

#### Step A: Export Cookies (One-Time)
1. Open your logged-in **Naukri** tab in Brave/Chrome.
2. In the **Cookie-Editor** extension, click **Export** $\rightarrow$ **Export as JSON**.
3. Create/paste into `cookies.json` in the project root.
*(Alternatively, run `npm run login:naukri` to sign in through the automated window).*

#### Step B: Run Applications
```bash
npm run apply:naukri
```
- Searches broad entry-level roles (Software Engineer, Java, Spring Boot, Python, Data Analyst, GenAI).
- Skips external redirect jobs and filters out non-relevant listings.
- Auto-fills recruiter chatbot questionnaires (0 experience, immediate notice, expected CTC).
- Applies with humanized pacing delays (12–25 seconds) to keep your account safe.

---

### 2. Wellfound (AngelList)

#### Step A: Export Cookies (One-Time)
1. Open your logged-in **Wellfound** tab (`https://wellfound.com/jobs`).
2. In **Cookie-Editor**, click **Export** $\rightarrow$ **Export as JSON**.
3. Create/paste into `cookies_wellfound.json` in the project root.
*(Alternatively, run `npm run login:wellfound`).*

#### Step B: Run Applications
```bash
npm run apply:wellfound
```
- Scrapes active startup job listings for AI, Backend, Java, Python, and Data roles from your feed and saved searches.
- Automatically handles the application modal.
- Injects a personalized founder/recruiter pitch note highlighting your SPIT MCA degree, RAG/pgvector projects, and immediate availability.
- Submits applications and records them in `data/applied_wellfound.json`.

---

### 3. Indeed

#### Step A: Export Cookies (One-Time)
1. Open your logged-in **Indeed** tab (`https://in.indeed.com`).
2. In **Cookie-Editor**, click **Export** $\rightarrow$ **Export as JSON**.
3. Create/paste into `cookies_indeed.json` in the project root.
*(Alternatively, run `npm run login:indeed` and sign in with Email + OTP; Google sign-in is usually blocked in automated browsers).*

#### Step B: Run Applications
```bash
npm run apply:indeed
```
- Searches only **Easily Apply** jobs (posted in the last 3 days) using your shared queries and locations.
- Walks through Indeed's multi-step apply form and answers known screening questions (experience, notice, CTC, relocation).
- If a required question can't be answered safely, it **skips the job instead of submitting wrong answers** (reason logged in `data/skipped_indeed.json`).
- If Indeed shows a security check, solve it in the browser window; the bot waits up to 60s.
- Optional: set `INDEED_BASE_URL` in `.env` (default `https://in.indeed.com`).

---

### 4. Instahyre

#### Step A: Export Cookies (One-Time)
1. Open your logged-in **Instahyre** tab.
2. In **Cookie-Editor**, click **Export** $\rightarrow$ **Export as JSON**.
3. Create/paste into `cookies_instahyre.json` in the project root.
*(Alternatively, run `npm run login:instahyre`).*

#### Step B: Run Applications
```bash
npm run apply:instahyre
```
- Scrapes your curated opportunity feed on Instahyre.
- Filters opportunities matching your whitelist keywords.
- Injects a personalized recruiter pitch note and submits your interest.

---

### 5. Foundit (formerly Monster India)

#### Step A: Export Cookies (One-Time)
1. Open your logged-in **Foundit** tab.
2. In **Cookie-Editor**, click **Export** → **Export as JSON**.
3. Create/paste into `cookies_foundit.json` in the project root.
*(Alternatively, run `npm run login:foundit`).*

#### Step B: Run Applications
```bash
npm run apply:foundit
```
- Rotates through your search keywords, filters title/company/experience/freshness/location, and applies.
- If the apply flow redirects to the employer site, the job is queued in `data/manual_apply_foundit.txt`.
- ⚠️ Foundit uses Akamai bot protection. If you see **"Access Denied"**, the session cannot proceed — try a different network or apply manually.

---

### 6. Internshala

#### Step A: Export Cookies (One-Time)
1. Open your logged-in **Internshala** tab (`https://internshala.com/`).
2. In **Cookie-Editor**, click **Export** → **Export as JSON**.
3. Create/paste into `cookies_internshala.json` in the project root.
*(Alternatively, run `npm run login:internshala`).*

#### Step B: Run Applications
```bash
npm run apply:internshala
```
- Searches both **internships** and **fresher jobs** for every keyword.
- Filters by title/company/location/freshness.
- Fills the cover letter, answers simple Yes/No questions, and submits the easy-apply form.
- Keep your Internshala resume and profile complete before running.

---

### 7. TimesJobs

#### Step A: Export Cookies (One-Time)
1. Open your logged-in **TimesJobs** tab (`https://www.timesjobs.com/`).
2. In **Cookie-Editor**, click **Export** → **Export as JSON**.
3. Create/paste into `cookies_timesjobs.json` in the project root.
*(Alternatively, run `npm run login:timesjobs`).*

#### Step B: Run Applications
```bash
npm run apply:timesjobs
```
- Uses TimesJobs' quoted keyword search and paginates through results.
- TimesJobs often redirects applications to the **company website**, so those jobs are captured with the employer's apply URL in `data/manual_apply_timesjobs.txt`.
- Native apply forms are filled and submitted automatically when available.

---

## 📋 Tracking & Manual Queue

```bash
npm run report                                    # exports every platform to data/applications.csv
npm run manual:list                               # prints the Naukri manual-apply queue
npm run manual:list -- --platform=timesjobs       # any platform: foundit, internshala, ...
npm run reset:skipped -- --platform=foundit       # retry retry-able skipped jobs
npm run reset:skipped -- --platform=foundit --all # retry every skipped job
```
Manual-apply queue files follow `data/manual_apply_<platform>.txt` (Naukri uses `data/manual_apply.txt`). Keyword rotation progress is stored per platform in `data/rotation_<platform>.json`.

---

## 🛠️ Customization Guide

### Targeted Roles & Keywords
Modify `config/searchCriteria.js` to add or remove search keywords and whitelists:
```javascript
queries: [
  'software engineer',
  'java developer',
  'spring boot developer',
  'backend developer',
  'python developer',
  'data analyst',
  'ai engineer',
  'graduate engineer trainee',
  ...
]
```

### Profile & Experience Answers
Modify `config/profile.js` to adjust default answers for recruiter questionnaires (CTC, Notice Period, Locations, Skills).

### Safety Caps & Delays
Modify `.env` to customize your application speed:
- `MAX_APPLIES_PER_RUN`: Applications per run (default: `15`)
- `MAX_APPLIES_PER_DAY`: Daily safety cap per platform (default: `30`)
- `MAX_APPLIES_PER_QUERY`: Cap per search keyword so one query cannot use the whole run (default: `5`)
- `MAX_CANDIDATES_PER_RUN`: Max qualified jobs scraped per run (default: `120`)
- `MAX_SKIPS_PER_RUN`: Stop after this many skipped jobs (default: `60`)
- `MAX_RUN_MINUTES`: Hard time budget per run (default: `120`)
- `INTER_APPLY_DELAY_MIN_MS`: Minimum delay between jobs (default: `15000`)
- `INTER_APPLY_DELAY_MAX_MS`: Maximum delay between jobs (default: `30000`)

For a fresher mass-apply push, raise the run/day caps gradually and keep the delays at **15–30s** or higher; aggressive settings increase the chance of account flags.

---

## 📁 Project Architecture

```
Auto-Applier/
├── config/
│   ├── guardrails.js             # Timing, limits, timeouts, and safety caps
│   ├── profile.js                # Profile answers (notice, CTC, experience, skills)
│   └── searchCriteria.js         # Queries, locations, title whitelist & blacklist
├── data/                         # Persistent deduplication storage
│   ├── applied_jobs.json         # Naukri application history
│   ├── applied_wellfound.json    # Wellfound application history
│   ├── applied_indeed.json       # Indeed application history
│   ├── applied_instahyre.json    # Instahyre application history
│   ├── applied_foundit.json      # Foundit application history
│   ├── applied_internshala.json  # Internshala application history
│   └── applied_timesjobs.json    # TimesJobs application history
├── platforms/
│   ├── foundit/
│   │   └── founditService.js     # Foundit scraper & apply handler
│   ├── indeed/
│   │   └── indeedService.js      # Indeed Easily Apply search & multi-step form handler
│   ├── instahyre/
│   │   └── instahyreService.js   # Instahyre scraper & recruiter pitch handler
│   ├── internshala/
│   │   └── internshalaService.js # Internshala internship/job scraper & easy-apply handler
│   ├── shared/
│   │   └── runPlatform.js        # Shared caps, pacing, session-check runner
│   ├── timesjobs/
│   │   └── timesjobsService.js   # TimesJobs paginated search & apply handler
│   └── wellfound/
│       └── wellfoundService.js   # Wellfound job scraper & modal application handler
├── scripts/
│   ├── bulkApply.js              # Naukri runner
│   ├── bulkApplyFoundit.js       # Foundit runner
│   ├── bulkApplyIndeed.js        # Indeed runner
│   ├── bulkApplyInstahyre.js     # Instahyre runner
│   ├── bulkApplyInternshala.js   # Internshala runner
│   ├── bulkApplyTimesJobs.js     # TimesJobs runner
│   ├── bulkApplyWellfound.js     # Wellfound runner
│   ├── lib/interactiveLogin.js   # Shared interactive login helper
│   ├── listManualQueue.js        # Print jobs queued for manual apply
│   ├── login.js                  # Naukri interactive login
│   ├── loginFoundit.js           # Foundit interactive login
│   ├── loginIndeed.js            # Indeed interactive login
│   ├── loginInstahyre.js         # Instahyre interactive login
│   ├── loginInternshala.js       # Internshala interactive login
│   ├── loginTimesJobs.js         # TimesJobs interactive login
│   ├── loginWellfound.js         # Wellfound interactive login
│   ├── report.js                 # Export all applications to CSV
│   └── resetSkipped.js           # Retry skipped jobs
├── services/
│   ├── applyService.js           # Naukri apply lifecycle & modal handler
│   ├── browserService.js         # Puppeteer Stealth engine & cookie manager
│   ├── questionnaireHandler.js   # Naukri chatbot & questions solver
│   ├── searchService.js          # Naukri query generation & card filter
│   └── storageService.js         # Multi-platform partitioned deduplication
├── utils/
│   ├── delay.js                  # Jitter delays & human emulation
│   ├── jobFilters.js             # Shared title/company/experience/freshness filters
│   ├── logger.js                 # Leveled colored console output
│   └── rotation.js               # Per-platform keyword rotation state
├── package.json                  # NPM multi-platform scripts
└── index.js                      # Universal CLI dispatcher
```

---

## 🔒 Security & Privacy

- All sensitive files (`cookies*.json`, `.env`, `data/`, and `Resume.pdf`) are strictly included in `.gitignore`.
- No credentials or session tokens are stored in the codebase or version control.
