const path = require('path');
const browserService = require('../services/browserService');
const wellfoundService = require('../platforms/wellfound/wellfoundService');
const guardrails = require('../config/guardrails');
const logger = require('../utils/logger');
const { randomDelay } = require('../utils/delay');

const COOKIES_PATH = path.resolve(__dirname, '..', 'cookies_wellfound.json');

async function main() {
  logger.header('Wellfound Automated Bulk Apply');

  if (!browserService.hasSavedSession(COOKIES_PATH)) {
    logger.error('No saved session found in cookies_wellfound.json.');
    logger.info('Please run "npm run login:wellfound" or paste exported cookies into cookies_wellfound.json');
    process.exit(1);
  }

  const todayCount = wellfoundService.storage.getTodayApplicationCount();
  logger.info(`Wellfound applications submitted in past 24 hours: ${todayCount} / ${guardrails.maxAppliesPerDay}`);

  if (todayCount >= guardrails.maxAppliesPerDay) {
    logger.warn(`Daily limit reached (${todayCount}). Exiting to protect account reputation.`);
    process.exit(0);
  }

  const maxSessionApplies = Math.min(guardrails.maxAppliesPerRun, guardrails.maxAppliesPerDay - todayCount);
  logger.info(`Session application quota set to: ${maxSessionApplies}`);

  const { browser, page } = await browserService.launch();

  // Setup graceful interrupt
  const cleanup = async () => {
    logger.info('Interrupt received. Gracefully closing browser...');
    await browserService.close();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  let appliedCount = 0;
  let skippedCount = 0;

  try {
    await browserService.loadCookies(COOKIES_PATH);

    const isAuthenticated = await wellfoundService.verifySession(page);
    if (!isAuthenticated) {
      logger.error('Wellfound session invalid or expired.');
      logger.info('Please run "npm run login:wellfound" to refresh cookies.');
      await browserService.close();
      process.exit(1);
    }

    logger.success('Wellfound session successfully authenticated!');

    // Fetch matching jobs
    const jobs = await wellfoundService.scrapeJobs(page);

    if (jobs.length === 0) {
      logger.info('No new open jobs matching filters on Wellfound right now.');
      await browserService.close();
      process.exit(0);
    }

    for (const job of jobs) {
      if (appliedCount >= maxSessionApplies) {
        logger.info(`Reached session application limit (${maxSessionApplies}).`);
        break;
      }

      const result = await wellfoundService.applyToJob(page, job);

      if (result.status === 'APPLIED') {
        appliedCount++;
        logger.info(`Applications this session: ${appliedCount} / ${maxSessionApplies}`);

        const delay = Math.floor(
          Math.random() * (guardrails.interApplyDelayMaxMs - guardrails.interApplyDelayMinMs + 1)
        ) + guardrails.interApplyDelayMinMs;

        logger.info(`Pacing delay: waiting ${(delay / 1000).toFixed(1)}s before next application...`);
        await randomDelay(delay, delay);
      } else {
        skippedCount++;
        await randomDelay(2500, 4500);
      }
    }

    logger.header('Wellfound Execution Completed');
    logger.success(`Applications submitted this session: ${appliedCount}`);
    logger.info(`Roles skipped/deferred: ${skippedCount}`);
    logger.info(`Total past 24h Wellfound count: ${wellfoundService.storage.getTodayApplicationCount()}`);
  } catch (err) {
    logger.error('Unexpected error during Wellfound automation run', err);
  } finally {
    await browserService.close();
    process.exit(0);
  }
}

main();
