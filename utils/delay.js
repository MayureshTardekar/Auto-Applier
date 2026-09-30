/**
 * Resolves after a randomized delay between min and max milliseconds.
 * @param {number} min Minimum delay in ms
 * @param {number} max Maximum delay in ms
 * @returns {Promise<void>}
 */
const randomDelay = (min, max) => {
  const duration = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, duration));
};

/**
 * Performs gentle humanized scrolling on the active page to trigger lazy loading and bypass bot checks.
 * @param {import('puppeteer').Page} page
 */
const humanScroll = async (page) => {
  try {
    const scrollCount = Math.floor(Math.random() * 3) + 2;
    for (let i = 0; i < scrollCount; i++) {
      const scrollY = Math.floor(Math.random() * 400) + 200;
      await page.evaluate((y) => {
        window.scrollBy({ top: y, behavior: 'smooth' });
      }, scrollY);
      await randomDelay(800, 1500);
    }
  } catch {
    // Non-critical, ignore scroll error if page navigating
  }
};

/**
 * Randomizes mouse movements within viewport bounds.
 * @param {import('puppeteer').Page} page
 */
const humanMouseMove = async (page) => {
  try {
    const x = Math.floor(Math.random() * 600) + 100;
    const y = Math.floor(Math.random() * 400) + 100;
    await page.mouse.move(x, y, { steps: 10 });
  } catch {
    // Non-critical
  }
};

module.exports = {
  randomDelay,
  humanScroll,
  humanMouseMove,
};
