// utils/browser.js

const path = require('path');

/*
 * This helper wraps the Playwright Extra API and configures a
 * persistent Chromium instance with the stealth plugin.  A persistent
 * context stores cookies and other session data so that login
 * credentials remain available across runs.  Two unpacked Chrome
 * extensions are loaded from the `extensions` folder.  The
 * `--disable-blink-features=AutomationControlled` flag prevents
 * Playwright from setting `navigator.webdriver` to true, which makes
 * the browser less detectable.
 */

// Import Playwright Extra and the stealth plugin.  These
// dependencies are not included in this repository; install them
// with `npm install playwright-extra puppeteer-extra-plugin-stealth`.
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Register the stealth plugin on the chromium instance.
chromium.use(StealthPlugin());

async function launchStealthBrowser() {
  // Directory where Playwright will store session data (cookies, localStorage).
  const userDataDir = path.join(__dirname, '..', 'user_data');
  // Paths to your unpacked extensions; replace the placeholder folders
  // with your actual extension code.
  const ext1 = path.join(__dirname, '..', 'extensions', 'contacout');
  const ext2 = path.join(__dirname, '..', 'extensions', 'signalhire');

  const args = [
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars', // hide infobars (top banners)
    '--test-type', // hides “unsupported flag” & Google API keys banners
    '--no-first-run',
    '--no-default-browser-check',
    '--password-store=basic', // avoid keychain prompts on Win/Linux
    '--use-mock-keychain', // avoid keychain prompts on macOS
    `--disable-extensions-except=${ext1},${ext2}`,
    `--load-extension=${ext1},${ext2}`,
  ];

  // Launch the persistent context with our arguments and a realistic viewport and user agent.
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args,
    ignoreDefaultArgs: ['--enable-automation'],
    viewport: { width: 1920, height: 1080 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
  });

  // Optional speed boost: abort heavy asset types. This reduces bandwidth and
  // page rendering overhead without blocking scripts/XHR needed for scraping.
  // Disable by setting SCRAPER_BLOCK_RESOURCES=0.
  const blockResources = process.env.SCRAPER_BLOCK_RESOURCES !== '0';
  if (blockResources) {
    await context.route('**/*', async (route) => {
      try {
        const type = route.request().resourceType();
        if (type === 'image' || type === 'media' || type === 'font') {
          return route.abort();
        }
      } catch {
        // ignore and continue
      }
      return route.continue();
    });
  }

  return context;
}

module.exports = { launchStealthBrowser };