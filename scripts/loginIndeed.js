const readline = require('readline');
const path = require('path');
const browserService = require('../services/browserService');
const indeedService = require('../platforms/indeed/indeedService');
const logger = require('../utils/logger');

const INDEED_COOKIES = path.resolve(__dirname, '..', 'cookies_indeed.json');

function waitForEnter(promptText) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(promptText, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  logger.header('Indeed Authentication Setup');
  const { page } = await browserService.launch(false);

  try {
    await page.goto(indeedService.config.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    console.log('\n' + '='.repeat(60));
    console.log('👉 INSTRUCTIONS:');
    console.log('1. Log into Indeed in the Brave window using Email + OTP/password.');
    console.log('   (Google sign-in is usually blocked in automated browsers.)');
    console.log('2. Once the Indeed homepage shows you as signed in, return here.');
    console.log('='.repeat(60) + '\n');

    let loggedIn = false;
    while (!loggedIn) {
      await waitForEnter('Press ENTER after you have logged in on Indeed: ');
      loggedIn = await indeedService.isAuthenticated(page);
      if (!loggedIn) logger.warn('Not signed in yet. Finish login in the browser, then press ENTER.');
    }

    await browserService.saveCookies(page, INDEED_COOKIES);
    logger.success('Session saved to cookies_indeed.json. Run: npm run apply:indeed');
  } catch (err) {
    logger.error('Indeed login setup failed', err);
  } finally {
    await browserService.close();
    process.exit(0);
  }
}

main();
