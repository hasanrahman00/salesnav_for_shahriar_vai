// signalHire/checkSignalHireLoggedIn.js
//
// Inspect the SignalHire sidebar for a login prompt.  When a user
// is not signed in within the SignalHire Chrome extension, the
// sidebar displays a welcome/sign‑in screen rather than lead cards.
// This helper looks for elements associated with that sign‑in
// prompt.  If the prompt is found the function returns false (not
// logged in); otherwise it returns true.  A short timeout keeps
// this check snappy.

/**
 * Determine whether the SignalHire extension is logged in by
 * searching for known sign‑in markers.  The search runs across
 * the main page and all iframes injected by SignalHire.
 *
 * @param {import('playwright').Page} page The Playwright page
 * @param {number} [timeout=2000] Maximum time in milliseconds to wait for selectors
 * @returns {Promise<boolean>} True if logged in (no sign‑in prompt), false otherwise
 */
module.exports = async function checkSignalHireLoggedIn(page, timeout = 2000) {
  // Helper to test a frame for sign‑in markers
  const testFrame = async (frame) => {
    try {
      // Text content variant: "Welcome to SignalHire!"
      const welcome = frame.locator('text=/Welcome to SignalHire/i');
      if (await welcome.count()) return false;
      // Another marker: a button span with class _1AjY9-VYq containing "Sign in"
      const signInBtn = frame.locator('span._1AjY9-VYq', { hasText: 'Sign in' }).first();
      if (await signInBtn.count()) return false;
      // Alternatively, a generic sign‑in button
      const signInGeneric = frame.locator('text=/Sign in/i');
      if (await signInGeneric.count()) return false;
    } catch {
      // ignore errors; treat as not found
    }
    return true;
  };
  // Check main frame
  const mainOk = await testFrame(page);
  if (!mainOk) return false;
  // Check all child frames
  for (const frame of page.frames()) {
    if (frame === page) continue;
    const ok = await testFrame(frame);
    if (!ok) return false;
  }
  return true;
};