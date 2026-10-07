const fs = require('fs');
const profile = require('../../config/profile'); // loads dotenv
const searchCriteria = require('../../config/searchCriteria');
const logger = require('../../utils/logger');
const storage = require('../../services/storageService').getStorage('indeed');
const { randomDelay, humanScroll, humanMouseMove } = require('../../utils/delay');

const INDEED_CONFIG = Object.freeze({
  baseUrl: process.env.INDEED_BASE_URL || 'https://in.indeed.com',
  loginUrl: 'https://secure.indeed.com/auth',
  navTimeoutMs: 30000,
  challengeWaitMs: 60000,
  challengePollMs: 3000,
  // Indeed opens the apply form in a new tab/popup — give it time to appear and load
  applyFlowWaitMs: 15000,
  applyFlowPollMs: 1000,
  maxFormSteps: 10,
  resultsPerPage: 10,
  freshnessDays: searchCriteria.freshnessDays || 3,
  // Indeed's internal filter code for "Easily apply" jobs
  easyApplyFilter: '0kf:attr(DSQF7);',
  applyUrlPattern: /smartapply\.indeed\.com|indeedapply|\/apply\//i,
  questionLogMaxChars: 90,
});

/**
 * Only these outcomes are stored permanently in skipped_indeed.json.
 * Anything else (Cloudflare, slow tab, network error) is retried on the next run.
 */
const PERMANENT_SKIP_REASONS = new Set(['external_apply', 'title_filter_mismatch', 'unanswered_screening_questions']);

class IndeedService {
  constructor() {
    this.storage = storage;
    this.config = INDEED_CONFIG;
    // Prevents re-opening the same job repeatedly within one run when a transient failure occurs
    this.attemptedThisSession = new Set();
  }

  buildSearchUrl(query, location, pageIndex = 0) {
    const params = new URLSearchParams({
      q: query,
      l: location || '',
      fromage: String(INDEED_CONFIG.freshnessDays),
      sc: INDEED_CONFIG.easyApplyFilter,
      start: String(pageIndex * INDEED_CONFIG.resultsPerPage),
    });
    return `${INDEED_CONFIG.baseUrl}/jobs?${params.toString()}`;
  }

  markSkipped(job, reason) {
    const baseReason = reason.split('(')[0];
    if (PERMANENT_SKIP_REASONS.has(baseReason)) {
      this.storage.recordSkipped(job.jobId, job, reason);
    } else {
      logger.warn(`Temporary issue for "${job.title}" (${reason}) — will retry on next run.`);
    }
  }

  /** Cloudflare "Just a moment..." screen — wait for it to clear (user can solve it in the visible window). */
  async waitForChallenge(page) {
    const deadline = Date.now() + INDEED_CONFIG.challengeWaitMs;
    let warned = false;
    while (Date.now() < deadline) {
      const title = (await page.title().catch(() => '')).toLowerCase();
      const isChallenge = title.includes('just a moment') || title.includes('security check');
      if (!isChallenge) return true;
      if (!warned) {
        logger.warn('Indeed security check detected. Solve it in the browser window if prompted...');
        warned = true;
      }
      await randomDelay(INDEED_CONFIG.challengePollMs, INDEED_CONFIG.challengePollMs);
    }
    logger.error('Indeed security check did not clear in time.');
    return false;
  }

  /** Passive check on the current page — never navigates. */
  async isAuthenticated(page) {
    try {
      const cookies = await page.cookies();
      const hasAuthCookie = cookies.some((c) => ['PPID', 'SOCK', 'SHOE'].includes(c.name));

      const domSignals = await page.evaluate(() => {
        const signInLink = Array.from(document.querySelectorAll('a')).find((a) => {
          const text = (a.innerText || '').trim().toLowerCase();
          return text === 'sign in' || (a.href || '').includes('/account/login');
        });
        const accountMenu = document.querySelector(
          '#AccountMenu, [data-gnav-element-name="AccountMenu"], [data-gnav-element-name="Profile"], a[href*="/account/view"]'
        );
        return { hasSignIn: Boolean(signInLink), hasAccount: Boolean(accountMenu) };
      });

      return domSignals.hasAccount || (hasAuthCookie && !domSignals.hasSignIn);
    } catch (err) {
      logger.error('Error checking Indeed login state', err);
      return false;
    }
  }

