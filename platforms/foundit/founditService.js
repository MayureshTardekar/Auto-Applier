const logger = require('../../utils/logger');
const guardrails = require('../../config/guardrails');
const searchCriteria = require('../../config/searchCriteria');
const storage = require('../../services/storageService').getStorage('foundit');
const filters = require('../../utils/jobFilters');
const rotation = require('../../utils/rotation');
const { randomDelay, humanScroll, humanMouseMove } = require('../../utils/delay');

const PLATFORM = 'foundit';
const MAX_SEARCHES_PER_RUN = 12;

class FounditService {
  constructor() {
    this.platform = PLATFORM;
    this.storage = storage;
    this.baseUrl = 'https://www.foundit.in';
  }

  getPitchNote(company = 'your team') {
    return (
      'MCA graduate from Sardar Patel Institute of Technology (SPIT) with hands-on project experience in Java, ' +
      'Spring Boot, Python, FastAPI, Node.js, PostgreSQL and Redis, plus GenAI applications using RAG, LLMs and ' +
      `vector search. Immediate joiner (0 days notice). Excited to contribute to ${company}.`
    );
  }

  async verifySession(page) {
    logger.info('Verifying Foundit session...');
    try {
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await randomDelay(2000, 3000);

      const body = await page.evaluate(() => document.body.innerText.slice(0, 3000).toLowerCase());
      if (body.includes('access denied')) {
        logger.error('Foundit returned "Access Denied" (Akamai bot protection). Cookies cannot help this run.');
        return false;
      }

      const currentUrl = page.url();
      if (currentUrl.includes('/login') || currentUrl.includes('/signup')) return false;

      return await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        if (text.includes('logout') || text.includes('my profile') || text.includes('my applications')) return true;
        return Boolean(
          document.querySelector('a[href*="/profile"]') ||
          document.querySelector('a[href*="/logout"]') ||
          document.querySelector('[class*="userName"], [class*="user-name"], [class*="userAvatar"]')
        );
      });
    } catch (err) {
      logger.error('Foundit session verification failed', err);
      return false;
    }
  }

  buildSearchUrl(query) {
    const params = new URLSearchParams({ query });
    return `${this.baseUrl}/search/jobs?${params.toString()}`;
  }

  async scrapeSearchPage(page, url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(2500, 4000);
    await humanScroll(page);

    const blocked = await page.evaluate(() =>
      document.body.innerText.toLowerCase().includes('access denied')
    );
    if (blocked) {
      logger.error('Foundit blocked the search page (Access Denied).');
      this.blocked = true;
      return [];
    }

    return page.evaluate(() => {
      const selectorGroups = [
        '[data-job-id]',
        '.job-card',
        '.srpResultCardContainer',
        '.cardContainer',
        'article.jobTuple',
        'li.job-card',
      ];

      let cards = [];
      let bestSelector = '';
      for (const selector of selectorGroups) {
        const found = Array.from(document.querySelectorAll(selector));
        if (found.length > cards.length) {
          cards = found;
          bestSelector = selector;
        }
      }

      const results = [];
      const seen = new Set();

      cards.forEach((card, index) => {
        const titleEl = card.querySelector(
          '.jobTitle a, .title a, a.title, h3 a, h2 a, a[href*="/job-listings"], a[href*="/jobs/"]'
        );
        if (!titleEl) return;

        const title = (titleEl.innerText || titleEl.textContent || '').replace(/\s+/g, ' ').trim();
        const href = titleEl.href || '';
        if (!title || !href || seen.has(href)) return;
        seen.add(href);

        const companyEl = card.querySelector('.companyName, .company-name, .comp-name, .company');
        const locationEl = card.querySelector('.location, .locations, .loc-wrap, .loc');
        const experienceEl = card.querySelector('.experience, .exp-wrap, .exp');
        const postedEl = card.querySelector(
          '.postedDate, .posted-date, .job-post-day, [class*="postDate"], [class*="posted"]'
        );

        results.push({
          jobId:
            card.getAttribute('data-job-id') ||
            card.getAttribute('data-id') ||
            `foundit_${index}_${href}`,
          title,
          url: href,
          company: (companyEl?.innerText || '').replace(/\s+/g, ' ').trim(),
          location: (locationEl?.innerText || '').replace(/\s+/g, ' ').trim(),
          experience: (experienceEl?.innerText || '').replace(/\s+/g, ' ').trim(),
          posted: (postedEl?.innerText || '').replace(/\s+/g, ' ').trim(),
          selector: bestSelector,
        });
      });

      return results;
    });
  }

  async scrapeJobs(page) {
    logger.info('Scanning Foundit job search results...');

    this.blocked = false;
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
      logger.info(`Foundit search: "${query}" (${searches}/${MAX_SEARCHES_PER_RUN})`);

      const cards = await this.scrapeSearchPage(page, url);
      logger.info(`Found ${cards.length} cards for "${query}".`);

      // Stop hitting the site once Akamai starts denying this session.
      if (this.blocked) break;

      for (const card of cards) {
        if (qualified.length >= guardrails.maxCandidatesPerRun) break;

        const jobId = String(card.jobId || this.storage.extractJobId(card.url));
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

        if (filters.isStale(card.posted)) {
          logger.skip(`Stale listing (${card.posted})`, card.title);
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

    logger.info(`Qualified ${qualified.length} Foundit roles matching your profile.`);
    return qualified;
  }

  async applyToJob(page, job) {
    logger.info(`Opening Foundit job: "${job.title}" at ${job.company || 'Unknown'}`);

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
        const candidates = Array.from(document.querySelectorAll('button, a'));
        const el = candidates.find((c) => {
          const t = norm(c.innerText || c.value);
          return (
            t === 'apply' ||
            t === 'apply now' ||
            t === 'easy apply' ||
            t.startsWith('apply on ') ||
            t.startsWith('apply with ')
          );
        });

        if (!el) return { found: false };

        const text = norm(el.innerText || el.value);
        const isExternal = /company|employer|external|website/.test(text);
        if (!isExternal) el.setAttribute('data-bot-apply-target', 'true');

        return {
          found: true,
          isExternal,
          href: el.href || '',
          selector: '[data-bot-apply-target="true"]',
        };
      });

      if (!state.found) {
        logger.warn(`No apply button found on Foundit: ${job.title}`);
        this.storage.recordSkipped(job.jobId, job, 'no_apply_button_found');
        this.storage.recordManualApply(job, 'no_apply_button_found');
        return { status: 'SKIPPED', reason: 'no_apply_button_found' };
      }

      if (state.isExternal) {
        logger.skip('External company site application required (queued for manual apply)', job.title);
        this.storage.recordSkipped(job.jobId, job, 'external_site_redirect');
        const manualJob = state.href && /^https?:/i.test(state.href) ? { ...job, url: state.href } : job;
        this.storage.recordManualApply(manualJob, 'external_site_redirect');
        return { status: 'SKIPPED', reason: 'external_site_redirect' };
      }

      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.click();
        }
      }, state.selector);
      await randomDelay(2000, 3500);

      // Fill optional cover-note / textarea fields
      const filled = await page.evaluate((pitch) => {
        const fields = Array.from(
          document.querySelectorAll('textarea, [contenteditable="true"], .ql-editor')
        ).filter((el) => el.offsetParent !== null);
        let count = 0;
        for (const el of fields) {
          if (el.tagName === 'TEXTAREA') {
            if (el.value && el.value.trim()) continue;
            el.value = pitch;
          } else {
            if ((el.innerText || '').trim()) continue;
            el.innerHTML = `<p>${pitch}</p>`;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          count++;
        }
        return count;
      }, this.getPitchNote(job.company));

      if (filled > 0) {
        logger.info(`Filled ${filled} application field(s).`);
        await randomDelay(1000, 1800);
      }

      // Click the submit/confirm button if a modal appeared
      const submitted = await page.evaluate(() => {
        const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const scope = document.querySelector('.modal, [role="dialog"], .popup') || document;
        const btn = Array.from(scope.querySelectorAll('button, a')).find((b) => {
          const t = norm(b.innerText || b.value);
          return t === 'submit' || t === 'apply' || t.includes('submit application') || t.includes('send application');
        });
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
      if (submitted) await randomDelay(2500, 4000);

      const isSuccess = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return (
          text.includes('applied successfully') ||
          text.includes('application submitted') ||
          text.includes('successfully applied') ||
          text.includes('application has been sent') ||
          Boolean(document.querySelector('.success-message, .apply-success'))
        );
      });

      if (isSuccess) {
        logger.success(`Successfully applied on Foundit: ${job.title}`);
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
      logger.error(`Foundit application failed for: ${job.title}`, err);
      this.storage.recordSkipped(job.jobId, job, `error: ${err.message}`);
      this.storage.recordManualApply(job, `error: ${err.message}`);
      return { status: 'FAILED', reason: err.message };
    }
  }
}

module.exports = new FounditService();
