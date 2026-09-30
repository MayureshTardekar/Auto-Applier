const logger = require('../utils/logger');
const guardrails = require('../config/guardrails');
const searchCriteria = require('../config/searchCriteria');
const storageService = require('./storageService');
const { randomDelay, humanScroll } = require('../utils/delay');

class SearchService {
  buildSearchUrl(query, location = '', pageNum = 1) {
    const slug = query.trim().replace(/\s+/g, '-').toLowerCase();
    const encodedQuery = encodeURIComponent(query);
    let url = `https://www.naukri.com/${slug}-jobs-${pageNum}?k=${encodedQuery}&experience=0`;

    if (location) {
      url += `&l=${encodeURIComponent(location)}`;
    }

    url += `&nignbevent_src=jobsearchDeskGNB`;
    return url;
  }

  isTitleRelevant(title) {
    const lower = title.toLowerCase();

    // 1. Blacklist check
    const hasBlacklistedToken = searchCriteria.titleBlacklist.some((bad) => lower.includes(bad));
    if (hasBlacklistedToken) return false;

    // 2. Whitelist check
    const hasWhitelistedToken = searchCriteria.titleWhitelist.some((good) => lower.includes(good));
    return hasWhitelistedToken;
  }

  async scrapeJobsOnPage(page, query, location, pageNum) {
    const url = this.buildSearchUrl(query, location, pageNum);
    logger.info(`Searching: "${query}" in "${location || 'All'}" (Page ${pageNum})`);

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

          if (titleEl && titleEl.href) {
            cards.push({
              title: (titleEl.innerText || titleEl.textContent || '').trim(),
              url: titleEl.href,
              company: (companyEl?.innerText || '').trim(),
              location: (locEl?.innerText || '').trim(),
              experience: (expEl?.innerText || '').trim(),
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
      logger.error(`Error scraping search page ${pageNum} for "${query}"`, err);
      return [];
    }
  }
}

module.exports = new SearchService();
