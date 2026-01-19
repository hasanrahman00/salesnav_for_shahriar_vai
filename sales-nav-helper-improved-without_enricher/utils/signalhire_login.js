// utils/signalhire_login.js

// Handles SignalHire login via cookies in its own tab.
const { loadAndConvert } = require('./cookieUtil');

async function ensureSignalHireLogin(context, cookiesFile) {
  // Load cookies from the specified file and add them to the context.
  const cookies = loadAndConvert(cookiesFile);
  await context.addCookies(cookies);
  // dedicated tab
  const page = await context.newPage();
  // Navigate without waiting for full page load.  We wait only for
  // the DOM content to be loaded and impose a short timeout to avoid
  // blocking other logic.
  await page.goto(
    'https://www.signalhire.com/candidates/3c4f94c0b61d4f999d1bf0b6093f3fcb',
    {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    }
  );
  const u = page.url().toLowerCase();
  const loggedIn = !(
    u.includes('/login') ||
    u.includes('/signin') ||
    u.includes('auth')
  );
  return { page, loggedIn };
}

module.exports = { ensureSignalHireLogin };