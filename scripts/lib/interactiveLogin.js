const readline = require('readline');
const path = require('path');
const browserService = require('../../services/browserService');
const logger = require('../../utils/logger');
const { randomDelay } = require('../../utils/delay');

function waitForEnter(promptText) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(promptText, () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * Generic interactive login helper used by the newer platforms.
 *
 * @param {object} opts
 * @param {string} opts.displayName
 * @param {string} opts.loginUrl
 * @param {string} opts.cookieFile
 * @param {string} opts.applyCommand
 * @param {string[]} opts.instructions
 * @param {(page: import('puppeteer').Page) => Promise<boolean>} opts.verify
 */
async function interactiveLogin({ displayName, loginUrl, cookieFile, applyCommand, instructions, verify }) {
  const cookiesPath = path.resolve(__dirname, '..', '..', cookieFile);

  logger.header(`${displayName} Authentication Setup`);
  logger.info(`Launching interactive browser for ${displayName}...`);

  const { page } = await browserService.launch(false);

  try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await randomDelay(1500, 2500);

    console.log('\n' + '='.repeat(64));
    console.log(`👉 ${displayName.toUpperCase()} LOGIN INSTRUCTIONS:`);
    instructions.forEach((line, i) => console.log(`${i + 1}. ${line}`));
    console.log('='.repeat(64) + '\n');

    let loggedIn = false;
    while (!loggedIn) {
      await waitForEnter(`Press ENTER after you have logged in on ${displayName}: `);
      logger.info('Verifying login state in tab...');
      loggedIn = await verify(page);
      if (!loggedIn) {
        logger.warn(`Not authenticated on ${displayName} yet. Finish signing in, then press ENTER again.\n`);
      }
    }

    await randomDelay(1500, 2500);
    await browserService.saveCookies(page, cookiesPath);
    logger.success(`Authentication confirmed! Session saved to ${cookieFile}`);
    logger.info(`Setup complete! You can now run: ${applyCommand}`);
  } catch (err) {
    logger.error(`${displayName} login setup encountered an error`, err);
  } finally {
    await browserService.close();
    process.exit(0);
  }
}

module.exports = { interactiveLogin };
