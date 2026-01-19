// utils/waitForLeadList.js
// Helper to wait for the Sales Navigator lead list to be visible.  The
// `page` passed in should already be on a Sales Navigator People
// search results page.  This function waits for the lead rows to be
// attached and visible, and then ensures that at least a few
// elements have been rendered.  It uses Playwright's selectors and
// waitForFunction to accomplish this.

const ROW_TITLE = 'a[data-control-name^="view_lead_panel"]';

// Random delay helper.  Introducing a small pause after the list appears helps
// avoid immediate automation actions that could appear bot‑like.  We import
// nextDelaySecs from the same utils folder.
const { nextDelaySecs } = require('./randomDelayer');

/**
 * Wait until the LinkedIn Sales Navigator lead list is visible.
 *
 * @param {import('playwright').Page} page The Playwright page object
 * @param {number} [timeout=10000] Timeout in milliseconds
 */
async function waitForLeadList(page, timeout = 10_000) {
  // Wait for at least one lead row to be visible.
  await page.waitForSelector(ROW_TITLE, { state: 'visible', timeout });
  // Wait for the element to be attached to the DOM.  The 'attached'
  // state returns once the element exists in the DOM, without
  // requiring it to be visible.  This is slightly faster than
  // waiting for a full render.
  await page.waitForSelector(ROW_TITLE, { state: 'attached', timeout });
  // Ensure that a reasonable number of rows have loaded.  This
  // prevents early returns when only a single row has been rendered.
  await page.waitForFunction(
    (sel) => document.querySelectorAll(sel).length >= 10,
    ROW_TITLE,
    { timeout }
  );
  // Finally, give the page a tiny amount of idle time to settle,
  // capped at 500ms.  Use domcontentloaded rather than waiting for
  // full load events to reduce wait time.  Swallow timeouts.
  await page.waitForLoadState('domcontentloaded', { timeout: 500 }).catch(() => {});
  // Add a small random delay (2–5 seconds) after the list is visible to mimic
  // human hesitation before interacting with the page.  If the delay fails
  // (e.g. due to closed context), ignore the error.
  try {
    const delaySeconds = nextDelaySecs(2, 5);
    await page.waitForTimeout(delaySeconds * 1000);
  } catch {}
}

module.exports = { waitForLeadList };