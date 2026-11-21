const { interactiveLogin } = require('./lib/interactiveLogin');
const founditService = require('../platforms/foundit/founditService');

interactiveLogin({
  displayName: 'Foundit',
  loginUrl: 'https://www.foundit.in/',
  cookieFile: 'cookies_foundit.json',
  applyCommand: 'npm run apply:foundit',
  instructions: [
    'Log into your Foundit account (email/OTP or Google).',
    'If you see "Access Denied", Foundit is blocking automated browsers on this network - try again later or from a different network.',
    'Once your profile/home shows you as logged in, return here.',
  ],
  verify: async (page) => {
    try {
      const body = await page.evaluate(() => document.body.innerText.slice(0, 3000).toLowerCase());
      if (body.includes('access denied')) {
        console.log('Foundit is showing "Access Denied" for this browser session.');
        return false;
      }
      if (body.includes('logout') || body.includes('my profile') || body.includes('my applications')) return true;
      return await page.evaluate(
        () =>
          Boolean(
            document.querySelector('a[href*="/logout"]') ||
              document.querySelector('a[href*="/profile"]') ||
              document.querySelector('[class*="userName"], [class*="user-name"]')
          )
      );
    } catch {
      return false;
    }
  },
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
