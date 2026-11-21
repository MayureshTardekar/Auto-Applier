const logger = require('../../utils/logger');
const guardrails = require('../../config/guardrails');
const searchCriteria = require('../../config/searchCriteria');
const profile = require('../../config/profile');
const storage = require('../../services/storageService').getStorage('internshala');
const filters = require('../../utils/jobFilters');
const rotation = require('../../utils/rotation');
const { randomDelay, humanScroll, humanMouseMove } = require('../../utils/delay');

const PLATFORM = 'internshala';
const MAX_SEARCHES_PER_RUN = 10;

class InternshalaService {
  constructor() {
    this.platform = PLATFORM;
    this.storage = storage;
    this.baseUrl = 'https://internshala.com';
  }

  getPitchNote(company = 'your team') {
    return (
      'I am an MCA student at Sardar Patel Institute of Technology (SPIT), Mumbai with hands-on project experience ' +
      'in Java, Spring Boot, Python, FastAPI, Node.js, PostgreSQL and Redis, and GenAI applications using RAG, ' +
      `LLMs and vector search. I can start immediately and would love to contribute to ${company}.`
    );
  }

  async verifySession(page) {
    logger.info('Verifying Internshala session...');
    try {
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await randomDelay(2000, 3000);

      const currentUrl = page.url();
      if (/\/login|\/registration/i.test(currentUrl)) return false;

      return await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        if (text.includes('logout') || text.includes('my applications') || text.includes('my profile')) return true;
        return Boolean(
          document.querySelector('a[href*="/logout"]') ||
          document.querySelector('a[href*="/student/dashboard"]') ||
          document.querySelector('#profile_link, .profile_menu, [class*="user_menu"]')
        );
      });
    } catch (err) {
      logger.error('Internshala session verification failed', err);
      return false;
    }
  }

  buildSearchUrl(query, kind) {
    const slug = String(query)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return kind === 'job'
      ? `${this.baseUrl}/jobs/keywords-${slug}/`
      : `${this.baseUrl}/internships/keywords-${slug}/`;
  }

  async scrapeSearchPage(page, url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(2000, 3500);
    await humanScroll(page);

    return page.evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll('div.individual_internship, [id^="individual_internship_"]')
      );
      const seen = new Set();
      const out = [];

      nodes.forEach((card) => {
        const titleLink = card.querySelector('h2.job-internship-name a, a.job-title-href');
        if (!titleLink) return;

        const title = (titleLink.innerText || titleLink.textContent || '').replace(/\s+/g, ' ').trim();
        const href = card.getAttribute('data-href') || titleLink.getAttribute('href') || '';
        if (!title || !href) return;

        const absolute = href.startsWith('http') ? href : `${location.origin}${href}`;
        if (seen.has(absolute)) return;
        seen.add(absolute);

        const id =
          card.getAttribute('internshipId') ||
          (card.id || '').replace('individual_internship_', '') ||
          absolute;

        out.push({
          jobId: id,
          title,
          url: absolute,
          company: (card.querySelector('p.company-name, .company-name')?.innerText || '')
            .replace(/\s+/g, ' ')
            .trim(),
          location: (card.querySelector('.locations span')?.innerText || '')
            .replace(/\s+/g, ' ')
            .trim(),
          stipend: (card.querySelector('.stipend')?.innerText || '').replace(/\s+/g, ' ').trim(),
          posted: (card.querySelector('.status-success span')?.innerText || '')
            .replace(/\s+/g, ' ')
            .trim(),
          employmentType: card.getAttribute('employment_type') || '',
        });
      });

      return out;
    });
  }

  async scrapeJobs(page) {
    logger.info('Scanning Internshala internships and fresher jobs...');

    const allQueries = searchCriteria.queries;
    const startOffset = rotation.loadOffset(PLATFORM, allQueries.length);
    const queries = rotation.rotate(allQueries, startOffset);

    const qualified = [];
    const seen = new Set();
    let searches = 0;

    const searchQueue = [];
    for (const query of queries) {
      searchQueue.push({ query, kind: 'job' });
      searchQueue.push({ query, kind: 'internship' });
    }

    for (const { query, kind } of searchQueue) {
      if (qualified.length >= guardrails.maxCandidatesPerRun) break;
      if (searches >= MAX_SEARCHES_PER_RUN) break;

      searches++;
      const url = this.buildSearchUrl(query, kind);
      logger.info(`Internshala search (${kind}): "${query}" (${searches}/${MAX_SEARCHES_PER_RUN})`);

      const cards = await this.scrapeSearchPage(page, url);
      logger.info(`Found ${cards.length} ${kind} cards for "${query}".`);

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

        if (!filters.isLocationRelevant(card.location)) {
          logger.skip(`Location outside target list (${card.location})`, card.title);
          this.storage.recordSkipped(jobId, card, 'location_mismatch');
          continue;
        }

        if (filters.isStale(card.posted)) {
          logger.skip(`Stale listing (${card.posted})`, card.title);
          this.storage.recordSkipped(jobId, card, 'stale_listing');
          continue;
        }

        qualified.push({ ...card, jobId });
      }
    }

    rotation.saveOffset(PLATFORM, startOffset + Math.max(searches, 1), allQueries.length);

    logger.info(`Qualified ${qualified.length} Internshala roles matching your profile.`);
    return qualified;
  }

  async applyToJob(page, job) {
    logger.info(`Opening Internshala: "${job.title}" at ${job.company || 'Unknown'}`);

    try {
      await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await randomDelay(2000, 3500);
      await humanScroll(page);
      await humanMouseMove(page);

      const alreadyApplied = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('already applied') || text.includes('application submitted');
      });
      if (alreadyApplied) {
        logger.skip('Already applied according to page status', job.title);
        this.storage.recordApplied(job.jobId, job);
        return { status: 'SKIPPED', reason: 'already_applied' };
      }

      const state = await page.evaluate(() => {
        const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();

        const direct =
          document.querySelector('#apply_button, .apply_button, button.apply_button, a.apply_button') || null;

        let el = direct;
        if (!el) {
          el = Array.from(document.querySelectorAll('button, a')).find((b) => {
            const t = norm(b.innerText || b.value);
            return t === 'apply now' || t === 'apply' || t.includes('apply now');
          });
        }

        if (!el) return { found: false, loggedOut: norm(document.body.innerText).includes('continue with google') };
        el.setAttribute('data-bot-apply-target', 'true');
        return { found: true, selector: '[data-bot-apply-target="true"]' };
      });

      if (!state.found) {
        logger.warn(`No apply button found on Internshala: ${job.title}`);
        this.storage.recordSkipped(job.jobId, job, 'no_apply_button_found');
        this.storage.recordManualApply(job, 'no_apply_button_found');
        return { status: 'SKIPPED', reason: 'no_apply_button_found' };
      }

      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.click();
        }
      }, state.selector);
      await randomDelay(2500, 4000);

      // Fill the cover letter editor if the easy-apply modal opened
      const filled = await page.evaluate((pitch) => {
        const fields = Array.from(
          document.querySelectorAll(
            '#cover_letter, textarea[name*="cover"], textarea[placeholder*="cover"], .ql-editor[contenteditable="true"], [contenteditable="true"]'
          )
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

      // Answer simple Yes/No questions positively (availability, start date, etc.)
      const answered = await page.evaluate((yesPattern) => {
        const re = new RegExp(yesPattern, 'i');
        const radios = Array.from(document.querySelectorAll('input[type="radio"]')).filter(
          (r) => r.offsetParent !== null && !r.checked
        );
        let count = 0;

        const groups = new Map();
        for (const radio of radios) {
          const key = radio.name || radio.getAttribute('id') || String(count);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(radio);
        }

        for (const group of groups.values()) {
          if (group.some((r) => r.checked)) continue;
          const yes = group.find((r) => {
            const label =
              (r.value || '') +
              ' ' +
              (r.getAttribute('aria-label') || '') +
              ' ' +
              (r.closest('label')?.innerText || '') +
              ' ' +
              (r.parentElement?.innerText || '');
            return /^\s*yes\b/i.test(label.trim()) || re.test(label);
          });
          if (yes) {
            yes.click();
            count++;
          }
        }

        const agreement = Array.from(
          document.querySelectorAll('input[type="checkbox"]')
        ).filter(
          (c) =>
            c.offsetParent !== null &&
            !c.checked &&
            /agree|terms|confirm|declaration/i.test(
              (c.closest('label')?.innerText || '') + ' ' + (c.parentElement?.innerText || '')
            )
        );
        for (const box of agreement) {
          box.click();
          count++;
        }

        return count;
      }, profile.screeningAnswers.yesQuestionPattern);

      if (answered > 0) {
        logger.info(`Answered ${answered} application question(s).`);
        await randomDelay(800, 1500);
      }

      const submitted = await page.evaluate(() => {
        const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const scope = document.querySelector('.modal, .modal-content, #easy_apply_modal, [role="dialog"]') || document;
        const btn = Array.from(scope.querySelectorAll('button, a')).find((b) => {
          const t = norm(b.innerText || b.value);
          return (
            t === 'submit' ||
            t === 'submit application' ||
            t === 'apply' ||
            t === 'send application' ||
            t.includes('submit application')
          );
        });
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });

      if (!submitted) {
        logger.warn(`No submit button found for: ${job.title}`);
        this.storage.recordSkipped(job.jobId, job, 'no_submit_button');
        this.storage.recordManualApply(job, 'no_submit_button');
        return { status: 'SKIPPED', reason: 'no_submit_button' };
      }

      await randomDelay(2500, 4000);

      const isSuccess = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return (
          text.includes('application submitted') ||
          text.includes('successfully applied') ||
          text.includes('applied successfully') ||
          text.includes('application has been sent') ||
          text.includes('your application was sent') ||
          Boolean(document.querySelector('.success_message, .success-modal, .application-success'))
        );
      });

      if (isSuccess) {
        logger.success(`Successfully applied on Internshala: ${job.title}`);
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
      logger.error(`Internshala application failed for: ${job.title}`, err);
      this.storage.recordSkipped(job.jobId, job, `error: ${err.message}`);
      this.storage.recordManualApply(job, `error: ${err.message}`);
      return { status: 'FAILED', reason: err.message };
    }
  }
}

module.exports = new InternshalaService();
