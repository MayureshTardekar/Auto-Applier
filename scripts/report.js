/**
 * Exports every applied job from data/applied*.json into data/applications.csv.
 *
 * Usage:
 *   npm run report
 */
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const OUT_FILE = path.join(DATA_DIR, 'applications.csv');
const HEADERS = ['platform', 'appliedAt', 'title', 'company', 'location', 'experience', 'jobId', 'url'];

function csvCell(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function platformFromFilename(file) {
  const match = file.match(/^applied_(.+)\.json$/i);
  return match ? match[1] : 'naukri';
}

const files = fs.existsSync(DATA_DIR)
  ? fs.readdirSync(DATA_DIR).filter((f) => /^applied.*\.json$/i.test(f))
  : [];

const rows = [];

for (const file of files) {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
    const data = JSON.parse(raw || '{}');
    for (const [jobId, job] of Object.entries(data)) {
      rows.push({
        platform: job.platform || platformFromFilename(file),
        appliedAt: job.appliedAt || '',
        title: job.title || '',
        company: job.company || '',
        location: job.location || '',
        experience: job.experience || '',
        jobId,
        url: job.url || '',
      });
    }
  } catch (err) {
    logger.error(`Skipping unreadable ${file}`, err);
  }
}

rows.sort((a, b) => new Date(b.appliedAt || 0) - new Date(a.appliedAt || 0));

const lines = [HEADERS.join(',')];
for (const row of rows) {
  lines.push(HEADERS.map((h) => csvCell(row[h])).join(','));
}

fs.writeFileSync(OUT_FILE, lines.join('\n') + '\n', 'utf8');

logger.success(`Exported ${rows.length} application(s) -> ${path.relative(process.cwd(), OUT_FILE)}`);
if (rows.length > 0) {
  logger.info(`Latest application: ${rows[0].title || 'Unknown'} @ ${rows[0].company || 'Unknown'} (${rows[0].appliedAt || 'n/a'})`);
}
