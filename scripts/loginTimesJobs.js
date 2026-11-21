const { interactiveLogin } = require('./lib/interactiveLogin');

interactiveLogin({
  displayName: 'TimesJobs',
  loginUrl: 'https://www.timesjobs.com/login',
  cookieFile: 'cookies_timesjobs.json',
  applyCommand: 'npm run apply:timesjobs',
  instructions: [
    'Sign in with your TimesJobs account (email/password or Google).',
    'Complete your profile/resume if prompted.',
    'Once you see your profile or "Logout", return here.',
  ],
  verify: async (page) => {
    try {
      const body = await page.evaluate(() => document.body.innerText.slice(0, 3000).toLowerCase());
      if (body.includes('access denied')) return false;
      if (body.includes('logout') || body.includes('my profile') || body.includes('my applications')) return true;
      return await page.evaluate(
        () =>
          !Array.from(document.querySelectorAll('a[href*="/login"]')).some(
            (a) => a.offsetParent !== null && /login/i.test(a.innerText || '')
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
