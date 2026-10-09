const logger = require('../utils/logger');
const guardrails = require('../config/guardrails');
const { randomDelay, humanScroll, humanMouseMove } = require('../utils/delay');
const questionnaireHandler = require('./questionnaireHandler');
const storageService = require('./storageService');
const browserService = require('./browserService');

class ApplyService {
  /**
   * Applies to a specific job listing on Naukri.
   * @param {import('puppeteer').Page} page
   * @param {{ jobId: string, url: string, title: string, company: string }} job
   * @returns {Promise<{ status: 'APPLIED' | 'SKIPPED' | 'FAILED', reason?: string }>}
   */
  async apply(page, job) {
    logger.info(`Navigating to job: "${job.title}" at ${job.company || 'Unknown'}`);

    // Self-healing: ensure page is healthy and not detached
    page = await browserService.getActivePage().catch(() => page);

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

      // 2. Locate Naukri Apply Button & check if native vs external
      const applyBtnState = await page.evaluate(() => {
        const candidateSelectors = [
          '#apply-button',
          '.apply-button',
          'button.apply-button',
          '.applyBtn',
          'button[id*="apply"]',
        ];

        let el = null;
        for (const selector of candidateSelectors) {
          const found = document.querySelector(selector);
          if (found && found.offsetParent !== null) {
            el = found;
            break;
          }
        }

        // Fallback: look for button or prominent link specifically labelled with Apply
        if (!el) {
          const candidates = Array.from(document.querySelectorAll('button, a.btn, [role="button"]'));
          el = candidates.find((b) => {
            const t = (b.innerText || b.value || '').trim().toLowerCase();
            return (
              (t === 'apply' || t === 'apply on naukri' || t.startsWith('apply on ') || t.startsWith('apply now')) &&
              b.offsetParent !== null
            );
          });
        }

        if (!el) return { found: false };

        const text = (el.innerText || el.value || el.textContent || '').trim().toLowerCase();
        // Check if the apply action itself is an external redirect
        const isExternal =
          text.includes('apply on company site') ||
          text.includes('apply on employer website') ||
          text.includes('company site') ||
          text.includes('employer site');

        if (isExternal) return { found: true, isExternal: true };

        el.setAttribute('data-bot-apply-target', 'true');
        return { found: true, isExternal: false, selector: '[data-bot-apply-target="true"]' };
      });

      if (!applyBtnState.found) {
        logger.warn(`No apply button located for: ${job.title}`);
        storageService.recordSkipped(job.jobId, job, 'no_apply_button_found');
        return { status: 'SKIPPED', reason: 'no_apply_button_found' };
      }

      if (applyBtnState.isExternal) {
        logger.skip('External company site application required (skipping)', job.title);
        storageService.recordSkipped(job.jobId, job, 'external_site_redirect');
        return { status: 'SKIPPED', reason: 'external_site_redirect' };
      }

      // 3. Click the Apply button safely via DOM (avoids protocolTimeout hangs)
      logger.info('Clicking Apply button...');
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.click();
        }
      }, applyBtnState.selector);
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
      if (err.message.includes('detached Frame') || err.message.includes('Target closed') || err.message.includes('Session closed')) {
        logger.warn(`Detached frame or closed target detected during "${job.title}". Recovering active page...`);
        await browserService.getActivePage().catch(() => {});
      }
      logger.error(`Application failed for: ${job.title}`, err);
      storageService.recordSkipped(job.jobId, job, `error: ${err.message}`);
      return { status: 'FAILED', reason: err.message };
    }
  }
}

module.exports = new ApplyService();