  async verifySession(page) {
    logger.info('Verifying Indeed session...');
    try {
      await page.goto(`${INDEED_CONFIG.baseUrl}/`, {
        waitUntil: 'domcontentloaded',
        timeout: INDEED_CONFIG.navTimeoutMs,
      });
      if (!(await this.waitForChallenge(page))) return false;
      await randomDelay(2000, 3000);
      return await this.isAuthenticated(page);
    } catch (err) {
      logger.error('Indeed session verification failed', err);
      return false;
    }
  }

  isTitleRelevant(title) {
    const lower = title.toLowerCase();
    if (searchCriteria.titleBlacklist.some((bad) => lower.includes(bad))) return false;
    return searchCriteria.titleWhitelist.some((good) => lower.includes(good));
  }

  async scrapeJobs(page, query, location, pageIndex) {
    const url = this.buildSearchUrl(query, location, pageIndex);
    logger.info(`Searching Indeed: "${query}" in "${location || 'All'}" (Page ${pageIndex + 1})`);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: INDEED_CONFIG.navTimeoutMs });
      if (!(await this.waitForChallenge(page))) return [];
      await randomDelay(2500, 4000);
      await humanScroll(page);

      const rawJobs = await page.evaluate(() => {
        const results = [];
        const seen = new Set();
        const anchors = document.querySelectorAll('a[data-jk], a.jcs-JobTitle');

        anchors.forEach((a) => {
          const jk = a.getAttribute('data-jk') || (a.href.match(/jk=([a-f0-9]+)/i) || [])[1];
          if (!jk || seen.has(jk)) return;
          seen.add(jk);

          const card = a.closest('.job_seen_beacon, .cardOutline, li') || a.parentElement;
          const cardText = (card?.innerText || '').toLowerCase();
          const titleEl = a.querySelector('span[title]') || a;

          results.push({
            jk,
            title: (titleEl.getAttribute('title') || titleEl.innerText || '').trim(),
            company: (card?.querySelector('[data-testid="company-name"]')?.innerText || '').trim(),
            location: (card?.querySelector('[data-testid="text-location"]')?.innerText || '').trim(),
            easyApply: cardText.includes('easily apply') || Boolean(card?.querySelector('[data-testid="indeedApply"], .iaLabel')),
          });
        });

        return results;
      });

      logger.info(`Found ${rawJobs.length} job cards on Indeed page ${pageIndex + 1}.`);

      const qualified = [];
      for (const raw of rawJobs) {
        const job = {
          jobId: raw.jk,
          title: raw.title,
          company: raw.company,
          location: raw.location,
          url: `${INDEED_CONFIG.baseUrl}/viewjob?jk=${raw.jk}`,
        };

        if (this.storage.hasApplied(job.jobId) || this.storage.hasSkipped(job.jobId)) continue;
        if (this.attemptedThisSession.has(job.jobId)) continue;

        if (!raw.easyApply) {
          this.markSkipped(job, 'external_apply');
          continue;
        }

        if (!this.isTitleRelevant(job.title)) {
          logger.skip('Filtered out by title rules', job.title);
          this.markSkipped(job, 'title_filter_mismatch');
          continue;
        }

        qualified.push(job);
      }

      logger.info(`Qualified ${qualified.length} Easily Apply jobs.`);
      return qualified;
    } catch (err) {
      logger.error(`Error scraping Indeed page for "${query}"`, err);
      return [];
    }
  }

  /**
   * Finds the Indeed Apply form after clicking "Apply now".
   * It can open in: a new tab/popup (most common), an iframe modal, or the same tab.
   * Returns a Page or Frame (both support evaluate/$/url).
   */
  async locateApplyFormPage(page, pagesBefore) {
    const deadline = Date.now() + INDEED_CONFIG.applyFlowWaitMs;
    while (Date.now() < deadline) {
      const pages = await page.browser().pages();
      const newTab = pages.find((p) => !pagesBefore.has(p) && p.url() && p.url() !== 'about:blank');
      if (newTab) {
        logger.info('Indeed Apply form opened in a new tab.');
        await newTab.bringToFront().catch(() => {});
        await newTab.waitForNetworkIdle({ idleTime: 800, timeout: INDEED_CONFIG.navTimeoutMs }).catch(() => {});
        return newTab;
      }

      const applyFrame = page.frames().find((f) => f !== page.mainFrame() && INDEED_CONFIG.applyUrlPattern.test(f.url()));
      if (applyFrame) return applyFrame;

      if (INDEED_CONFIG.applyUrlPattern.test(page.url())) return page;

      await randomDelay(INDEED_CONFIG.applyFlowPollMs, INDEED_CONFIG.applyFlowPollMs);
    }
    return null;
  }

  isClosed(formPage) {
    return typeof formPage.isClosed === 'function' ? formPage.isClosed() : formPage.isDetached?.() || false;
  }

  async isSubmissionConfirmed(formPage) {
    if (this.isClosed(formPage)) return false;
    if (/post-apply|applied|submitted|confirmation/i.test(formPage.url())) return true;
    return formPage
      .evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return (
          text.includes('your application has been submitted') ||
          text.includes('application submitted') ||
          text.includes('your application has been sent') ||
          text.includes('you have applied') ||
          text.includes('application has been sent') ||
          text.includes('application received') ||
          text.includes('successfully submitted') ||
          text.includes('application was submitted')
        );
      })
      .catch(() => false);
  }

  /** Identifies the current form step so a non-advancing (validation-blocked) step can be detected. */
  async stepSignature(formPage) {
    const domPart = await formPage
      .evaluate(() => {
        const heading = document.querySelector('h1, h2')?.innerText || '';
        const progress = document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') || '';
        return `${heading}|${progress}`;
      })
      .catch(() => '');
    return `${formPage.url()}|${domPart}`;
  }

  /**
   * Fills the visible screening questions on the current step.
   * Uses the native value setter so React-controlled inputs register changes.
   * Returns the list of required questions it could not answer.
   */
  async fillCurrentStep(formPage) {
    const sa = profile.screeningAnswers;
    const answers = {
      experienceYears: String(profile.experienceYears),
      noticePeriodDays: String(profile.noticePeriodDays),
      expectedCtcLakhs: String(profile.expectedCtcLakhs),
      expectedCtcAnnual: String(Math.round(profile.expectedCtcLakhs * 100000)),
      currentCtcLakhs: String(profile.currentCtcLakhs),
      currentCtcAnnual: String(Math.round(profile.currentCtcLakhs * 100000)),
      city: profile.primaryLocation,
      coverNote: sa.coverNote,
      startDate: sa.startDate,
      skills: profile.skills.map((s) => s.toLowerCase()),
      yesPattern: sa.yesQuestionPattern,
      noPattern: sa.noQuestionPattern,
      defaultYes: sa.defaultYesForUnknown,
      maxChars: INDEED_CONFIG.questionLogMaxChars,
    };

    return formPage.evaluate((ans) => {
      const yesRe = new RegExp(ans.yesPattern, 'i');
      const noRe = new RegExp(ans.noPattern, 'i');
      const unresolved = [];

      const isVisible = (el) => !el.disabled && el.offsetParent !== null;
      const isRequired = (el) => el.required || el.getAttribute('aria-required') === 'true';
      const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();

      const setNativeValue = (el, value) => {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      };

      const labelFor = (el) => (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText : '') || '';

      // Question text for a single field (text/number/textarea/select)
      const questionText = (el) => {
        const parts = [];
        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          labelledBy.split(/\s+/).forEach((id) => parts.push(document.getElementById(id)?.innerText || ''));
        }
        parts.push(labelFor(el));
        parts.push(el.closest('fieldset')?.querySelector('legend')?.innerText || '');
        if (!clean(parts.join(''))) {
          let node = el.parentElement;
          for (let i = 0; i < 5 && node; i++, node = node.parentElement) {
            const label = node.querySelector('label, legend');
            if (label && clean(label.innerText)) {
              parts.push(label.innerText);
              break;
            }
          }
        }
        return clean(parts.join(' ')).toLowerCase();
      };

      // Question text for a group of options (radios/checkboxes): smallest container holding all options
      const groupQuestionText = (inputs) => {
        const legend = inputs[0].closest('fieldset')?.querySelector('legend')?.innerText;
        if (legend) return clean(legend).toLowerCase();
        let node = inputs[0].parentElement;
        while (node && !inputs.every((i) => node.contains(i))) node = node.parentElement;
        return clean(node?.innerText || '').toLowerCase();
      };

      const optionLabel = (input) =>
        clean(labelFor(input) || input.closest('label')?.innerText || input.value || '').toLowerCase();

      const shortQ = (q) => q.slice(0, ans.maxChars);

      const pickTextAnswer = (q, el) => {
        const isNumeric = el.type === 'number' || el.inputMode === 'numeric';
        const inLakhs = /lpa|lakh|lac/.test(q);
        if (/expected.*(ctc|salary|compensation|pay)|salary expectation|desired (salary|pay)/.test(q)) {
          return inLakhs || !isNumeric ? ans.expectedCtcLakhs : ans.expectedCtcAnnual;
        }
        if (/current.*(ctc|salary|compensation|pay)/.test(q)) {
          return inLakhs || !isNumeric ? ans.currentCtcLakhs : ans.currentCtcAnnual;
        }
        if (/notice/.test(q)) return ans.noticePeriodDays;
        if (/experience|years/.test(q)) return ans.experienceYears;
        if (/when can you (start|join)|start date|earliest.*(start|join)|joining date/.test(q)) {
          return isNumeric ? ans.noticePeriodDays : ans.startDate;
        }
        if (/city|location|where.*(live|based|reside)/.test(q)) return ans.city;
        if (/gender/.test(q)) return 'Male';
        if (/degree|qualification/.test(q)) return 'Master of Computer Applications';
        return null;
      };

      // 1. Text / number / tel inputs
      document.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input:not([type])').forEach((el) => {
        if (el.value || !isVisible(el)) return;
        const q = questionText(el);
        const value = pickTextAnswer(q, el);
        if (value !== null) setNativeValue(el, value);
        else if (isRequired(el)) unresolved.push(shortQ(q) || 'unlabelled text field');
      });

      // 2. Textareas — known numeric/salary questions first, otherwise the cover note
      document.querySelectorAll('textarea').forEach((el) => {
        if (el.value || !isVisible(el)) return;
        const q = questionText(el);
        setNativeValue(el, pickTextAnswer(q, el) ?? ans.coverNote);
      });

      // 3. Radio groups
      const radioGroups = {};
      document.querySelectorAll('input[type="radio"]').forEach((r) => {
        if (!isVisible(r) && r.offsetParent === null && !r.closest('label')) return;
        (radioGroups[r.name] = radioGroups[r.name] || []).push(r);
      });
      Object.values(radioGroups).forEach((group) => {
        if (group.some((r) => r.checked)) return;
        const q = groupQuestionText(group);
        const find = (re) => group.find((r) => re.test(optionLabel(r)));
        const yes = find(/^yes\b/);
        const no = find(/^no\b/);

        let choice = null;
        if (/experience|years/.test(q)) {
          choice = find(/^0\b|fresher|less than|no experience|none|^< ?1/);
        }
        if (!choice && /gender|sex\b/.test(q)) {
          choice = find(/^male\b/) || find(/prefer not to say|do not wish/);
        }
        if (!choice && /degree|qualification|education/.test(q)) {
          choice = find(/master|mca|post graduate|bachelor/);
        }
        if (!choice && yes && no) {
          if (noRe.test(q)) choice = no;
          else if (yesRe.test(q) || ans.defaultYes) choice = yes;
        }
        if (choice) choice.click();
        else unresolved.push(shortQ(q) || 'unlabelled radio question');
      });

      // 4. Checkboxes — tick options matching your skills; tick required consent boxes
      const checkboxGroups = {};
      document.querySelectorAll('input[type="checkbox"]').forEach((c) => {
        (checkboxGroups[c.name || c.id] = checkboxGroups[c.name || c.id] || []).push(c);
      });
      Object.values(checkboxGroups).forEach((group) => {
        if (group.some((c) => c.checked)) return;
        const skillMatches = group.filter((c) => ans.skills.some((s) => optionLabel(c).includes(s)));
        if (skillMatches.length) skillMatches.forEach((c) => c.click());
        else if (group.some(isRequired)) group[0].click();
      });

      // 5. Selects
      document.querySelectorAll('select').forEach((sel) => {
        if (sel.value || !isVisible(sel)) return;
        const q = questionText(sel);
        const opts = Array.from(sel.options).filter((o) => o.value);
        const find = (re) => opts.find((o) => re.test(o.text.trim().toLowerCase()));

        let opt = null;
        if (/notice|join|start/.test(q)) opt = find(/immediate|^0|15 days|less than/);
        else if (/experience|years/.test(q)) opt = find(/^0\b|fresher|less than|no experience|none/);
        else if (/gender|sex\b/.test(q)) opt = find(/^male\b/) || find(/prefer not to say|do not wish/);
        else if (/degree|qualification|education/.test(q)) opt = find(/master|mca|post graduate|bachelor/);
        else if (find(/^yes\b/) && find(/^no\b/)) {
          if (noRe.test(q)) opt = find(/^no\b/);
          else if (yesRe.test(q) || ans.defaultYes) opt = find(/^yes\b/);
        }

        if (opt) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (isRequired(sel)) {
          unresolved.push(shortQ(q) || 'unlabelled dropdown');
        }
      });

      return unresolved;
    }, answers);
  }

  /** Clicks the step's primary action button. Returns the clicked button text, or null if none found. */
  async clickContinue(formPage) {
    return formPage.evaluate(() => {
      const clean = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();

      // 1. Direct testid selectors
      const testidSelectors = [
        '[data-testid*="continue"]',
        '[data-testid*="submit"]',
        '[data-testid*="review"]',
        '[data-testid*="next"]',
        '[data-testid*="primary-button"]',
        '.ia-continueButton',
        '[class*="continueButton"]',
      ];
      for (const sel of testidSelectors) {
        const el = document.querySelector(sel);
        if (el && !el.disabled && el.getAttribute('aria-disabled') !== 'true') {
          el.scrollIntoView({ block: 'center' });
          el.click();
          return clean(el.innerText || el.value || 'continue');
        }
      }

      // 2. All clickable candidate elements (including <a>, <button>, <input>)
      const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]'));
      const target = candidates.find((b) => {
        const t = clean(b.innerText || b.textContent || b.value || b.getAttribute('aria-label'));
        return (
          t.includes('continue') ||
          t.includes('next') ||
          t.includes('review your application') ||
          t.includes('submit your application') ||
          t.includes('submit application') ||
          t === 'submit' ||
          t.includes('apply anyway')
        );
      });

      if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') {
        const visible = candidates.filter((b) => b.offsetParent !== null).map((b) => clean(b.innerText || b.value)).slice(0, 10);
        return visible.length ? null : null;
      }

      target.scrollIntoView({ block: 'center' });
      target.click();
      return clean(target.innerText || target.value || 'clicked');
    });
  }

  /** Uploads Resume.pdf only when no resume is already selected on Indeed. */
  async uploadResumeIfRequested(formPage) {
    const fileInput = await formPage.$('input[type="file"]');
    if (!fileInput || !fs.existsSync(profile.resumePath)) return;
    const hasSelectedResume = await formPage.evaluate(() => {
      const selected = document.querySelector('input[type="radio"]:checked, [aria-checked="true"], [aria-selected="true"]');
      const uploadedCard = /uploaded\s+\w+\s+\d/i.test(document.body.innerText);
      return Boolean(selected) || uploadedCard;
    });
    if (hasSelectedResume) return;
    await fileInput.uploadFile(profile.resumePath);
    logger.info('Uploaded Resume.pdf');
    await randomDelay(2000, 3000);
  }

  async runApplyForm(formPage) {
    let lastSignature = '';
    let submitClicked = false;

    for (let step = 1; step <= INDEED_CONFIG.maxFormSteps; step++) {
      await randomDelay(1500, 2500);

      // Indeed sometimes closes the popup tab itself right after a successful submit
      if (this.isClosed(formPage)) return submitClicked ? { ok: true } : { ok: false, reason: 'apply_tab_closed' };
      if (await this.isSubmissionConfirmed(formPage)) return { ok: true };

      await this.uploadResumeIfRequested(formPage);
      const unresolved = await this.fillCurrentStep(formPage);
      if (unresolved.length) logger.warn(`Unanswered required question(s): ${unresolved.join(' | ')}`);

      const signature = await this.stepSignature(formPage);
      if (signature === lastSignature) {
        return {
          ok: false,
          reason: unresolved.length ? `unanswered_screening_questions(${unresolved.length})` : 'form_stuck_validation_error',
        };
      }
      lastSignature = signature;

      await randomDelay(800, 1500);
      const clicked = await this.clickContinue(formPage);
      if (!clicked) {
        return submitClicked ? { ok: true } : { ok: false, reason: 'no_continue_button' };
      }

      const isSubmitAction = clicked.includes('submit') || clicked.includes('apply anyway') || clicked === 'apply';
      if (isSubmitAction) {
        submitClicked = true;
        logger.info(`Indeed form step ${step}: clicked submit action "${clicked}".`);
        await randomDelay(2500, 3500);
        if (this.isClosed(formPage) || (await this.isSubmissionConfirmed(formPage))) {
          return { ok: true };
        }
      } else {
        logger.info(`Indeed form step ${step}: clicked "${clicked}".`);
      }
    }

    await randomDelay(2000, 3000);
    if (this.isClosed(formPage)) return submitClicked ? { ok: true } : { ok: false, reason: 'apply_tab_closed' };
    return (await this.isSubmissionConfirmed(formPage) || submitClicked) ? { ok: true } : { ok: false, reason: 'max_steps_exceeded' };
  }

  async applyToJob(page, job) {
    logger.info(`Opening Indeed job: "${job.title}" at ${job.company || 'Unknown'}`);
    this.attemptedThisSession.add(job.jobId);
    let formPage = null;

    try {
      // 1. If currently on search results, click card directly to load preview pane without full-page Cloudflare challenge
      const cardOnPage = await page.$(`a[data-jk="${job.jobId}"]`);
      if (cardOnPage) {
        await cardOnPage.evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
        await cardOnPage.click().catch(() => {});
        await randomDelay(2500, 3500);
      } else {
        await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: INDEED_CONFIG.navTimeoutMs });
        if (!(await this.waitForChallenge(page))) {
          this.markSkipped(job, 'security_check');
          return { status: 'FAILED', reason: 'security_check' };
        }
        await randomDelay(2000, 3500);
      }

      await humanScroll(page);
      await humanMouseMove(page);

      const pagesBefore = new Set(await page.browser().pages());

      const buttonState = await page.evaluate(() => {
        const text = (el) => (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase();

        // Check if already applied
        const bodyText = document.body.innerText.toLowerCase();
        if (bodyText.includes('you applied on') || bodyText.includes('application submitted')) {
          return { state: 'applied' };
        }

        // 1. Look for Indeed Apply link or button
        const selectors = [
          '[data-testid="viewjob-indeed-apply"]',
          'a[href*="smartapply.indeed.com"]',
          '#indeedApplyButton',
          '[id*="indeedApplyButton"]',
          '[data-testid*="indeedApplyButton"]',
          '.jobsearch-IndeedApplyButton-newDesign',
          'button[aria-label*="Apply now"]',
          'a[aria-label*="Apply now"]',
        ];

        let btn = null;
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) {
            btn = el;
            break;
          }
        }

        // 2. Fallback to any button or link whose text is Apply now / Easily apply
        if (!btn) {
          const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"]'));
          btn = candidates.find((b) => {
            const t = text(b);
            return (t === 'apply now' || t === 'easily apply' || t === 'apply on indeed' || t === 'apply') && b.offsetParent !== null;
          });
        }

        if (!btn) {
          const external = Array.from(document.querySelectorAll('a, button')).some((el) => /company site/i.test(text(el)));
          return { state: external ? 'external' : 'missing' };
        }

        if (/applied/i.test(text(btn))) return { state: 'applied' };

        const href = btn.getAttribute('href') || btn.href || null;
        btn.scrollIntoView({ block: 'center' });
        btn.click();
        return { state: 'clicked', href };
      });

      if (buttonState.state === 'applied') {
        this.storage.recordApplied(job.jobId, job);
        return { status: 'SKIPPED', reason: 'already_applied' };
      }
      if (buttonState.state !== 'clicked') {
        const reason = buttonState.state === 'external' ? 'external_apply' : 'no_apply_button';
        this.markSkipped(job, reason);
        return { status: 'SKIPPED', reason };
      }

      // If clicking didn't open a new tab and an href was provided, open it explicitly
      if (buttonState.href && (await page.browser().pages()).length === pagesBefore.size) {
        const newTab = await page.browser().newPage();
        await newTab.goto(buttonState.href, { waitUntil: 'domcontentloaded', timeout: INDEED_CONFIG.navTimeoutMs }).catch(() => {});
      }

      formPage = await this.locateApplyFormPage(page, pagesBefore);
      if (!formPage) {
        this.markSkipped(job, 'apply_form_not_detected');
        return { status: 'SKIPPED', reason: 'apply_form_not_detected' };
      }
      if (formPage !== page && typeof formPage.on === 'function') {
        formPage.on('dialog', (d) => d.accept().catch(() => {}));
        if (!(await this.waitForChallenge(formPage))) {
          this.markSkipped(job, 'security_check');
          return { status: 'FAILED', reason: 'security_check' };
        }
      }

      const result = await this.runApplyForm(formPage);
      if (result.ok) {
        logger.success(`Applied on Indeed: ${job.title} at ${job.company}`);
        this.storage.recordApplied(job.jobId, job);
        return { status: 'APPLIED' };
      }

      logger.warn(`Skipped ${job.title}: ${result.reason}`);
      this.markSkipped(job, result.reason);
      return { status: 'SKIPPED', reason: result.reason };
    } catch (err) {
      logger.error(`Indeed application failed for ${job.title}`, err);
      this.markSkipped(job, `error: ${err.message}`);
      return { status: 'FAILED', reason: err.message };
    } finally {
      const isSeparateTab = formPage && formPage !== page && typeof formPage.close === 'function';
      if (isSeparateTab && !formPage.isClosed()) await formPage.close().catch(() => {});
      await page.bringToFront().catch(() => {});
    }
  }
}

module.exports = new IndeedService();
