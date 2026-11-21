const { runPlatform } = require('../platforms/shared/runPlatform');
const service = require('../platforms/foundit/founditService');

runPlatform({
  displayName: 'Foundit',
  cookieFile: 'cookies_foundit.json',
  loginCommand: 'npm run login:foundit',
  service,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
