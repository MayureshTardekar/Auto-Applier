/**
 * Prints the manual-apply queue: jobs the bot skipped (external site, no apply
 * button, unconfirmed submission) that you may want to apply to yourself.
 *
 * Usage:
 *   npm run manual:list
 *   node scripts/listManualQueue.js --platform=indeed
 */
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DATA_DIR = path.resolve(__dirname, '..', 'data');

const args = process.argv.slice(2);
const platformArg = args.find((a) => a.startsWith('--platform='));
const platform = platformArg ? platformArg.split('=')[1].toLowerCase() : 'naukri';

const file =
  platform === 'naukri'
    ? path.join(DATA_DIR, 'manual_apply.txt')
    : path.join(DATA_DIR, `manual_apply_${platform}.txt`);

if (!fs.existsSync(file)) {
  logger.info(`No manual-apply queue yet for ${platform} (${path.basename(file)}).`);
  process.exit(0);
}

const lines = fs
  .readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

if (lines.length === 0) {
  logger.info(`Manual-apply queue is empty for ${platform}.`);
  process.exit(0);
}

logger.header(`Manual Apply Queue (${platform}) - ${lines.length} job(s)`);

lines.forEach((line, i) => {
  const [date, title, company, reason, url] = line.split(' | ');
  console.log(`\n${i + 1}. ${title || 'Unknown'}${company ? ` @ ${company}` : ''}`);
  console.log(`   reason: ${reason || 'n/a'}  |  queued: ${date || 'n/a'}`);
  if (url) console.log(`   ${url}`);
});

console.log('');
