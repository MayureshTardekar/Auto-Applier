# Auto-Applier 🚀

A modular, stealth-configured automation engine built with Node.js and Puppeteer to find, filter, and bulk-apply to tech roles across **Naukri**, **Wellfound (AngelList)**, **Indeed**, and **Instahyre**.

---

## ⚡ Quick Command Cheat Sheet

| Platform | Apply Command | Login / Setup Command | Database Output |
| :--- | :--- | :--- | :--- |
| **Naukri** | `npm run apply:naukri` *(or `npm run apply`)* | `npm run login:naukri` | `data/applied_jobs.json` |
| **Wellfound** | `npm run apply:wellfound` | `npm run login:wellfound` | `data/applied_wellfound.json` |
| **Indeed** | `npm run apply:indeed` | `npm run login:indeed` | `data/applied_indeed.json` |
| **Instahyre** | `npm run apply:instahyre` | `npm run login:instahyre` | `data/applied_instahyre.json` |

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
MAX_APPLIES_PER_RUN=100
MAX_APPLIES_PER_DAY=100
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
- `MAX_APPLIES_PER_RUN`: Applications per run (default: `100`)
- `MAX_APPLIES_PER_DAY`: Daily safety cap per platform (default: `100`)
- `INTER_APPLY_DELAY_MIN_MS`: Minimum delay between jobs (default: `12000`)
- `INTER_APPLY_DELAY_MAX_MS`: Maximum delay between jobs (default: `25000`)

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
│   └── applied_instahyre.json    # Instahyre application history
├── platforms/
│   ├── instahyre/
│   │   └── instahyreService.js   # Instahyre scraper & recruiter pitch handler
│   ├── indeed/
│   │   └── indeedService.js      # Indeed Easily Apply search & multi-step form handler
│   └── wellfound/
│       └── wellfoundService.js   # Wellfound job scraper & modal application handler
├── scripts/
│   ├── bulkApply.js              # Naukri runner
│   ├── bulkApplyWellfound.js     # Wellfound runner
│   ├── bulkApplyIndeed.js        # Indeed runner
│   ├── bulkApplyInstahyre.js     # Instahyre runner
│   ├── login.js                  # Naukri interactive login
│   ├── loginWellfound.js         # Wellfound interactive login
│   ├── loginIndeed.js            # Indeed interactive login
│   └── loginInstahyre.js         # Instahyre interactive login
├── services/
│   ├── applyService.js           # Naukri apply lifecycle & modal handler
│   ├── browserService.js         # Puppeteer Stealth engine & cookie manager
│   ├── questionnaireHandler.js   # Naukri chatbot & questions solver
│   ├── searchService.js          # Naukri query generation & card filter
│   └── storageService.js         # Multi-platform partitioned deduplication
├── utils/
│   ├── delay.js                  # Jitter delays & human emulation
│   └── logger.js                 # Leveled colored console output
├── package.json                  # NPM multi-platform scripts
└── index.js                      # Universal CLI dispatcher
```

---

## 🔒 Security & Privacy

- All sensitive files (`cookies*.json`, `.env`, `data/`, and `Resume.pdf`) are strictly included in `.gitignore`.
- No credentials or session tokens are stored in the codebase or version control.
