require('dotenv').config();

const guardrails = {
  // Safety application caps
  maxAppliesPerRun: parseInt(process.env.MAX_APPLIES_PER_RUN, 10) || 15,
  maxAppliesPerDay: parseInt(process.env.MAX_APPLIES_PER_DAY, 10) || 30,

  // Human-like inter-apply delays (avoids rate limiting and velocity detection)
  interApplyDelayMinMs: parseInt(process.env.INTER_APPLY_DELAY_MIN_MS, 10) || 15000,
  interApplyDelayMaxMs: parseInt(process.env.INTER_APPLY_DELAY_MAX_MS, 10) || 30000,

  // Page interaction delays
  actionDelayMinMs: 2500,
  actionDelayMaxMs: 5000,
  paginationDelayMinMs: 5000,
  paginationDelayMaxMs: 9000,

  // Navigation timeouts
  pageLoadTimeoutMs: parseInt(process.env.PAGE_LOAD_TIMEOUT_MS, 10) || 45000,
  elementWaitTimeoutMs: 8000,

  // Max search pages to scrape per search query
  maxPagesPerQuery: 3,

  // Headless mode toggle (defaults to false for better stealth)
  headless: process.env.HEADLESS === 'true',
};

module.exports = Object.freeze(guardrails);
