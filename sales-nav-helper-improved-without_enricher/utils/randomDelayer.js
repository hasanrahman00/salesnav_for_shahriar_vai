// utils/randomDelayer.js
//
// Simple helpers to introduce human‑like random delays between
// actions.  Using random delays helps automation appear less
// deterministic and can reduce the likelihood of being detected
// by automated anti‑bot systems.  Both helpers are intentionally
// lightweight and beginner friendly.

/**
 * Compute a random delay in seconds between a minimum and maximum.
 * The returned value is a floating point number; callers can
 * multiply by 1000 if they need milliseconds.  Defaults to a
 * human‑like range of 0.5–2 seconds.  You can override the
 * min/max via parameters.
 *
 * @param {number} [min=0.5] Minimum delay in seconds
 * @param {number} [max=2] Maximum delay in seconds
 * @returns {number} A random delay in seconds
 */
function nextDelaySecs(min = 0.5, max = 2) {
  return Math.random() * (max - min) + min;
}

/**
 * Wait for a short, random delay on a Playwright page.  This helper
 * wraps page.waitForTimeout() with a randomly computed timeout so
 * that each call pauses for a slightly different duration.  You can
 * customise the base duration, growth factor and maximum cap via
 * the opts argument.  The label argument is ignored but exists so
 * you can easily add logging if desired in the future.
 *
 * @param {import('playwright').Page} page The Playwright page to wait on
 * @param {string} [label=''] Optional label for logging (unused)
 * @param {Object} [opts]
 * @param {number} [opts.base=500] Base delay in milliseconds
 * @param {number} [opts.factor=1.2] Growth factor for delay (unused currently)
 * @param {number} [opts.max=3000] Maximum allowed delay in milliseconds
 */
async function waitRandomIncreasing(page, label = '', opts = {}) {
  const { base = 500, factor = 1.2, max = 3000 } = opts;
  // Compute a delay between base*0.5 and base*1.5, capped at max.
  const delay = Math.min(base * (Math.random() + 0.5), max);
  await page.waitForTimeout(delay);
}

module.exports = { nextDelaySecs, waitRandomIncreasing };