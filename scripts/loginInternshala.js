const { interactiveLogin } = require('./lib/interactiveLogin');

interactiveLogin({
  displayName: 'Internshala',
  loginUrl: 'https://internshala.com/',
  cookieFile: 'cookies_internshala.json',
  applyCommand: 'npm run apply:internshala',
  instructions: [
    'Click "Login" in the top-right and sign in as a Student (Google or email/password).',
    'Make sure your Internshala profile and resume are complete.',
    'Once the home/dashboard shows your profile, return here.',
  ],
  verify: async (page) => {
    try {
      const body = await page.evaluate(() => document.body.innerText.slice(0, 3000).toLowerCase());
      if (body.includes('logout') || body.includes('my applications') || body.includes('my profile')) return true;
      return await page.evaluate(
        () =>
          Boolean(
            document.querySelector('a[href*="/logout"]') ||
              document.querySelector('a[href*="/student/dashboard"]') ||
              document.querySelector('.profile_menu, [class*="user_menu"]')
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
