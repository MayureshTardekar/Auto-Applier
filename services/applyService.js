const logger = require('../utils/logger');
const guardrails = require('../config/guardrails');
const { randomDelay, humanScroll, humanMouseMove } = require('../utils/delay');
const questionnaireHandler = require('./questionnaireHandler');
const storageService = require('./storageService');

class ApplyService {
  /**
   * Applies to a specific job listing on Naukri.
   * @param {import('puppeteer').Page} page
   * @param {{ jobId: string, url: string, title: string, company: string }} job
   * @returns {Promise<{ status: 'APPLIED' | 'SKIPPED' | 'FAILED', reason?: string }>}
   */
  async apply(page, job) {
    logger.info(`Navigating to job: "${job.title}" at ${job.company || 'Unknown'}`);

    try {
      await page.goto(job.url, {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });

      await randomDelay(1800, 3000);
      await humanScroll(page);
      await humanMouseMove(page);

      // 1. Check if already applied on page
      const alreadyApplied = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return (
          text.includes('already applied') ||
          text.includes('you have applied to this job') ||
          Boolean(document.querySelector('.already-applied'))
        );
      });

      if (alreadyApplied) {
        logger.skip('Already applied according to page status', job.title);
        storageService.recordApplied(job.jobId, job);
        return { status: 'SKIPPED', reason: 'already_applied' };
      }

      // 2. Check if external redirect ("Apply on company site")
      const isExternal = await page.evaluate(() => {
        const externalButtons = Array.from(document.querySelectorAll('button, a'));
        return externalButtons.some((el) => {
          const text = (el.innerText || '').toLowerCase();
          return (
            text.includes('apply on company site') ||
            text.includes('company site') ||
            text.includes('apply on employer website')
          );
        });
      });

      if (isExternal) {
        logger.skip('External company site application required (skipping)', job.title);
        storageService.recordSkipped(job.jobId, job, 'external_site_redirect');
        return { status: 'SKIPPED', reason: 'external_site_redirect' };
      }

      // 3. Locate Naukri native Apply Button
      const applyBtnSelector = await page.evaluate(() => {
        const candidateSelectors = [
          '#apply-button',
          '.apply-button',
          'button.apply-button',
          '.applyBtn',
          'button[id*="apply"]',
        ];

        for (const selector of candidateSelectors) {
          const el = document.querySelector(selector);
          if (el && el.offsetParent !== null) return selector;
        }

        // Fallback by button text
        const buttons = Array.from(document.querySelectorAll('button, a.btn'));
        const matched = buttons.find((b) => {
          const t = (b.innerText || '').trim().toLowerCase();
          return t === 'apply' || t === 'apply on naukri' || t.startsWith('apply');
        });

        if (matched) {
          matched.setAttribute('data-bot-apply-target', 'true');
          return '[data-bot-apply-target="true"]';
        }

        return null;
      });

      if (!applyBtnSelector) {
        logger.warn(`No apply button located for: ${job.title}`);
        storageService.recordSkipped(job.jobId, job, 'no_apply_button_found');
        return { status: 'SKIPPED', reason: 'no_apply_button_found' };
      }

      // 4. Click the Apply button safely via DOM (avoids protocolTimeout hangs)
      logger.info('Clicking Apply button...');
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.click();
        }
      }, applyBtnSelector);
      await randomDelay(2000, 3500);

      // 5. Delegate to Questionnaire and Chatbot handler if modal appears
      const questionResult = await questionnaireHandler.handleQuestions(page);
      if (questionResult.handled && !questionResult.success) {
        logger.warn(`Failed questionnaire on: ${job.title}`, questionResult.reason);
        storageService.recordSkipped(job.jobId, job, questionResult.reason);
        return { status: 'SKIPPED', reason: questionResult.reason };
      }

      // 6. Confirm application success
      await randomDelay(2000, 3000);
      const isSuccess = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return (
          text.includes('applied successfully') ||
          text.includes('application submitted') ||
          text.includes('applied') ||
          Boolean(document.querySelector('.apply-message, .success-message'))
        );
      });

      if (isSuccess) {
        logger.success(`Successfully applied to: ${job.title} at ${job.company}`);
        storageService.recordApplied(job.jobId, job);
        return { status: 'APPLIED' };
      } else {
        logger.warn(`Application status unconfirmed for: ${job.title}`);
        storageService.recordSkipped(job.jobId, job, 'unconfirmed_submission');
        return { status: 'SKIPPED', reason: 'unconfirmed_submission' };
      }
    } catch (err) {
      logger.error(`Application failed for: ${job.title}`, err);
      storageService.recordSkipped(job.jobId, job, `error: ${err.message}`);
      return { status: 'FAILED', reason: err.message };
    }
  }
}

module.exports = new ApplyService();
