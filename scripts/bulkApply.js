const fs = require('fs');
const path = require('path');
const browserService = require('../services/browserService');
const searchService = require('../services/searchService');
const applyService = require('../services/applyService');
const storageService = require('../services/storageService');
const searchCriteria = require('../config/searchCriteria');
const guardrails = require('../config/guardrails');
const logger = require('../utils/logger');
const { randomDelay } = require('../utils/delay');

const ROTATION_FILE = path.resolve(__dirname, '..', 'data', 'rotation_naukri.json');

function loadQueryOffset(total) {
  try {
    const raw = JSON.parse(fs.readFileSync(ROTATION_FILE, 'utf8'));
    const offset = Number(raw.queryOffset) || 0;
    return ((offset % total) + total) % total;
  } catch {
    return 0;
  }
}

function saveQueryOffset(offset, total) {
  try {
    fs.mkdirSync(path.dirname(ROTATION_FILE), { recursive: true });
    const next = ((offset % total) + total) % total;
    fs.writeFileSync(
      ROTATION_FILE,
      JSON.stringify({ queryOffset: next, updatedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
  } catch (err) {
    logger.error('Failed to save query rotation state', err);
  }
}

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
  logger.info(`Per-query cap: ${guardrails.maxAppliesPerQuery} | Skip cap: ${guardrails.maxSkipsPerRun} | Time budget: ${guardrails.maxRunMinutes} min`);

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

  const startedAt = Date.now();
  const maxRunMs = guardrails.maxRunMinutes * 60 * 1000;
  const timeExceeded = () => Date.now() - startedAt >= maxRunMs;

  let stopReason = '';
  const shouldStop = () => {
    if (!stopReason && sessionAppliedCount >= maxSessionApplies) {
      stopReason = `session application limit (${maxSessionApplies})`;
    } else if (!stopReason && sessionSkippedCount >= guardrails.maxSkipsPerRun) {
      stopReason = `skip limit (${guardrails.maxSkipsPerRun})`;
    } else if (!stopReason && timeExceeded()) {
      stopReason = `time budget (${guardrails.maxRunMinutes} min)`;
    }
    return Boolean(stopReason);
  };

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

    // 3. Rotate the starting query each run so the whole keyword spectrum gets covered
    const allQueries = searchCriteria.queries;
    const startOffset = loadQueryOffset(allQueries.length);
    const queries = allQueries.map((_, i) => allQueries[(startOffset + i) % allQueries.length]);
    if (startOffset > 0) {
      logger.info(`Query rotation active: starting at "${queries[0]}" (offset ${startOffset}/${allQueries.length}).`);
    }

    const seenJobIds = new Set();
    let queriesProcessed = 0;
    let stopFlag = false;

    for (const query of queries) {
      if (stopFlag) break;

      queriesProcessed++;
      let queryAppliedCount = 0;

      for (const location of searchCriteria.locations) {
        if (shouldStop()) {
          stopFlag = true;
          break;
        }

        if (queryAppliedCount >= guardrails.maxAppliesPerQuery) {
          logger.info(`Per-query cap reached (${guardrails.maxAppliesPerQuery}) for "${query}". Moving to next query.`);
          break;
        }

        logger.header(`Search: ${query} in ${location}`);

        for (let pageNum = 1; pageNum <= guardrails.maxPagesPerQuery; pageNum++) {
          if (shouldStop()) {
            stopFlag = true;
            break;
          }

          if (queryAppliedCount >= guardrails.maxAppliesPerQuery) break;

          const activePage = await browserService.getActivePage();
          const candidateJobs = await searchService.scrapeJobsOnPage(activePage, query, location, pageNum);

          if (candidateJobs.length === 0) {
            logger.info(`No candidate jobs on page ${pageNum}, moving to next filter.`);
            break;
          }

          for (const job of candidateJobs) {
            if (shouldStop()) {
              stopFlag = true;
              break;
            }

            if (queryAppliedCount >= guardrails.maxAppliesPerQuery) break;

            // In-run dedupe: overlapping queries often return the same job
            if (seenJobIds.has(job.jobId)) {
              logger.skip('Duplicate job already handled this run', job.title);
              continue;
            }
            seenJobIds.add(job.jobId);

            const currentActivePage = await browserService.getActivePage();
            const result = await applyService.apply(currentActivePage, job);

            if (result.status === 'APPLIED') {
              sessionAppliedCount++;
              queryAppliedCount++;
              logger.info(
                `Applications this session: ${sessionAppliedCount} / ${maxSessionApplies} | this query: ${queryAppliedCount} / ${guardrails.maxAppliesPerQuery}`
              );

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

    saveQueryOffset(startOffset + queriesProcessed, allQueries.length);

    if (stopReason) logger.info(`Run stopped early: ${stopReason}.`);

    // 4. Summary Report
    logger.header('Execution Completed');
    logger.success(`Applications submitted this session: ${sessionAppliedCount}`);
    logger.info(`Jobs skipped this session: ${sessionSkippedCount}`);
    logger.info(`Queries attempted this session: ${queriesProcessed} / ${allQueries.length}`);
    logger.info(`Next run will start at: "${queries[queriesProcessed % queries.length]}"`);
    logger.info(`Total past 24h applied count: ${storageService.getTodayApplicationCount()} / ${guardrails.maxAppliesPerDay}`);
  } catch (err) {
    logger.error('Unexpected error during automation run', err);
  } finally {
    await browserService.close();
    process.exit(0);
  }
}

main();
