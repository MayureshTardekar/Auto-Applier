const logger = require('../../utils/logger');
const guardrails = require('../../config/guardrails');
const searchCriteria = require('../../config/searchCriteria');
const storage = require('../../services/storageService').getStorage('timesjobs');
const filters = require('../../utils/jobFilters');
const rotation = require('../../utils/rotation');
const { randomDelay, humanScroll, humanMouseMove } = require('../../utils/delay');

const PLATFORM = 'timesjobs';
const MAX_SEARCHES_PER_RUN = 10;

class TimesJobsService {
  constructor() {
    this.platform = PLATFORM;
    this.storage = storage;
    this.baseUrl = 'https://www.timesjobs.com';
  }

  getPitchNote(company = 'your team') {
    return (
      'MCA graduate from Sardar Patel Institute of Technology (SPIT) with hands-on project experience in Java, ' +
      'Spring Boot, Python, FastAPI, Node.js, PostgreSQL and Redis, plus GenAI applications using RAG, LLMs and ' +
      `vector search. Immediate joiner. Excited to contribute to ${company}.`
    );
  }

  async verifySession(page) {
    logger.info('Verifying TimesJobs session...');
    try {
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await randomDelay(2500, 4000);

      const body = await page.evaluate(() => document.body.innerText.slice(0, 2500).toLowerCase());
      if (body.includes('access denied')) {
        logger.error('TimesJobs returned "Access Denied". Cookies cannot help this run.');
        return false;
      }

      const currentUrl = page.url();
      if (/\/login|\/register/i.test(currentUrl)) return false;

      return await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        if (text.includes('logout') || text.includes('my profile') || text.includes('my applications')) return true;

        const loginLinkVisible = Array.from(document.querySelectorAll('a[href*="/login"]')).some(
          (a) => a.offsetParent !== null && /login/i.test(a.innerText || '')
        );

        return !loginLinkVisible;
      });
    } catch (err) {
      logger.error('TimesJobs session verification failed', err);
      return false;
    }
  }

  buildSearchUrl(query) {
    // The quoted `keywords` param is what TimesJobs' own quick links use and
    // returns the most relevant results. Adding a location param makes the
    // site ignore the keyword, so location is filtered client-side instead.
    const params = new URLSearchParams({ keywords: `"${query}"` });
    return `${this.baseUrl}/job-search?${params.toString()}`;
  }

  parsePostedDate(text) {
    const match = String(text || '').match(/(\d{2})-(\d{2})-(\d{4})/);
    if (!match) return null;
    const [, dd, mm, yyyy] = match;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  }

  async extractCards(page) {
    return page.evaluate(() => {
      const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
      const cards = Array.from(document.querySelectorAll('.srp-card'));
      const out = [];
      const seen = new Set();

      cards.forEach((card, index) => {
        const link = card.querySelector('a[href*="/job-detail/"]');
        const href = link?.href || '';
        if (!href || seen.has(href)) return;
        seen.add(href);

        let title = norm(card.querySelector('h2')?.innerText);
        title = title.replace(/\s*Job Details\s*\|.*$/i, '').trim();

        const meta = card.querySelector('.text-xs.text-gray-400');
        const company = norm(meta?.querySelector('span')?.innerText);
        const postedRaw = norm(meta?.innerText);

        const location = norm(card.querySelector('i.locations-icon')?.parentElement?.innerText);
        const experience = norm(card.querySelector('i.years-icon')?.parentElement?.innerText);

        const idMatch = href.match(/jobid-([^&?/]+)/i);

        out.push({
          jobId: idMatch ? idMatch[1].replace(/[^a-zA-Z0-9]/g, '') : `timesjobs_${index}_${href}`,
          title,
          url: href,
          company,
          location,
          experience,
          postedRaw,
        });
      });

      return out;
    });
  }

  async scrapeSearchPage(page, url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(3000, 4500);
    await humanScroll(page);

    if ((await page.title()).toLowerCase().includes('access denied')) {
      logger.error('TimesJobs blocked the search page (Access Denied).');
      return [];
    }

    const maxPages = Math.min(guardrails.maxPagesPerQuery, 2);
    const all = [];
    const seen = new Set();

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      if (pageNum > 1) {
        const clicked = await page.evaluate((n) => {
          const btn = Array.from(document.querySelectorAll('button')).find(
            (b) => (b.innerText || '').trim() === String(n) && b.offsetParent !== null
          );
          if (btn) {
            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            btn.click();
            return true;
          }
          return false;
        }, pageNum);

        if (!clicked) break;
        await randomDelay(2500, 4000);
        await humanScroll(page);
      }

      const batch = await this.extractCards(page);
      for (const card of batch) {
        if (seen.has(card.jobId)) continue;
        seen.add(card.jobId);
        all.push(card);
      }
    }

    return all;
  }

  async scrapeJobs(page) {
    logger.info('Scanning TimesJobs search results...');

    const allQueries = searchCriteria.queries;
    const startOffset = rotation.loadOffset(PLATFORM, allQueries.length);
    const queries = rotation.rotate(allQueries, startOffset);

    const qualified = [];
    const seen = new Set();
    let searches = 0;

    for (const query of queries) {
      if (qualified.length >= guardrails.maxCandidatesPerRun) break;
      if (searches >= MAX_SEARCHES_PER_RUN) break;

      searches++;
      const url = this.buildSearchUrl(query);
      logger.info(`TimesJobs search: "${query}" (${searches}/${MAX_SEARCHES_PER_RUN})`);

      const cards = await this.scrapeSearchPage(page, url);
      logger.info(`Found ${cards.length} cards for "${query}".`);

      const freshnessCutoff = Date.now() - searchCriteria.freshnessDays * 24 * 60 * 60 * 1000;

      for (const card of cards) {
        if (qualified.length >= guardrails.maxCandidatesPerRun) break;

        const jobId = String(card.jobId);
        if (seen.has(jobId)) continue;
        seen.add(jobId);

        if (this.storage.hasApplied(jobId)) continue;
        if (this.storage.hasSkipped(jobId)) continue;

        if (!filters.isTitleRelevant(card.title)) {
          logger.skip('Filtered out by title rules', card.title);
          this.storage.recordSkipped(jobId, card, 'title_filter_mismatch');
          continue;
        }

        if (filters.isCompanyBlacklisted(card.company)) {
          logger.skip('Company blacklisted', `${card.title} @ ${card.company}`);
          this.storage.recordSkipped(jobId, card, 'company_blacklisted');
          continue;
        }

        if (!filters.passesExperience(card.experience)) {
          logger.skip(`Requires ${card.experience}`, card.title);
          this.storage.recordSkipped(jobId, card, 'experience_too_high');
          continue;
        }

        const postedDate = this.parsePostedDate(card.postedRaw);
        if (postedDate && postedDate.getTime() < freshnessCutoff) {
          logger.skip(`Stale listing (${card.postedRaw})`, card.title);
          this.storage.recordSkipped(jobId, card, 'stale_listing');
          continue;
        }

        if (!filters.isLocationRelevant(card.location)) {
          logger.skip(`Location outside target list (${card.location})`, card.title);
          this.storage.recordSkipped(jobId, card, 'location_mismatch');
          continue;
        }

        qualified.push({ ...card, jobId });
      }
    }

    rotation.saveOffset(PLATFORM, startOffset + Math.max(searches, 1), allQueries.length);

    logger.info(`Qualified ${qualified.length} TimesJobs roles matching your profile.`);
    return qualified;
  }

  async applyToJob(page, job) {
    logger.info(`Opening TimesJobs job: "${job.title}" at ${job.company || 'Unknown'}`);

    try {
      await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await randomDelay(2000, 3500);
      await humanScroll(page);
      await humanMouseMove(page);

      const alreadyApplied = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('already applied') || text.includes('you have applied');
      });
      if (alreadyApplied) {
        logger.skip('Already applied according to page status', job.title);
        this.storage.recordApplied(job.jobId, job);
        return { status: 'SKIPPED', reason: 'already_applied' };
      }

      const state = await page.evaluate(() => {
        const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const text = norm(document.body.innerText);

        const externalHint =
          text.includes("redirected to the company's website") ||
          text.includes('redirected to the company') ||
          text.includes('apply on company site') ||
          text.includes('company website to apply');

        const btn = Array.from(document.querySelectorAll('button, a')).find((b) => {
          const t = norm(b.innerText || b.value);
          return t === 'apply' || t === 'apply now' || t.includes('apply now');
        });

        if (btn) btn.setAttribute('data-bot-apply-target', 'true');

        return {
          found: Boolean(btn),
          externalHint,
          selector: '[data-bot-apply-target="true"]',
        };
      });

      if (!state.found) {
        logger.warn(`No apply button found on TimesJobs: ${job.title}`);
        this.storage.recordSkipped(job.jobId, job, 'no_apply_button_found');
        this.storage.recordManualApply(job, 'no_apply_button_found');
        return { status: 'SKIPPED', reason: 'no_apply_button_found' };
      }

      if (state.externalHint) {
        const beforeUrl = page.url();

        const popupPromise = new Promise((resolve) => {
          const timer = setTimeout(() => resolve(null), 10000);
          page.once('popup', (popup) => {
            clearTimeout(timer);
            resolve(popup);
          });
        });

        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.click();
          }
        }, state.selector);

        const popup = await popupPromise;
        let externalUrl = '';

        if (popup) {
          try {
            await popup.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 });
          } catch {
            // Page may already be loaded or blocked
          }
          externalUrl = popup.url();
          await popup.close().catch(() => {});
          await page.bringToFront().catch(() => {});
        } else {
          await randomDelay(3000, 5000);
          if (page.url() !== beforeUrl) externalUrl = page.url();
        }

        logger.skip('External company site application required (queued for manual apply)', job.title);
        this.storage.recordSkipped(job.jobId, job, 'external_site_redirect');
        const manualUrl = externalUrl && /^https?:/i.test(externalUrl) ? externalUrl : job.url;
        this.storage.recordManualApply({ ...job, url: manualUrl }, 'external_site_redirect');
        return { status: 'SKIPPED', reason: 'external_site_redirect' };
      }

      // Fallback: native-style apply form (rare on TimesJobs)
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.click();
        }
      }, state.selector);
      await randomDelay(2500, 4000);

      await page.evaluate((pitch) => {
        const fields = Array.from(document.querySelectorAll('textarea, [contenteditable="true"]')).filter(
          (el) => el.offsetParent !== null
        );
        for (const el of fields) {
          if (el.tagName === 'TEXTAREA') {
            if (!el.value || !el.value.trim()) el.value = pitch;
          } else if (!(el.innerText || '').trim()) {
            el.innerHTML = `<p>${pitch}</p>`;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, this.getPitchNote(job.company));

      await page.evaluate(() => {
        const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const scope = document.querySelector('.modal, [role="dialog"]') || document;
        const btn = Array.from(scope.querySelectorAll('button')).find((b) => {
          const t = norm(b.innerText);
          return t === 'submit' || t.includes('submit application') || t === 'apply';
        });
        if (btn) btn.click();
      });

      await randomDelay(2500, 4000);

      const isSuccess = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return (
          text.includes('applied successfully') ||
          text.includes('application submitted') ||
          text.includes('successfully applied')
        );
      });

      if (isSuccess) {
        logger.success(`Successfully applied on TimesJobs: ${job.title}`);
        this.storage.recordApplied(job.jobId, job);
        return { status: 'APPLIED' };
      }

      logger.warn(`Application status unconfirmed for: ${job.title}`);
      this.storage.recordSkipped(job.jobId, job, 'unconfirmed_submission');
      this.storage.recordManualApply(job, 'unconfirmed_submission');
      return { status: 'SKIPPED', reason: 'unconfirmed_submission' };
    } catch (err) {
      if (/detached Frame|Target closed|Session closed/i.test(err.message)) {
        logger.warn('Detached frame detected. Recovering active page...');
      }
      logger.error(`TimesJobs application failed for: ${job.title}`, err);
      this.storage.recordSkipped(job.jobId, job, `error: ${err.message}`);
      this.storage.recordManualApply(job, `error: ${err.message}`);
      return { status: 'FAILED', reason: err.message };
    }
  }
}

module.exports = new TimesJobsService();
