const path = require('path');
const browserService = require('../services/browserService');
const instahyreService = require('../platforms/instahyre/instahyreService');
const guardrails = require('../config/guardrails');
const logger = require('../utils/logger');
const { randomDelay } = require('../utils/delay');

const COOKIES_PATH = path.resolve(__dirname, '..', 'cookies_instahyre.json');

async function main() {
  logger.header('Instahyre Automated Opportunities Apply');

  if (!browserService.hasSavedSession(COOKIES_PATH)) {
    logger.error('No saved session found in cookies_instahyre.json.');
    logger.info('Please run "npm run login:instahyre" or paste exported cookies into cookies_instahyre.json');
    process.exit(1);
  }

  const todayCount = instahyreService.storage.getTodayApplicationCount();
  logger.info(`Instahyre applications submitted in past 24 hours: ${todayCount} / ${guardrails.maxAppliesPerDay}`);

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

    const isAuthenticated = await instahyreService.verifySession(page);
    if (!isAuthenticated) {
      logger.error('Instahyre session invalid or expired.');
      logger.info('Please run "npm run login:instahyre" to refresh cookies.');
      await browserService.close();
      process.exit(1);
    }

    logger.success('Instahyre session successfully authenticated!');

    // Fetch matching opportunities
    const opportunities = await instahyreService.scrapeOpportunities(page);

    if (opportunities.length === 0) {
      logger.info('No new open opportunities available on your Instahyre feed right now.');
      await browserService.close();
      process.exit(0);
    }

    for (const opp of opportunities) {
      if (appliedCount >= maxSessionApplies) {
        logger.info(`Reached session application limit (${maxSessionApplies}).`);
        break;
      }

      const result = await instahyreService.applyToOpportunity(page, opp);

      if (result.status === 'APPLIED') {
        appliedCount++;
        logger.info(`Applications this session: ${appliedCount} / ${maxSessionApplies}`);

        const delay = Math.floor(
          Math.random() * (guardrails.interApplyDelayMaxMs - guardrails.interApplyDelayMinMs + 1)
        ) + guardrails.interApplyDelayMinMs;

        logger.info(`Pacing delay: waiting ${(delay / 1000).toFixed(1)}s before next opportunity...`);
        await randomDelay(delay, delay);
      } else {
        skippedCount++;
        await randomDelay(2000, 4000);
      }
    }

    logger.header('Instahyre Execution Completed');
    logger.success(`Applications submitted this session: ${appliedCount}`);
    logger.info(`Opportunities skipped/deferred: ${skippedCount}`);
    logger.info(`Total past 24h Instahyre count: ${instahyreService.storage.getTodayApplicationCount()}`);
  } catch (err) {
    logger.error('Unexpected error during Instahyre automation run', err);
  } finally {
    await browserService.close();
    process.exit(0);
  }
}

main();
