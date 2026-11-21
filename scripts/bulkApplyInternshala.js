const { runPlatform } = require('../platforms/shared/runPlatform');
const service = require('../platforms/internshala/internshalaService');

runPlatform({
  displayName: 'Internshala',
  cookieFile: 'cookies_internshala.json',
  loginCommand: 'npm run login:internshala',
  service,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
