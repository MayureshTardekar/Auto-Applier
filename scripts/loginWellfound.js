const readline = require('readline');
const path = require('path');
const browserService = require('../services/browserService');
const logger = require('../utils/logger');
const { randomDelay } = require('../utils/delay');

const WELLFOUND_COOKIES = path.resolve(__dirname, '..', 'cookies_wellfound.json');

function waitForEnter(promptText) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(promptText, () => {
      rl.close();
      resolve();
    });
  });
}

async function isWellfoundAuthenticated(page) {
  try {
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/join')) {
      return false;
    }

    const hasUserElements = await page.evaluate(() => {
      return Boolean(
        document.querySelector('[data-test="user-menu"]') ||
        document.querySelector('a[href*="/profile"]') ||
        document.querySelector('.user-avatar')
      );
    });

    if (hasUserElements) return true;

    const cookies = await page.cookies();
    return cookies.some((c) => c.name.toLowerCase().includes('session') || c.name.toLowerCase().includes('auth') || c.name.includes('_angel'));
  } catch (err) {
    logger.error('Error checking Wellfound page state', err);
    return false;
  }
}

async function main() {
  logger.header('Wellfound Authentication Setup');
  logger.info('Launching interactive Brave browser for Wellfound...');

  const { browser, page } = await browserService.launch(false);

  try {
    logger.info('Navigating to Wellfound login...');
    await page.goto('https://wellfound.com/login', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    console.log('\n' + '='.repeat(60));
    console.log('👉 INSTRUCTIONS:');
    console.log('1. Log into your Wellfound account in the Brave browser.');
    console.log('   (Supports Google sign-in, LinkedIn, or Email/Password)');
    console.log('2. Once your jobs feed or profile dashboard loads, return here.');
    console.log('='.repeat(60) + '\n');

    let loggedIn = false;

    while (!loggedIn) {
      await waitForEnter('Press ENTER after you have logged in on Wellfound: ');

      logger.info('Verifying login state in tab...');
      loggedIn = await isWellfoundAuthenticated(page);

      if (!loggedIn) {
        logger.warn('It looks like you are not yet authenticated on Wellfound.');
        logger.info('Please finish signing in, then press ENTER.\n');
      }
    }

    await randomDelay(1500, 2500);

    // Save cookies to cookies_wellfound.json
    await browserService.saveCookies(page, WELLFOUND_COOKIES);
    logger.success('Authentication confirmed! Session saved to cookies_wellfound.json');
    logger.info('Setup complete! You can now run: npm run apply:wellfound');
  } catch (err) {
    logger.error('Wellfound login setup encountered an error', err);
  } finally {
    await browserService.close();
    process.exit(0);
  }
}

main();
