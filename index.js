/**
 * Universal Multi-Platform Entrypoint
 * Usage:
 *   node index.js                      (defaults to Naukri)
 *   node index.js --platform=naukri    (runs Naukri)
 *   node index.js --platform=instahyre (runs Instahyre)
 */

const args = process.argv.slice(2);
const platformArg = args.find((a) => a.startsWith('--platform='));
const platform = platformArg ? platformArg.split('=')[1].toLowerCase() : 'naukri';

if (platform === 'instahyre') {
  require('./scripts/bulkApplyInstahyre');
} else if (platform === 'naukri') {
  require('./scripts/bulkApply');
} else {
  console.error(`Unknown platform: "${platform}". Supported platforms: "naukri", "instahyre".`);
  process.exit(1);
}
