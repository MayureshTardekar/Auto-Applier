const browserService = require('../../services/browserService');
const guardrails = require('../../config/guardrails');
const logger = require('../../utils/logger');
const { randomDelay } = require('../../utils/delay');

/**
 * Shared apply runner for the newer platforms (Foundit, Internshala, TimesJobs).
 * Handles cookies, session check, caps, pacing, and summary.
 *
 * @param {object} opts
 * @param {string} opts.displayName  Human name shown in logs
 * @param {string} opts.cookieFile   e.g. "cookies_timesjobs.json"
 * @param {string} opts.loginCommand e.g. "npm run login:timesjobs"
 * @param {object} opts.service      Platform service instance
 */
async function runPlatform({ displayName, cookieFile, loginCommand, service }) {
  const path = require('path');
  const cookiesPath = path.resolve(__dirname, '..', '..', cookieFile);

  logger.header(`${displayName} Automated Apply`);

  if (!browserService.hasSavedSession(cookiesPath)) {
    logger.error(`No saved session found in ${cookieFile}.`);
    logger.info(`Please run "${loginCommand}" or paste exported cookies into ${cookieFile}`);
    process.exit(1);
  }

  const todayCount = service.storage.getTodayApplicationCount();
  logger.info(`${displayName} applications submitted in past 24 hours: ${todayCount} / ${guardrails.maxAppliesPerDay}`);

  if (todayCount >= guardrails.maxAppliesPerDay) {
    logger.warn(`Daily limit reached (${todayCount}). Exiting to protect account reputation.`);
    process.exit(0);
  }

  const maxSessionApplies = Math.min(guardrails.maxAppliesPerRun, guardrails.maxAppliesPerDay - todayCount);
  logger.info(`Session application quota set to: ${maxSessionApplies}`);

  await browserService.launch();

  const cleanup = async () => {
    logger.info('Interrupt received. Gracefully closing browser...');
    await browserService.close();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  let appliedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  try {
    await browserService.loadCookies(cookiesPath);

    const isAuthenticated = await service.verifySession(await browserService.getActivePage());
    if (!isAuthenticated) {
      logger.error(`${displayName} session invalid or expired (or blocked by the site).`);
      logger.info(`Please run "${loginCommand}" to refresh cookies.`);
      await browserService.close();
      process.exit(1);
    }

    logger.success(`${displayName} session successfully authenticated!`);

    const page = await browserService.getActivePage();

    const startedAt = Date.now();
    const maxRunMs = guardrails.maxRunMinutes * 60 * 1000;

    const jobs = await service.scrapeJobs(page);

    if (!jobs.length) {
      logger.info(`No new jobs matching filters on ${displayName} right now.`);
      await browserService.close();
      process.exit(0);
    }

    for (const job of jobs) {
      if (appliedCount >= maxSessionApplies) {
        logger.info(`Reached session application limit (${maxSessionApplies}).`);
        break;
      }
      if (skippedCount >= guardrails.maxSkipsPerRun) {
        logger.warn(`Skip limit reached (${guardrails.maxSkipsPerRun}). Stopping this run.`);
        break;
      }
      if (Date.now() - startedAt >= maxRunMs) {
        logger.warn(`Time budget reached (${guardrails.maxRunMinutes} min). Stopping this run.`);
        break;
      }

      const result = await service.applyToJob(await browserService.getActivePage(), job);

      if (result.status === 'APPLIED') {
        appliedCount++;
        logger.info(`Applications this session: ${appliedCount} / ${maxSessionApplies}`);

        const delay = Math.floor(
          Math.random() * (guardrails.interApplyDelayMaxMs - guardrails.interApplyDelayMinMs + 1)
        ) + guardrails.interApplyDelayMinMs;

        logger.info(`Pacing delay: waiting ${(delay / 1000).toFixed(1)}s before next application...`);
        await randomDelay(delay, delay);
      } else {
        if (result.status === 'FAILED') failedCount++;
        else skippedCount++;
        await randomDelay(2500, 4500);
      }
    }

    logger.header(`${displayName} Execution Completed`);
    logger.success(`Applications submitted this session: ${appliedCount}`);
    logger.info(`Jobs skipped/deferred: ${skippedCount} | failed: ${failedCount}`);
    logger.info(`Total past 24h ${displayName} count: ${service.storage.getTodayApplicationCount()}`);
    logger.info(`Manual-apply queue: data/manual_apply_${service.platform}.txt`);
  } catch (err) {
    logger.error(`Unexpected error during ${displayName} automation run`, err);
  } finally {
    await browserService.close();
    process.exit(0);
  }
}

module.exports = { runPlatform };
