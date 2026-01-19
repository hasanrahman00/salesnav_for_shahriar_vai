// contactOut/checkContactOutLoggedIn.js
//
// Inspect the ContactOut sidebar for a login prompt.  When the
// extension is not signed in, the ContactOut popup displays a
// welcome/sign‑up page with prominent Sign up and Login buttons.
// This helper searches for those indicators within the main page
// and any extension iframes.  If a sign‑up or login prompt is
// detected, the function returns false (not logged in); otherwise
// it returns true.  A short timeout keeps this check snappy.

/**
 * Determine whether the ContactOut extension is logged in by
 * searching for known sign‑up/login markers.  The search runs
 * across the main page and all iframes injected by ContactOut.
 *
 * @param {import('playwright').Page} page The Playwright page
 * @param {number} [timeout=2000] Maximum time in milliseconds to wait for selectors
 * @returns {Promise<boolean>} True if logged in (no sign‑up prompt), false otherwise
 */
module.exports = async function checkContactOutLoggedIn(page, timeout = 2000) {
  // Helper to test a frame for sign‑up/login markers
  const testFrame = async (frame) => {
    try {
      // ContactOut shows a heading like "Sign up to save contact details..."
      const signUpHeading = frame.locator('text=/Sign up to save contact details/i');
      if (await signUpHeading.count()) return false;
      // Buttons with text "Sign up" or "Sign in" or "Login" indicate not logged in
      const signUpBtn = frame.locator('button', { hasText: /Sign up/i }).first();
      if (await signUpBtn.count()) return false;
      const signInBtn = frame.locator('button', { hasText: /Sign in/i }).first();
      if (await signInBtn.count()) return false;
      const loginBtn = frame.locator('button', { hasText: /Login/i }).first();
      if (await loginBtn.count()) return false;
      // Generic text search: if the page contains "ContactOut" and "free" it might be the welcome page
      const welcome = frame.locator('text=/ContactOut.*free/i');
      if (await welcome.count()) return false;
    } catch {
      // ignore errors; treat as not found in this frame
    }
    return true;
  };
  // Check the main page
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