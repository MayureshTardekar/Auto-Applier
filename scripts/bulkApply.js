const browserService = require('../services/browserService');
const searchService = require('../services/searchService');
const applyService = require('../services/applyService');
const storageService = require('../services/storageService');
const searchCriteria = require('../config/searchCriteria');
const guardrails = require('../config/guardrails');
const logger = require('../utils/logger');
const { randomDelay } = require('../utils/delay');

async function main() {
  logger.header('Naukri Automated Bulk Apply');

  // 1. Guardrail Pre-flight checks
  if (!browserService.hasSavedSession()) {
    logger.error('No saved session found in cookies.json.');
    logger.info('Please run "npm run login" first to authenticate.');
    process.exit(1);
  }

  const todayCount = storageService.getTodayApplicationCount();
  logger.info(`Applications submitted in past 24 hours: ${todayCount} / ${guardrails.maxAppliesPerDay}`);

  if (todayCount >= guardrails.maxAppliesPerDay) {
    logger.warn(`Daily limit reached (${todayCount} applications). Exiting to protect account reputation.`);
    process.exit(0);
  }

  const remainingDailyAllowance = guardrails.maxAppliesPerDay - todayCount;
  const maxSessionApplies = Math.min(guardrails.maxAppliesPerRun, remainingDailyAllowance);
  logger.info(`Session application quota set to: ${maxSessionApplies}`);

  // 2. Launch browser & load session
  const { browser, page } = await browserService.launch();

  // Setup graceful interrupt
  const cleanup = async () => {
    logger.info('Interrupt received. Gracefully closing browser...');
    await browserService.close();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  let sessionAppliedCount = 0;
  let sessionSkippedCount = 0;

  try {
    await browserService.loadCookies();

    const isAuthenticated = await browserService.verifySession(page);
    if (!isAuthenticated) {
      logger.error('Session expired or authentication invalid.');
      logger.info('Please run "npm run login" again to refresh session cookies.');
      await browserService.close();
      process.exit(1);
    }

    logger.success('Naukri session successfully authenticated.');

    // 3. Loop through search queries and locations
    outerLoop:
    for (const query of searchCriteria.queries) {
      for (const location of searchCriteria.locations) {
        if (sessionAppliedCount >= maxSessionApplies) {
          logger.info(`Reached session application limit (${maxSessionApplies}).`);
          break outerLoop;
        }

        logger.header(`Search: ${query} in ${location}`);

        for (let pageNum = 1; pageNum <= guardrails.maxPagesPerQuery; pageNum++) {
          if (sessionAppliedCount >= maxSessionApplies) break outerLoop;

          const activePage = await browserService.getActivePage();
          const candidateJobs = await searchService.scrapeJobsOnPage(activePage, query, location, pageNum);

          if (candidateJobs.length === 0) {
            logger.info(`No candidate jobs on page ${pageNum}, moving to next filter.`);
            break;
          }

          for (const job of candidateJobs) {
            if (sessionAppliedCount >= maxSessionApplies) {
              logger.info(`Reached target applications limit (${maxSessionApplies}).`);
              break outerLoop;
            }

            const currentActivePage = await browserService.getActivePage();
            const result = await applyService.apply(currentActivePage, job);

            if (result.status === 'APPLIED') {
              sessionAppliedCount++;
              logger.info(`Applications this session: ${sessionAppliedCount} / ${maxSessionApplies}`);

              // Safe human-like delay between applications
              const delay = Math.floor(
                Math.random() * (guardrails.interApplyDelayMaxMs - guardrails.interApplyDelayMinMs + 1)
              ) + guardrails.interApplyDelayMinMs;

              logger.info(`Pacing delay: waiting ${(delay / 1000).toFixed(1)}s before next application...`);
              await randomDelay(delay, delay);
            } else {
              sessionSkippedCount++;
              await randomDelay(3000, 6000);
            }
          }

          // Delay before next pagination page
          await randomDelay(guardrails.paginationDelayMinMs, guardrails.paginationDelayMaxMs);
        }
      }
    }

    // 4. Summary Report
    logger.header('Execution Completed');
    logger.success(`Applications submitted this session: ${sessionAppliedCount}`);
    logger.info(`Jobs skipped this session: ${sessionSkippedCount}`);
    logger.info(`Total past 24h applied count: ${storageService.getTodayApplicationCount()} / ${guardrails.maxAppliesPerDay}`);
  } catch (err) {
    logger.error('Unexpected error during automation run', err);
  } finally {
    await browserService.close();
    process.exit(0);
  }
}

main();
