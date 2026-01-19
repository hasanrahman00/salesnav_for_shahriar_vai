// contactOut/clickContactOutToggle.js
//
// Finds and clicks the ContactOut toggle button to open the sidebar.  The
// toggle selector can vary across versions of the extension so this
// helper tries several known selectors and watches for dynamically
// attached frames.  It first ensures the Sales Navigator lead list is
// present (via waitForLeadList) before searching for the toggle.

const { waitForLeadList } = require('../utils/waitForLeadList');

// Multiple fallbacks for the toggle selector
const TOGGLE_SELECTORS = [
  'button#floating-button',
  'button#contactout-floating-button',
  '[data-testid="contactout-floating-button"]',
  '[aria-label*="contactout" i]',
].join(',');

module.exports = async function clickContactOutToggle(page, timeout = 5_000) {
  if (typeof waitForLeadList !== 'function') {
    throw new Error('waitForLeadList is not a function (check utils/waitForLeadList.js export)');
  }
  // Ensure the Sales Navigator lead list is ready first
  await waitForLeadList(page);
  const deadline = Date.now() + timeout;
  // 1) Immediate attempts (page, then known extension frames)
  if (await tryClickInRoot(page, 300)) return true;
  for (const f of preferredFrames(page)) {
    if (await tryClickInRoot(f, 300)) return true;
  }
  // 2) Race: keep scanning existing frames + listen for new frames until timeout
  while (Date.now() < deadline) {
    const msLeft = Math.max(0, deadline - Date.now());
    const winner = await Promise.race([
      waitInExistingRoots(page, 400),
      waitNewFrameAndFind(page, 800),
      waitDelay(120),
    ]).catch(() => null);
    if (winner && (await fastClick(winner))) return true;
  }
  return false;
};

/* ----------------- helpers ----------------- */
function preferredFrames(page) {
  // Prefer extension frames that look like ContactOut to minimise search
  return page
    .frames()
    .filter((f) => f.url().startsWith('chrome-extension://') && /contactout/i.test(f.url()));
}

async function tryClickInRoot(root, smallTimeout = 300) {
  const loc = root.locator(TOGGLE_SELECTORS).first();
  try {
    // wait only for attachment (faster than "visible")
    await loc.waitFor({ state: 'attached', timeout: smallTimeout });
  } catch {
    return false;
  }
  return fastClick(loc);
}

async function fastClick(locator) {
  // 1) Click via evaluate to bypass visibility/overlay quirks
  try {
    await locator.evaluate((el) => {
      if (el instanceof HTMLElement) el.click();
      else el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    return true;
  } catch {}
  // 2) Fallback to Playwright click with force
  try {
    await locator.click({ timeout: 400, force: true });
    return true;
  } catch {}
  return false;
}

async function waitInExistingRoots(page, perRootTimeout = 400) {
  // Check page and likely frames in parallel, resolve with first found locator
  const tasks = [];
  tasks.push(findLocatorIfAttached(page, perRootTimeout));
  const prefs = preferredFrames(page);
  for (const f of prefs) {
    tasks.push(findLocatorIfAttached(f, perRootTimeout));
  }
  // Also quickly scan all other frames (cheap pass)
  for (const f of page.frames()) {
    if (!prefs.includes(f)) {
      tasks.push(findLocatorIfAttached(f, 200));
    }
  }
  return Promise.any(tasks).catch(() => null);
}

async function findLocatorIfAttached(root, t) {
  const loc = root.locator(TOGGLE_SELECTORS).first();
  await loc.waitFor({ state: 'attached', timeout: t });
  return loc;
}

function waitNewFrameAndFind(page, frameTimeout = 800) {
  // Resolve when a new frame appears and contains the toggle (attached)
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(cleanup, frameTimeout);
    function cleanup(res) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      page.off('frameattached', onAttach);
      resolve(res || null);
    }
    async function onAttach(frame) {
      try {
        const loc = await findLocatorIfAttached(frame, 300);
        cleanup(loc);
      } catch {
        // ignore; maybe another frame will match
      }
    }
    page.on('frameattached', onAttach);
  });
}

function waitDelay(ms) {
  return new Promise((r) => setTimeout(() => r(null), ms));
}