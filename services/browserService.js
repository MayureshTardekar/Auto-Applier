const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const guardrails = require('../config/guardrails');

puppeteer.use(StealthPlugin());

const COOKIES_PATH = path.resolve(__dirname, '..', 'cookies.json');
const USER_DATA_DIR = path.resolve(__dirname, '..', '.brave-session');

const getBrowserExecutablePath = () => {
  // 1. Environment variable override
  if (process.env.BROWSER_EXECUTABLE_PATH) {
    if (fs.existsSync(process.env.BROWSER_EXECUTABLE_PATH)) {
      return process.env.BROWSER_EXECUTABLE_PATH;
    }
    logger.warn(`Specified BROWSER_EXECUTABLE_PATH not found: ${process.env.BROWSER_EXECUTABLE_PATH}`);
  }

  // 2. Auto-detect Brave installation paths on Windows
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const candidateBravePaths = [
    path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
  ];

  for (const candidate of candidateBravePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined; // Puppeteer will fall back to bundled Chromium
};

class BrowserService {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  async launch(isHeadless = guardrails.headless) {
    const executablePath = getBrowserExecutablePath();
    if (executablePath) {
      logger.info(`Using browser: ${executablePath}`);
    } else {
      logger.info('Using default Chromium browser.');
    }

    logger.info(`Launching browser (headless: ${isHeadless})...`);

    this.browser = await puppeteer.launch({
      headless: isHeadless,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1440,900',
      ],
      defaultViewport: {
        width: 1440,
        height: 900,
      },
    });

    this.page = await this.browser.newPage();

    // Auto-dismiss or accept any native JavaScript alerts/dialogs to prevent hanging
    this.page.on('dialog', async (dialog) => {
      try {
        logger.info(`Auto-handling native dialog: "${dialog.message()}"`);
        await dialog.accept();
      } catch {
        // Ignore
      }
    });

    // Standard modern Chrome User-Agent
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    );

    // Set standard request headers
    await this.page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
    });

    return { browser: this.browser, page: this.page };
  }

  hasSavedSession(customCookiePath = null) {
    const targetPath = customCookiePath || COOKIES_PATH;
    return fs.existsSync(targetPath);
  }

  async loadCookies(customCookiePath = null) {
    const targetPath = customCookiePath || COOKIES_PATH;
    if (fs.existsSync(targetPath)) {
      try {
        const raw = fs.readFileSync(targetPath, 'utf8');
        const cookies = JSON.parse(raw);

        if (Array.isArray(cookies) && cookies.length > 0) {
          await this.browser.setCookie(...cookies);
          logger.info(`Loaded ${cookies.length} session cookies from ${path.basename(targetPath)}.`);
        }
      } catch (err) {
        logger.warn(`Could not parse ${path.basename(targetPath)}`, err);
      }
    } else {
      logger.info(`Cookie file not found at ${path.basename(targetPath)}.`);
    }
  }

  async saveCookies(page, customCookiePath = null) {
    const targetPath = customCookiePath || COOKIES_PATH;
    try {
      const cookies = await page.cookies();
      fs.writeFileSync(targetPath, JSON.stringify(cookies, null, 2), 'utf8');
      logger.success(`Saved ${cookies.length} cookies to ${path.basename(targetPath)}`);
    } catch (err) {
      logger.error(`Failed to save cookies to ${path.basename(targetPath)}`, err);
      throw err;
    }
  }

  async verifySession(page) {
    logger.info('Verifying Naukri session authentication...');
    try {
      await page.goto('https://www.naukri.com/mnjuser/homepage', {
        waitUntil: 'networkidle2',
        timeout: guardrails.pageLoadTimeoutMs,
      });

      const currentUrl = page.url();
      if (currentUrl.includes('/nlogin/login') || currentUrl.includes('login')) {
        return false;
      }

      // Check for user-specific indicators on homepage
      const loggedInBadge = await page.evaluate(() => {
        return Boolean(
          document.querySelector('.user-name') ||
          document.querySelector('.nI-gdn-profile-pic') ||
          document.querySelector('.view-profile-wrapper') ||
          document.querySelector('a[href*="/mnjuser/profile"]')
        );
      });

      return loggedInBadge || !currentUrl.includes('login');
    } catch (err) {
      logger.error('Session verification request failed', err);
      return false;
    }
  }

  async close() {
    if (this.browser) {
      try {
        await this.browser.close();
        logger.info('Browser closed cleanly.');
      } catch (err) {
        logger.warn('Error while closing browser', err);
      } finally {
        this.browser = null;
        this.page = null;
      }
    }
  }
}

module.exports = new BrowserService();
