// utils/linkedin_login.js


// this module provides helpers to manage LinkedIn login via cookies
// and check login status by URL inspection

const { loadAndConvert } = require('./cookieUtil');

async function addLinkedInCookies(context, cookieFile) {
  const all = loadAndConvert(cookieFile);
  const li = all.filter((c) => /\.linkedin\.com$/i.test(c.domain));
  if (!li.length) throw new Error('No linkedin.com cookies found');
  try {
    await context.addCookies(li);
  } catch (e) {
    console.warn('[LinkedIn] bulk addCookies failed:', e?.message || e);
    for (const c of li) {
      try {
        await context.addCookies([c]);
      } catch (err) {
        console.error('[LinkedIn] bad cookie:', c.name, err?.message || err);
      }
    }
  }
}

// Simple URL‑only login check (no DOM wait)
// If final URL contains login/signin/signup → treat as NOT logged in
async function checkLinkedInByUrl(context, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    console.warn('[LinkedIn] goto timeout (continuing):', e?.message || e);
  }
  await page.waitForTimeout(500); // let redirects settle
  const u = page.url().toLowerCase();
  const loggedIn = !(
    u.includes('/login') ||
    u.includes('/signin') ||
    u.includes('signup')
  );
  return { page, loggedIn, finalUrl: u };
}

module.exports = { addLinkedInCookies, checkLinkedInByUrl };