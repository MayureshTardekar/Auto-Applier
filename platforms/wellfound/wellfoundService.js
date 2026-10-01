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

      await randomDelay(2000, 3000);
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
        const seenUrls = new Set();
        const links = Array.from(document.querySelectorAll('a[href*="/jobs/"]'));

        links.forEach((a) => {
          const href = a.href;
          // Matches individual job detail pages like /jobs/3976865-full-stack-engineer...
          const match = href.match(/\/jobs\/(\d+)-?([a-z0-9-]+)?/i);
          if (match && !seenUrls.has(href)) {
            seenUrls.add(href);
            const jobId = match[1];
            const textLines = (a.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
            const title = textLines[0] || (match[2] ? match[2].replace(/-/g, ' ') : 'Software Engineer');

            // Find company name in parent card
            const card = a.closest('div[class*="styles_job"], div[class*="JobListing"], [data-test="JobListItem"]') || a.parentElement;
            const companyLink = card ? card.querySelector('a[href*="/company/"]') : null;
            const company = (companyLink?.innerText || '').split('\n')[0].trim() || 'Tech Startup';

            jobs.push({
              jobId,
              title,
              company,
              url: href,
            });
          }
        });

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
    logger.info(`Opening job: "${job.title}" at ${job.company}`);

    try {
      await page.goto(job.url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      await randomDelay(2500, 4000);
      await humanScroll(page);

      // 1. Check if already applied
      const alreadyApplied = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('you applied') || text.includes('applied on') || text.includes('application submitted');
      });

      if (alreadyApplied) {
        logger.skip('Already applied according to page status', job.title);
        this.storage.recordApplied(job.jobId, job);
        return { status: 'SKIPPED', reason: 'already_applied' };
      }

      // 2. Click Apply button on job page
      const applyBtnClicked = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, a'));
        const applyBtn = btns.find((b) => {
          const txt = (b.innerText || '').trim().toLowerCase();
          return txt === 'apply' || txt === 'apply now';
        });
        if (applyBtn) {
          applyBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          applyBtn.click();
          return true;
        }
        return false;
      });

      if (!applyBtnClicked) {
        logger.warn(`No Apply button found for ${job.title}`);
        this.storage.recordSkipped(job.jobId, job, 'no_apply_button');
        return { status: 'SKIPPED', reason: 'no_apply_button' };
      }

      await randomDelay(2500, 4000);

      // 3. Check if pitch note modal opened and fill it
      const noteInputPresent = await page.evaluate((pitchText) => {
        const textareas = Array.from(document.querySelectorAll('textarea'));
        if (textareas.length > 0) {
          textareas.forEach((t) => {
            t.value = pitchText;
            t.dispatchEvent(new Event('input', { bubbles: true }));
            t.dispatchEvent(new Event('change', { bubbles: true }));
          });
          return true;
        }
        return false;
      }, this.getPitchNote(job.company));

      if (noteInputPresent) {
        logger.info('Inserted personalized recruiter pitch note.');
        await randomDelay(1200, 2000);
      }

      // 4. Click Send application
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const submitBtn = buttons.find((b) => {
          const txt = (b.innerText || '').trim().toLowerCase();
          return (
            txt.includes('send application') ||
            txt.includes('submit application') ||
            txt === 'send'
          );
        });
        if (submitBtn) submitBtn.click();
      });

      await randomDelay(2500, 4000);

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
