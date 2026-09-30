const readline = require('readline');
const browserService = require('../services/browserService');
const logger = require('../utils/logger');
const { randomDelay } = require('../utils/delay');

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

async function isUserAuthenticated(page) {
  try {
    const currentUrl = page.url();

    // 1. If still clearly on login URL
    if (currentUrl.includes('/nlogin/login') || currentUrl.endsWith('/login')) {
      return false;
    }

    // 2. Check for logged-in profile/dashboard elements without navigating
    const hasProfileElement = await page.evaluate(() => {
      return Boolean(
        document.querySelector('.nI-gdn-profile-pic') ||
        document.querySelector('.view-profile-wrapper') ||
        document.querySelector('.user-name') ||
        document.querySelector('a[href*="/mnjuser/profile"]') ||
        document.querySelector('a[href*="/mnjuser/homepage"]')
      );
    });

    if (hasProfileElement) return true;

    // 3. Check for Naukri auth cookies in active session
    const cookies = await page.cookies();
    const hasAuthCookie = cookies.some((c) => {
      const name = c.name.toLowerCase();
      return name.includes('nauk_at') || name.includes('nprofile') || name.includes('auth') || name === 'user';
    });

    // If navigated away from login page and has user cookies or dashboard path
    if (currentUrl.includes('/mnjuser/') && !currentUrl.includes('login')) {
      return true;
    }

    return hasAuthCookie;
  } catch (err) {
    logger.error('Error checking active page state', err);
    return false;
  }
}

async function main() {
  logger.header('Naukri Authentication Setup');
  logger.info('Launching interactive Brave browser...');

  const { browser, page } = await browserService.launch(false);

  try {
    logger.info('Navigating to login page...');
    await page.goto('https://www.naukri.com/nlogin/login', {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    console.log('\n' + '='.repeat(60));
    console.log('👉 INSTRUCTIONS:');
    console.log('1. Log into your Naukri account in the Brave browser window.');
    console.log('   (Take your time - use Google login, OTP, or password)');
    console.log('2. Once your profile or home dashboard loads, return here.');
    console.log('='.repeat(60) + '\n');

    let loggedIn = false;

    while (!loggedIn) {
      await waitForEnter('Press ENTER after you have logged in in Brave: ');

      logger.info('Checking login status (inspecting tab)...');
      loggedIn = await isUserAuthenticated(page);

      if (!loggedIn) {
        logger.warn('It looks like you are still on the login page or not yet authenticated.');
        logger.info('Please finish signing in inside the Brave window, and then press ENTER.\n');
      }
    }

    await randomDelay(1500, 2500);

    // Save cookies to cookies.json as backup alongside persistent .brave-session
    await browserService.saveCookies(page);
    logger.success('Authentication confirmed! Session saved to .brave-session and cookies.json');
    logger.info('Setup complete! You can now run: npm run apply');
  } catch (err) {
    logger.error('Login process encountered an error', err);
  } finally {
    await browserService.close();
    process.exit(0);
  }
}

main();
