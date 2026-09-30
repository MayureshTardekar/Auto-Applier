const readline = require('readline');
const path = require('path');
const browserService = require('../services/browserService');
const logger = require('../utils/logger');
const { randomDelay } = require('../utils/delay');

const INSTAHYRE_COOKIES = path.resolve(__dirname, '..', 'cookies_instahyre.json');

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

async function isInstahyreAuthenticated(page) {
  try {
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/signup')) {
      return false;
    }

    const hasCandidateNav = await page.evaluate(() => {
      return Boolean(
        document.querySelector('#candidate-navbar') ||
        document.querySelector('.candidate-name') ||
        document.querySelector('a[href*="/candidate/"]') ||
        document.querySelector('#opportunities')
      );
    });

    if (hasCandidateNav || currentUrl.includes('/candidate/')) {
      return true;
    }

    const cookies = await page.cookies();
    return cookies.some((c) => c.name.toLowerCase().includes('session') || c.name.toLowerCase().includes('auth'));
  } catch (err) {
    logger.error('Error checking Instahyre page state', err);
    return false;
  }
}

async function main() {
  logger.header('Instahyre Authentication Setup');
  logger.info('Launching interactive Brave browser for Instahyre...');

  const { browser, page } = await browserService.launch(false);

  try {
    logger.info('Navigating to Instahyre candidate login...');
    await page.goto('https://www.instahyre.com/login/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    console.log('\n' + '='.repeat(60));
    console.log('👉 INSTRUCTIONS:');
    console.log('1. Log into your Instahyre account in the Brave browser.');
    console.log('   (Supports Google sign-in, LinkedIn, or Email/Password)');
    console.log('2. Once your candidate dashboard or opportunities page loads, return here.');
    console.log('='.repeat(60) + '\n');

    let loggedIn = false;

    while (!loggedIn) {
      await waitForEnter('Press ENTER after you have logged in on Instahyre: ');

      logger.info('Verifying login state in tab...');
      loggedIn = await isInstahyreAuthenticated(page);

      if (!loggedIn) {
        logger.warn('It looks like you are not yet authenticated on Instahyre.');
        logger.info('Please finish signing in, then press ENTER.\n');
      }
    }

    await randomDelay(1500, 2500);

    // Save cookies to cookies_instahyre.json
    await browserService.saveCookies(page, INSTAHYRE_COOKIES);
    logger.success('Authentication confirmed! Session saved to cookies_instahyre.json');
    logger.info('Setup complete! You can now run: npm run apply:instahyre');
  } catch (err) {
    logger.error('Instahyre login setup encountered an error', err);
  } finally {
    await browserService.close();
    process.exit(0);
  }
}

main();
