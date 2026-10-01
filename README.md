# Auto-Applier 🚀

A modular, stealth-configured automation engine built with Node.js and Puppeteer to find, filter, and bulk-apply to tech roles across **Naukri** and **Instahyre**.

---

## ⚡ Quickstart

### 1. Installation
Clone the repository and install dependencies:

```bash
git clone https://github.com/MayureshTardekar/Auto-Applier.git
cd Auto-Applier
npm install
```

### 2. Configure Environment
Copy the `.env.example` file to create your `.env`:

```bash
cp .env.example .env
```

Ensure your `.env` contains your target details:
```env
HEADLESS=false
BROWSER_EXECUTABLE_PATH=C:\Users\YOUR_USERNAME\AppData\Local\BraveSoftware\Brave-Browser\Application\brave.exe
MAX_APPLIES_PER_RUN=35
MAX_APPLIES_PER_DAY=50
EXPECTED_CTC_LAKHS=9.5
```

### 3. Add Your Resume
Place your resume as `Resume.pdf` in the project root directory.

---

## 🎯 Platform Usage

### Platform 1: Naukri

#### Step A: Export Cookies (One-Time)
1. In your regular Brave/Chrome browser, open your logged-in **Naukri** tab.
2. Using the **Cookie-Editor** extension, click **Export** $\rightarrow$ **Export as JSON**.
3. Create/paste into `cookies.json` in the project root.
*(Alternatively, run `npm run login:naukri` to sign in through the automated window).*

#### Step B: Run Applications
```bash
npm run apply:naukri
```
- Automatically searches targeted entry-level roles (Software Engineer, Java, Spring Boot, Backend, Python, Data Analyst, GenAI).
- Skips external redirect jobs and filters out non-relevant listings.
- Auto-fills recruiter chatbot questionnaires (0 experience, immediate notice, expected CTC).
- Applies with humanized jitter delays (12–25 seconds) to keep your account safe.

---

### Platform 2: Instahyre

#### Step A: Export Cookies (One-Time)
1. Open your logged-in **Instahyre** tab.
2. Using Cookie-Editor, click **Export** $\rightarrow$ **Export as JSON**.
3. Create/paste into `cookies_instahyre.json` in the project root.
*(Alternatively, run `npm run login:instahyre`).*

#### Step B: Run Applications
```bash
npm run apply:instahyre
```
- Scrapes your curated opportunity feed on Instahyre.
- Filters opportunities matching your whitelist keywords.
- Injects a personalized recruiter pitch note highlighting your projects and immediate availability.
- Submits applications and tracks status.

---

### Platform 3: Wellfound (AngelList)

#### Step A: Export Cookies (One-Time)
1. In your Brave/Chrome browser, open your logged-in **Wellfound** tab (`https://wellfound.com/jobs`).
2. Using **Cookie-Editor**, click **Export** $\rightarrow$ **Export as JSON**.
3. Create/paste into `cookies_wellfound.json` in the project root.
*(Alternatively, run `npm run login:wellfound`).*

#### Step B: Run Applications
```bash
npm run apply:wellfound
```
- Scrapes active startup job listings for AI, Backend, Java, Python, and Data roles.
- Filters listings against your whitelist and blacklist.
- Injects a personalized founder/recruiter pitch note with your SPIT MCA & project credentials.
- Submits applications and records them in `data/applied_wellfound.json`.

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
Modify `config/profile.js` to adjust default answers for chatbot questions (CTC, Notice Period, Locations).

### Safety Caps & Delays
Modify `.env` to customize your application speed:
- `MAX_APPLIES_PER_RUN`: Applications per run (default: `35`)
- `MAX_APPLIES_PER_DAY`: Daily safety cap (default: `50`)
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
│   └── applied_instahyre.json    # Instahyre application history
├── platforms/
│   └── instahyre/
│       └── instahyreService.js   # Instahyre scraper & recruiter pitch handler
├── scripts/
│   ├── bulkApply.js              # Naukri runner
│   ├── bulkApplyInstahyre.js     # Instahyre runner
│   ├── login.js                  # Naukri interactive login
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

- All sensitive files (`cookies*.json`, `.env`, and `data/`) are strictly included in `.gitignore`.
- No passwords or tokens are stored in the codebase.
