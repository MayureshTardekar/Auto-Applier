const logger = require('../utils/logger');
const guardrails = require('../config/guardrails');
const searchCriteria = require('../config/searchCriteria');
const storageService = require('./storageService');
const browserService = require('./browserService');
const { randomDelay, humanScroll } = require('../utils/delay');

class SearchService {
  buildSearchUrl(query, location = '', pageNum = 1) {
    const slug = query.trim().replace(/\s+/g, '-').toLowerCase();
    const encodedQuery = encodeURIComponent(query);
    let url = `https://www.naukri.com/${slug}-jobs-${pageNum}?k=${encodedQuery}&experience=0&jobAge=${searchCriteria.freshnessDays}`;

    if (location) {
      url += `&l=${encodeURIComponent(location)}`;
    }

    url += `&nignbevent_src=jobsearchDeskGNB`;
    return url;
  }

  escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Token match that respects word boundaries, so short tokens like "hr" or
   * "bi" do not match inside words such as "Thrive" or "Mobile".
   */
  hasToken(text, token) {
    const escaped = this.escapeRegex(String(token).trim());
    if (!escaped) return false;
    const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i');
    return re.test(text);
  }

  isTitleRelevant(title) {
    const lower = String(title || '').toLowerCase();

    // 1. Blacklist check (word-boundary aware)
    if (searchCriteria.titleBlacklist.some((bad) => this.hasToken(lower, bad))) return false;

    // 2. Whitelist check
    return searchCriteria.titleWhitelist.some((good) => this.hasToken(lower, good));
  }

  isCompanyBlacklisted(company) {
    const lower = String(company || '').toLowerCase();
    if (!lower) return false;
    return (searchCriteria.companyBlacklist || []).some((bad) => lower.includes(bad));
  }

  /**
   * Returns the minimum years required by an experience string such as
   * "0-1 Yrs", "2-5 Yrs", "Fresher". null = unknown (do not filter).
   */
  parseMinExperienceYears(text) {
    const lower = String(text || '').toLowerCase();
    if (!lower.trim() || lower.includes('fresher')) return 0;
    const nums = lower.match(/\d+(?:\.\d+)?/g);
    if (!nums) return null;
    return Math.min(...nums.map(Number));
  }

  /** Converts a posting-age string ("3 days ago", "2 weeks ago") to days. */
  parsePostedDaysAgo(text) {
    const lower = String(text || '').toLowerCase();
    if (!lower.trim()) return null;
    if (lower.includes('today') || lower.includes('just now') || /\b\d+\s*hour/.test(lower)) return 0;
    const day = lower.match(/(\d+)\s*day/);
    if (day) return Number(day[1]);
    const week = lower.match(/(\d+)\s*week/);
    if (week) return Number(week[1]) * 7;
    const month = lower.match(/(\d+)\s*month/);
    if (month) return Number(month[1]) * 30;
    return null;
  }

  async scrapeJobsOnPage(page, query, location, pageNum) {
    const url = this.buildSearchUrl(query, location, pageNum);
    logger.info(`Searching: "${query}" in "${location || 'All'}" (Page ${pageNum})`);

    // Self-healing: ensure page is healthy and not detached
    page = await browserService.getActivePage().catch(() => page);

    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });

      await randomDelay(2000, 3500);
      await humanScroll(page);

      // Scrape raw cards
      const rawCards = await page.evaluate(() => {
        const cards = [];
        // Naukri listing selectors (articles and modern card wrappers)
        const articles = document.querySelectorAll('article.jobTuple, .srp-jobtuple-wrapper, .cust-job-tuple');

        articles.forEach((card) => {
          const titleEl = card.querySelector('a.title, .title');
          const companyEl = card.querySelector('a.comp-name, .comp-name, .org');
          const locEl = card.querySelector('.loc-wrap, .loc, .location');
          const expEl = card.querySelector('.exp-wrap, .exp');
          const postedEl = card.querySelector('.job-post-day, .job-postdate, .posted-date, [class*="postDay"]');

          if (titleEl && titleEl.href) {
            cards.push({
              title: (titleEl.innerText || titleEl.textContent || '').trim(),
              url: titleEl.href,
              company: (companyEl?.innerText || '').trim(),
              location: (locEl?.innerText || '').trim(),
              experience: (expEl?.innerText || '').trim(),
              posted: (postedEl?.innerText || '').trim(),
            });
          }
        });

        // Fallback if structured wrappers not matched
        if (cards.length === 0) {
          const linkList = document.querySelectorAll('a.title');
          linkList.forEach((a) => {
            if (a.href) {
              cards.push({
                title: (a.innerText || a.textContent || '').trim(),
                url: a.href,
                company: '',
                location: '',
                experience: '',
              });
            }
          });
        }

        return cards;
      });

      logger.info(`Found ${rawCards.length} raw job cards on page ${pageNum}`);

      // Filter and deduplicate
      const candidateJobs = [];

      for (const card of rawCards) {
        const jobId = storageService.extractJobId(card.url);
        if (!jobId) continue;

        if (storageService.hasApplied(jobId)) {
          logger.skip('Already recorded as applied in database', card.title);
          continue;
        }

        if (storageService.hasSkipped(jobId)) {
          continue;
        }

        if (!this.isTitleRelevant(card.title)) {
          logger.skip('Title filtered out by keyword rules', card.title);
          storageService.recordSkipped(jobId, card, 'title_filter_mismatch');
          continue;
        }

        if (this.isCompanyBlacklisted(card.company)) {
          logger.skip('Company blacklisted (staffing/consultancy)', `${card.title} @ ${card.company}`);
          storageService.recordSkipped(jobId, card, 'company_blacklisted');
          continue;
        }

        // Skip jobs that require more experience than configured
        const minExp = this.parseMinExperienceYears(card.experience);
        if (minExp !== null && minExp > searchCriteria.maxExperienceYears) {
          logger.skip(`Requires ${minExp}+ yrs experience`, card.title);
          storageService.recordSkipped(jobId, card, 'experience_too_high');
          continue;
        }

        // Skip stale listings if a posting age is available on the card
        const postedDays = this.parsePostedDaysAgo(card.posted);
        if (postedDays !== null && postedDays > searchCriteria.freshnessDays) {
          logger.skip(`Stale listing (${postedDays} days old)`, card.title);
          storageService.recordSkipped(jobId, card, 'stale_listing');
          continue;
        }

        candidateJobs.push({
          jobId,
          title: card.title,
          url: card.url,
          company: card.company,
          location: card.location,
          experience: card.experience,
        });
      }

      logger.info(`Qualified ${candidateJobs.length} fresh jobs matching filters.`);
      return candidateJobs;
    } catch (err) {
      if (err.message.includes('detached Frame') || err.message.includes('Target closed') || err.message.includes('Session closed')) {
        logger.warn(`Detached frame or closed target detected during search for "${query}". Recovering active page...`);
        await browserService.getActivePage().catch(() => {});
      }
      logger.error(`Error scraping search page ${pageNum} for "${query}"`, err);
      return [];
    }
  }
}

module.exports = new SearchService();
