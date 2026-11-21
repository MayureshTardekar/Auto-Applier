const { runPlatform } = require('../platforms/shared/runPlatform');
const service = require('../platforms/timesjobs/timesjobsService');

runPlatform({
  displayName: 'TimesJobs',
  cookieFile: 'cookies_timesjobs.json',
  loginCommand: 'npm run login:timesjobs',
  service,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
