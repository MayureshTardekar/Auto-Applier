const logger = require('../../utils/logger');
const guardrails = require('../../config/guardrails');
const searchCriteria = require('../../config/searchCriteria');
const storageService = require('../../services/storageService').getStorage('wellfound');
const { randomDelay, humanScroll, humanMouseMove } = require('../../utils/delay');

class WellfoundService {
  constructor() {
    this.storage = storageService;
    this.jobsUrl = 'https://wellfound.com/jobs';
  }

  getPitchNote(companyName = 'your team') {
    return `Hi, I am an MCA graduate from Sardar Patel Institute of Technology (SPIT) Mumbai with hands-on experience architecting GenAI systems (RAG, pgvector) and scalable backends (Java, Spring Boot, PostgreSQL, Redis). Immediate joiner (0 days notice). Excited to contribute to ${companyName}!`;
  }

  async verifySession(page) {
    logger.info('Verifying Wellfound session...');
    try {
      await page.goto(this.jobsUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      await randomDelay(2500, 3500);
      const currentUrl = page.url();

      if (currentUrl.includes('/login') || currentUrl.includes('/join')) {
        return false;
      }

      const isAuthenticated = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return (
          Boolean(
            document.querySelector('[data-test="user-menu"]') ||
            document.querySelector('a[href*="/profile"]') ||
            document.querySelector('.user-avatar')
          ) ||
          text.includes('saved jobs') ||
          text.includes('my applications') ||
          text.includes('profile')
        );
      });

      return isAuthenticated;
    } catch (err) {
      logger.error('Wellfound session verification failed', err);
      return false;
    }
  }

  isTitleRelevant(title) {
    const lower = title.toLowerCase();

    // 1. Blacklist check
    const isBad = searchCriteria.titleBlacklist.some((bad) => lower.includes(bad));
    if (isBad) return false;

    // 2. Whitelist check
    const isGood = searchCriteria.titleWhitelist.some((good) => lower.includes(good));
    return isGood;
  }

  async scrapeJobs(page) {
    logger.info('Scanning Wellfound jobs board...');
    try {
      await page.goto(this.jobsUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      await randomDelay(3000, 4500);
      await humanScroll(page);

      const rawJobs = await page.evaluate(() => {
        const jobs = [];
        // Wellfound listing cards and job rows
        const cards = document.querySelectorAll(
          '[data-test="JobListItem"], .styles_jobListing__container, [class*="JobListing"], [class*="styles_result"]'
        );

        cards.forEach((card, idx) => {
          const titleEl = card.querySelector('a[href*="/jobs/"], [data-test="job-title"], h2, h3, .title');
          const companyEl = card.querySelector('a[href*="/company/"], [data-test="startup-name"], h4, .company-name');
          const applyBtn = Array.from(card.querySelectorAll('button, a')).find((b) => {
            const txt = (b.innerText || '').trim().toLowerCase();
            return txt === 'apply' || txt.includes('quick apply');
          });

          const title = (titleEl?.innerText || '').trim();
          const company = (companyEl?.innerText || '').trim();
          const url = titleEl?.href || '';
          const id = url ? (url.match(/jobs\/(\d+)/)?.[1] || url) : `wf_${company}_${idx}`;

          if (title && applyBtn) {
            applyBtn.setAttribute('data-wf-target', id);
            jobs.push({
              jobId: id,
              title,
              company,
              url,
              buttonSelector: `[data-wf-target="${id}"]`,
            });
          }
        });

        // Fallback if specific cards not found: scan all direct Apply buttons
        if (jobs.length === 0) {
          const buttons = Array.from(document.querySelectorAll('button'));
          buttons.forEach((btn, idx) => {
            const txt = (btn.innerText || '').trim().toLowerCase();
            if (txt === 'apply' || txt.includes('quick apply')) {
              const row = btn.closest('div[class*="styles_job"], tr, li, div') || btn.parentElement;
              const text = (row?.innerText || '').split('\n').filter(Boolean);
              const title = text[0] || 'Software Engineer';
              const company = text[1] || 'Tech Startup';
              const id = `wf_btn_${idx}`;

              btn.setAttribute('data-wf-target', id);
              jobs.push({
                jobId: id,
                title,
                company,
                url: '',
                buttonSelector: `[data-wf-target="${id}"]`,
              });
            }
          });
        }

        return jobs;
      });

      logger.info(`Found ${rawJobs.length} active job listings on Wellfound.`);

      const qualified = [];
      for (const job of rawJobs) {
        if (this.storage.hasApplied(job.jobId)) {
          logger.skip('Already recorded as applied in database', `${job.title} at ${job.company}`);
          continue;
        }

        if (this.storage.hasSkipped(job.jobId)) {
          continue;
        }

        if (!this.isTitleRelevant(job.title)) {
          logger.skip('Filtered out by title rules', job.title);
          this.storage.recordSkipped(job.jobId, job, 'title_filter_mismatch');
          continue;
        }

        qualified.push(job);
      }

      logger.info(`Qualified ${qualified.length} Wellfound roles matching your profile.`);
      return qualified;
    } catch (err) {
      logger.error('Error scraping Wellfound listings', err);
      return [];
    }
  }

  async applyToJob(page, job) {
    logger.info(`Applying on Wellfound: "${job.title}" at ${job.company}`);

    try {
      // 1. Click the in-page Apply button
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.click();
        }
      }, job.buttonSelector);

      await randomDelay(2000, 3500);

      // 2. Check if pitch note modal opened
      const noteInputPresent = await page.evaluate((pitchText) => {
        const textarea = document.querySelector(
          'textarea[name*="note"], textarea[placeholder*="note"], textarea[placeholder*="message"], textarea'
        );
        if (textarea) {
          textarea.value = pitchText;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      }, this.getPitchNote(job.company));

      if (noteInputPresent) {
        logger.info('Inserted personalized recruiter pitch note.');
        await randomDelay(1200, 2000);

        // Click Send application / Submit button in modal
        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button[type="submit"], [class*="modal"] button, button'));
          const submitBtn = buttons.find((b) => {
            const txt = (b.innerText || '').trim().toLowerCase();
            return (
              txt.includes('send application') ||
              txt.includes('submit application') ||
              txt.includes('send') ||
              txt.includes('apply')
            );
          });
          if (submitBtn) submitBtn.click();
        });

        await randomDelay(2000, 3500);
      }

      logger.success(`Successfully applied on Wellfound: ${job.title} at ${job.company}`);
      this.storage.recordApplied(job.jobId, job);
      return { status: 'APPLIED' };
    } catch (err) {
      logger.error(`Failed to apply to ${job.title} on Wellfound`, err);
      this.storage.recordSkipped(job.jobId, job, `error: ${err.message}`);
      return { status: 'FAILED', reason: err.message };
    }
  }
}

module.exports = new WellfoundService();
