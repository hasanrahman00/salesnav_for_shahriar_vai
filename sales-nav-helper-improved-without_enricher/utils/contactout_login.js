// utils/contactout_login.js

// Handles ContactOut login via cookies in its own tab.
const { loadAndConvert } = require('./cookieUtil');

async function ensureContactOutLogin(context, cookiesFile) {
  // Load cookies from the specified file and add them to the context.
  const cookies = loadAndConvert(cookiesFile);
  await context.addCookies(cookies);
  const page = await context.newPage(); // dedicated tab
  // Navigate without waiting for the full page load.  Using
  // waitUntil: 'domcontentloaded' returns as soon as the initial
  // HTML document has been loaded, avoiding a long wait on networkidle.
  // A short timeout prevents this call from blocking other logic.
  await page.goto('https://contactout.com/profile', {
    waitUntil: 'domcontentloaded',
    timeout: 15000,
  });
  const u = page.url().toLowerCase();
  const loggedIn = !(u.includes('/login') || u.includes('/signin') || u.includes('auth'));
  return { page, loggedIn };
}

module.exports = { ensureContactOutLogin };