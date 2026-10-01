const logger = require('../../utils/logger');
const guardrails = require('../../config/guardrails');
const searchCriteria = require('../../config/searchCriteria');
const profile = require('../../config/profile');
const storageService = require('../../services/storageService').getStorage('instahyre');
const { randomDelay, humanScroll, humanMouseMove } = require('../../utils/delay');

class InstahyreService {
  constructor() {
    this.storage = storageService;
    this.opportunitiesUrl = 'https://www.instahyre.com/candidate/opportunities/';
  }

  getPitchNote() {
    return `MCA graduate from Sardar Patel Institute of Technology (SPIT). Hands-on experience building GenAI platforms (RAG, pgvector) and scalable backend systems (Java, Spring Boot, PostgreSQL, Redis). Immediate joiner (0 days notice).`;
  }

  async verifySession(page) {
    logger.info('Verifying Instahyre session...');
    try {
      await page.goto(this.opportunitiesUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });

      await randomDelay(2000, 3000);
      const currentUrl = page.url();

      if (currentUrl.includes('/login') || currentUrl.includes('/signup')) {
        return false;
      }

      const title = await page.title();
      if (title.toLowerCase().includes('opportunities')) {
        return true;
      }

      return isAuthenticated;
    } catch (err) {
      logger.error('Instahyre session verification failed', err);
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

  async scrapeOpportunities(page) {
    logger.info('Scanning Instahyre opportunities feed...');
    try {
      await page.goto(this.opportunitiesUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });

      await randomDelay(2500, 4000);
      await humanScroll(page);

      const rawCards = await page.evaluate(() => {
        const cards = [];
        // Candidate opportunities list selectors on Instahyre
        const items = document.querySelectorAll(
          '.opportunity-card, .job-card, [ng-repeat*="opportunity"], [ng-repeat*="job"], .employer-row'
        );

        items.forEach((card, index) => {
          const titleEl = card.querySelector(
            '.position-title, .job-title, .designation, h4, h3, a[href*="/job-"]'
          );
          const companyEl = card.querySelector(
            '.employer-name, .company-name, .employer, .company, h5'
          );
          const locationEl = card.querySelector('.locations, .location, .loc');
          const id = card.getAttribute('data-id') || card.getAttribute('id') || `insta_${index}`;

          const title = (titleEl?.innerText || '').trim();
          const company = (companyEl?.innerText || '').trim();
          const location = (locationEl?.innerText || '').trim();

          // Check if button is Apply or Interested
          const buttons = Array.from(card.querySelectorAll('button, a.btn'));
          const actionBtn = buttons.find((btn) => {
            const txt = (btn.innerText || '').trim().toLowerCase();
            return (
              txt === 'apply' ||
              txt === 'interested' ||
              txt.includes('apply now') ||
              txt.includes('interested')
            );
          });

          const isAlreadyApplied = buttons.some((btn) => {
            const txt = (btn.innerText || '').trim().toLowerCase();
            return txt.includes('applied') || txt.includes('application sent');
          });

          if (title && actionBtn && !isAlreadyApplied) {
            actionBtn.setAttribute('data-instahyre-target', id);
            cards.push({
              jobId: id,
              title,
              company,
              location,
              buttonSelector: `[data-instahyre-target="${id}"]`,
            });
          }
        });

        return cards;
      });

      logger.info(`Found ${rawCards.length} open opportunities on Instahyre.`);

      const qualified = [];
      for (const card of rawCards) {
        if (this.storage.hasApplied(card.jobId)) {
          logger.skip('Already recorded as applied in database', `${card.title} at ${card.company}`);
          continue;
        }

        if (this.storage.hasSkipped(card.jobId)) {
          continue;
        }

        if (!this.isTitleRelevant(card.title)) {
          logger.skip('Filtered out by title rules', card.title);
          this.storage.recordSkipped(card.jobId, card, 'title_filter_mismatch');
          continue;
        }

        qualified.push(card);
      }

      logger.info(`Qualified ${qualified.length} opportunities matching your tech profile.`);
      return qualified;
    } catch (err) {
      logger.error('Error scraping Instahyre opportunities', err);
      return [];
    }
  }

  async applyToOpportunity(page, opp) {
    logger.info(`Applying on Instahyre: "${opp.title}" at ${opp.company}`);

    try {
      // 1. Click Apply / Interested button
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.click();
        }
      }, opp.buttonSelector);

      await randomDelay(2000, 3500);

      // 2. Check if a note / pitch modal opened
      const noteInputPresent = await page.evaluate((pitchText) => {
        const textarea = document.querySelector(
          'textarea[name*="note"], textarea[placeholder*="note"], textarea[placeholder*="fit"], textarea.pitch-text'
        );
        if (textarea) {
          textarea.value = pitchText;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      }, this.getPitchNote());

      if (noteInputPresent) {
        logger.info('Inserted personalized recruiter pitch note.');
        await randomDelay(1000, 1800);

        // Click confirm in modal
        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('.modal button, .popup button, button.btn-primary'));
          const confirmBtn = buttons.find((btn) => {
            const txt = (btn.innerText || '').trim().toLowerCase();
            return (
              txt.includes('send') ||
              txt.includes('submit') ||
              txt.includes('confirm') ||
              txt.includes('apply') ||
              txt.includes('interested')
            );
          });
          if (confirmBtn) confirmBtn.click();
        });

        await randomDelay(2000, 3000);
      }

      logger.success(`Successfully applied to: ${opp.title} at ${opp.company}`);
      this.storage.recordApplied(opp.jobId, opp);
      return { status: 'APPLIED' };
    } catch (err) {
      logger.error(`Failed to apply to ${opp.title}`, err);
      this.storage.recordSkipped(opp.jobId, opp, `error: ${err.message}`);
      return { status: 'FAILED', reason: err.message };
    }
  }
}

module.exports = new InstahyreService();
