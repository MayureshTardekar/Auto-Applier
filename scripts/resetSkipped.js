/**
 * Clears retry-able entries from a platform's skipped list so they are attempted again.
 * Permanent reasons (external apply, title mismatch) are kept unless --all is passed.
 *
 * Usage:
 *   node scripts/resetSkipped.js --platform=indeed
 *   node scripts/resetSkipped.js --platform=indeed --all
 *
 * Stop the platform's runner first, otherwise it will overwrite the file from memory.
 */
const storageService = require('../services/storageService');
const logger = require('../utils/logger');

const KEEP_REASONS = new Set(['external_apply', 'title_filter_mismatch']);

const args = process.argv.slice(2);
const platformArg = args.find((a) => a.startsWith('--platform='));
const platform = platformArg ? platformArg.split('=')[1].toLowerCase() : null;
const reasonArg = args.find((a) => a.startsWith('--reason='));
const targetReason = reasonArg ? reasonArg.split('=')[1] : null;

if (!platform) {
  logger.error('Missing --platform. Example: node scripts/resetSkipped.js --platform=naukri');
  process.exit(1);
}

const storage = storageService.getStorage(platform);
const removed = storage.clearSkipped((entry) => {
  if (targetReason) return entry.reason === targetReason;
  return clearAll || !KEEP_REASONS.has(String(entry.reason).split('(')[0]);
});

logger.success(`Cleared ${removed} skipped ${platform} job(s). They will be retried on the next run.`);
