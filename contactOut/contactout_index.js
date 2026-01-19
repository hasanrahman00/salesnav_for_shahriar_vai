// contactOut/index.js
//
// Orchestrate the ContactOut scraping process.  This module ties
// together several helpers: waiting for the Sales Navigator lead
// list, opening the ContactOut sidebar, waiting for profile
// results, extracting profile data and (optionally) re‑authenticating
// the ContactOut extension if a login prompt is detected.  Retries
// are supported to handle intermittent failures; the page is
// reloaded between attempts.  Each helper is designed to be small
// and beginner friendly so that developers can easily reason about
// and modify the behaviour.

const { waitForLeadList } = require('../utils/waitForLeadList');
const clickContactOutToggle = require('./clickContactOutToggle');
const waitForContactOutResults = require('./waitForContactOutResults');
const collectProfiles = require('./collectProfiles');
// Import helper to introduce human-like delays before extraction
const { waitRandomIncreasing } = require('../utils/randomDelayer');
const checkContactOutLoggedIn = require('./checkContactOutLoggedIn');
const { ensureContactOutLogin } = require('../utils/contactout_login');
const { ensureSignalHireLogin } = require('../utils/signalhire_login');

// Default options.  Retries controls how many attempts are made to
// open the sidebar before giving up.  The log function can be
// overridden to customise logging behaviour (e.g. to integrate with
// your own logger).
const DEFAULTS = {
  retries: 3,
  log: (...a) => console.log('[ContactOut]', ...a),
};

/**
 * Run the ContactOut scraping flow.  The page argument should be
 * pointing at a LinkedIn Sales Navigator people list.  The
 * function waits for the list to become visible, opens the
 * ContactOut sidebar, extracts all profiles and returns them.  If
 * the sidebar indicates the user is not logged in, this helper can
 * optionally attempt to re‑authenticate using the provided cookie
 * paths.  Retries are performed if the sidebar cannot be opened on
 * the first attempt.  Returns an object with the profiles array on
 * success.
 *
 * @param {import('playwright').Page} page The Playwright page to scrape
 * @param {Object} [opts] Optional overrides for retries, logging and cookie paths
 * @param {number} [opts.retries] Number of attempts before giving up
 * @param {Function} [opts.log] Logger function
 * @param {string} [opts.coCookiePath] Absolute path to ContactOut cookie JSON file
 * @param {string} [opts.shCookiePath] Absolute path to SignalHire cookie JSON file (optional for cross‑auth)
 */
async function runContactOut(page, opts = {}) {
  const { retries, log, coCookiePath, shCookiePath } = { ...DEFAULTS, ...opts };
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    log(`Attempt ${attempt}/${retries}`);
    try {
      // 1) SALES NAV TRACKER: only wait if tracker is not visible
      if (!(await isSalesNavTrackerVisible(page, 600))) {
        log('Waiting for Sales Navigator list…');
        await waitForLeadList(page);
      }
      // 2) CONTACTOUT TRACKER: always open the ContactOut sidebar on each page.  This
      // ensures that the extension refreshes its data for the current list.  We
      // click the toggle, verify login, handle relogin if necessary, and wait
      // for the contact cards to appear.
      log('Clicking ContactOut toggle…');
      const clicked = await clickContactOutToggle(page, 8_000);
      if (!clicked) throw new Error('ContactOut toggle not found/clickable');
      // After clicking the toggle, verify login state
      const loggedIn = await checkContactOutLoggedIn(page);
      if (!loggedIn) {
        log('ContactOut extension not logged in; attempting relogin …');
        const context = page.context();
        // Perform ContactOut login if a cookie path was supplied
        if (coCookiePath) {
          try {
            const coRes = await ensureContactOutLogin(context, coCookiePath);
            if (coRes && coRes.page) await coRes.page.close().catch(() => {});
          } catch (e) {
            log('Error during ContactOut re‑login:', e?.message || e);
          }
        }
        // Optionally refresh SignalHire cookies as well (rarely needed but keeps both extensions in sync)
        if (shCookiePath) {
          try {
            const shRes = await ensureSignalHireLogin(context, shCookiePath);
            if (shRes && shRes.page) await shRes.page.close().catch(() => {});
          } catch (e) {
            log('Error during SignalHire re‑login for ContactOut:', e?.message || e);
          }
        }
        // Reload the LinkedIn page to apply any new cookies
        await page.reload({ waitUntil: 'domcontentloaded' });
        // Wait again for the SalesNav list if necessary
        if (!(await isSalesNavTrackerVisible(page, 600))) {
          await waitForLeadList(page);
        }
        // Click the toggle again after relogin
        log('Re‑clicking ContactOut toggle after relogin…');
        const clicked2 = await clickContactOutToggle(page, 8_000);
        if (!clicked2) throw new Error('ContactOut toggle not found/clickable after relogin');
        // If still not logged in, treat as failure for this attempt
        const loggedInAfter = await checkContactOutLoggedIn(page);
        if (!loggedInAfter) {
          throw new Error('ContactOut login failed after relogin');
        }
      }
      // Wait for the contact cards to appear
      log('Waiting for ContactOut cards…');
      await waitForContactOutResults(page);
      // 3) SCRAPE: page + all frames, then dedupe
      // Pause briefly before extraction to simulate a human reading the sidebar
      try {
        await waitRandomIncreasing(page, 'pre-contactout-extract', { base: 1000, max: 2000 });
      } catch {}
      log('Scraping profiles…');
      const profiles = await collectFromAllContexts(page);
      if (!profiles || profiles.length === 0) throw new Error('No profiles found');
      log(`Got ${profiles.length} profile(s).`);
      return { profiles };
    } catch (err) {
      lastError = err;
      log(`Attempt failed: ${err?.message || err}`);
      if (attempt < retries) {
        log('Reloading page and retrying…');
        await safeReload(page);
      }
    }
  }
  // After exhausting retries, throw the last error
  throw new Error(`ContactOut failed after ${retries} attempt(s): ${lastError?.message || lastError}`);
}

// ----- Helper functions -----

async function isSalesNavTrackerVisible(page, timeout = 600) {
  try {
    const ROW_TITLE = 'a[data-control-name^="view_lead_panel"]';
    await page.locator(ROW_TITLE).first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

async function anyContextHasCards(page) {
  // ContactOut profile cards are identified by data-testid
  const CARD_SEL = 'div[data-testid="contact-information"]';
  // Check main page
  try {
    if (await page.locator(CARD_SEL).first().isVisible({ timeout: 400 })) return true;
  } catch {}
  // Check frames
  for (const f of page.frames()) {
    try {
      if (await f.locator(CARD_SEL).first().isVisible({ timeout: 300 })) return true;
    } catch {}
  }
  return false;
}

async function collectFromAllContexts(page) {
  const contexts = [page, ...page.frames()];
  const parts = await Promise.all(
    contexts.map((ctx) => collectProfiles(ctx).catch(() => []))
  );
  return dedupeByNameAndDomains(parts.flat());
}

function dedupeByNameAndDomains(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = `${(r.fullName || '').toLowerCase()}|${(r.domains || [])
      .slice()
      .sort()
      .join(',')}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

async function safeReload(page) {
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
  } catch {}
  try {
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
  } catch {}
}

// Export the runContactOut function as the module default.  Also
// re‑export ensureContactOutLogin for convenience so callers can
// import either the orchestrator or the raw login helper from this
// module.
module.exports = runContactOut;
module.exports.ensureContactOutLogin = ensureContactOutLogin;