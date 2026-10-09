const path = require('path');
const browserService = require('../services/browserService');
const indeedService = require('../platforms/indeed/indeedService');
const searchCriteria = require('../config/searchCriteria');
const guardrails = require('../config/guardrails');
const logger = require('../utils/logger');
const { randomDelay } = require('../utils/delay');

const COOKIES_PATH = path.resolve(__dirname, '..', 'cookies_indeed.json');

async function main() {
  logger.header('Indeed Automated Easily Apply');

  if (!browserService.hasSavedSession(COOKIES_PATH)) {
    logger.error('No saved session found in cookies_indeed.json.');
    logger.info('Run "npm run login:indeed" or paste Cookie-Editor JSON into cookies_indeed.json');
    process.exit(1);
  }

  const todayCount = indeedService.storage.getTodayApplicationCount();
  logger.info(`Indeed applications in past 24 hours: ${todayCount} / ${guardrails.maxAppliesPerDay}`);
  if (todayCount >= guardrails.maxAppliesPerDay) {
    logger.warn('Daily limit reached. Exiting to protect account reputation.');
    process.exit(0);
  }

  const maxSessionApplies = Math.min(guardrails.maxAppliesPerRun, guardrails.maxAppliesPerDay - todayCount);
  logger.info(`Session application quota: ${maxSessionApplies}`);

  const { page } = await browserService.launch();

  const cleanup = async () => {
    logger.info('Interrupt received. Closing browser...');
    await browserService.close();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  let appliedCount = 0;
  let skippedCount = 0;
  const locations = [...new Set(searchCriteria.locations)];

  try {
    await browserService.loadCookies(COOKIES_PATH);

    if (!(await indeedService.verifySession(page))) {
      logger.error('Indeed session invalid or expired. Run "npm run login:indeed".');
      await browserService.close();
      process.exit(1);
    }
    logger.success('Indeed session authenticated.');

    outer:
    for (const query of searchCriteria.queries) {
      for (const location of locations) {
        for (let pageIndex = 0; pageIndex < guardrails.maxPagesPerQuery; pageIndex++) {
          if (appliedCount >= maxSessionApplies) break outer;

          const activePage = await browserService.getActivePage();
          const jobs = await indeedService.scrapeJobs(activePage, query, location, pageIndex);
          if (jobs.length === 0) break;

          for (const job of jobs) {
            if (appliedCount >= maxSessionApplies) break outer;

            const currentActivePage = await browserService.getActivePage();
            const result = await indeedService.applyToJob(currentActivePage, job);
            if (result.status === 'APPLIED') {
              appliedCount++;
              logger.info(`Applications this session: ${appliedCount} / ${maxSessionApplies}`);
              await randomDelay(guardrails.interApplyDelayMinMs, guardrails.interApplyDelayMaxMs);
            } else {
              skippedCount++;
              await randomDelay(3000, 6000);
            }
          }

          await randomDelay(guardrails.paginationDelayMinMs, guardrails.paginationDelayMaxMs);
        }
      }
    }

    logger.header('Indeed Execution Completed');
    logger.success(`Applications submitted this session: ${appliedCount}`);
    logger.info(`Jobs skipped this session: ${skippedCount}`);
    logger.info(`Total past 24h Indeed count: ${indeedService.storage.getTodayApplicationCount()}`);
  } catch (err) {
    logger.error('Unexpected error during Indeed run', err);
  } finally {
    await browserService.close();
    process.exit(0);
  }
}

main();
