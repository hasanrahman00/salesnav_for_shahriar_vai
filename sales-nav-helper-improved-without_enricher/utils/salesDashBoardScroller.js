// utils/salesDashBoardScroller.js
//
// Scroll through the Sales Navigator lead list in a human‑like way.  This
// helper waits for a lead list tracker element to appear, then
// identifies a scrollable container and performs incremental
// scrolling with randomised delays and jitter.  The aim is to
// simulate a real user browsing the list so that extension
// overlays (like SignalHire and ContactOut) have time to load
// results lazily.  The function returns a string indicating
// whether scrolling completed or no scrollable container could be
// found.

/**
 * Scroll the Sales Navigator lead list.  By default it waits for
 * the first lead row, picks the largest scrollable container and
 * performs up to `maxSteps` scroll steps of `stepPx` pixels each,
 * with a random delay between `minDelayMs` and `maxDelayMs`.
 *
 * @param {import('playwright').Page} page The Playwright page
 * @param {Object} opts Options for scrolling behaviour
 * @param {string} [opts.trackerSelector='a[data-control-name^="view_lead_panel"]'] CSS selector that indicates the lead list is ready
 * @param {string|null} [opts.scrollSelector=null] Optional selector for an explicit scroll container
 * @param {number} [opts.maxSteps=40] Maximum number of scroll steps
 * @param {number} [opts.stepPx=200] Number of pixels to scroll per step
 * @param {number} [opts.minDelayMs=200] Minimum delay between steps (ms)
 * @param {number} [opts.maxDelayMs=550] Maximum delay between steps (ms)
 * @param {boolean} [opts.highlight=false] Whether to outline the scroll container for debugging
 * @param {number} [opts.timeoutMs=15000] Maximum time to wait for the lead list
 * @returns {Promise<string>} "scroll-complete" or "no-scroll-container"
 */
async function salesDashBoardScroller(page, opts = {}) {
  const {
    trackerSelector = 'a[data-control-name^="view_lead_panel"]',
    scrollSelector = null,
    maxSteps = 40,
    stepPx = 200,
    minDelayMs = 200,
    maxDelayMs = 550,
    highlight = false,
    timeoutMs = 15000,
  } = opts;
  console.log('⏳ Waiting for tracker to appear…', trackerSelector);
  await page.waitForSelector(trackerSelector, { timeout: timeoutMs });
  // Run the scrolling inside the page context for efficiency
  const result = await page.evaluate(
    async (cfg) => {
      const delay = (ms) => new Promise((res) => setTimeout(res, ms));
      const rand = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
      // 1) Pick a scroll container
      let el = null;
      if (cfg.scrollSelector) {
        el = document.querySelector(cfg.scrollSelector);
      }
      if (!el) {
        // auto-pick the largest obviously scrollable container on the page
        const cands = Array.from(document.querySelectorAll('main, section, div, ul, ol'))
          .filter((n) => n.scrollHeight > n.clientHeight && n.offsetHeight > 300)
          .sort((a, b) => b.clientHeight - a.clientHeight);
        el = cands[0] || null;
      }
      if (!el) {
        console.warn('⚠️ Scrollable container not found.');
        return 'no-scroll-container';
      }
      if (cfg.highlight) el.style.outline = '2px solid red';
      // 2) Smooth-ish incremental scrolling with jitter, stop if no movement
      let lastTop = -1;
      let same = 0;
      for (let i = 0; i < cfg.maxSteps; i++) {
        el.scrollBy({ top: cfg.stepPx, behavior: 'smooth' });
        await delay(rand(cfg.minDelayMs, cfg.maxDelayMs));
        const curr = el.scrollTop;
        if (curr === lastTop) {
          same++;
          if (same >= 4) break; // likely reached the bottom or blocked
        } else {
          same = 0;
          lastTop = curr;
        }
      }
      return 'scroll-complete';
    },
    {
      trackerSelector,
      scrollSelector,
      maxSteps,
      stepPx,
      minDelayMs,
      maxDelayMs,
      highlight,
    },
  );
  return result;
}

module.exports = salesDashBoardScroller;