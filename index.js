/**
 * Universal Multi-Platform Entrypoint
 * Usage:
 *   node index.js                      (defaults to Naukri)
 *   node index.js --platform=naukri    (runs Naukri)
 *   node index.js --platform=wellfound (runs Wellfound)
 *   node index.js --platform=instahyre (runs Instahyre)
 *   node index.js --platform=indeed    (runs Indeed)
 *   node index.js --platform=foundit    (runs Foundit)
 *   node index.js --platform=internshala (runs Internshala)
 *   node index.js --platform=timesjobs  (runs TimesJobs)
 */

const args = process.argv.slice(2);
const platformArg = args.find((a) => a.startsWith('--platform='));
const platform = platformArg ? platformArg.split('=')[1].toLowerCase() : 'naukri';

if (platform === 'indeed') {
  require('./scripts/bulkApplyIndeed');
} else if (platform === 'wellfound') {
  require('./scripts/bulkApplyWellfound');
} else if (platform === 'instahyre') {
  require('./scripts/bulkApplyInstahyre');
} else if (platform === 'foundit') {
  require('./scripts/bulkApplyFoundit');
} else if (platform === 'internshala') {
  require('./scripts/bulkApplyInternshala');
} else if (platform === 'timesjobs') {
  require('./scripts/bulkApplyTimesJobs');
} else if (platform === 'naukri') {
  require('./scripts/bulkApply');
} else {
  console.error(
    `Unknown platform: "${platform}". Supported platforms: "naukri", "wellfound", "instahyre", "indeed", "foundit", "internshala", "timesjobs".`
  );
  process.exit(1);
}
