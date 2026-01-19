// signalHire/clickSignalHireToggle.js
//
// Locate and click the SignalHire extension toggle button.  The
// button is identified by an <img> with alt="SH" wrapped in a
// button element.  Because SignalHire may inject its UI into a
// nested iframe, this helper searches both the main page and all
// child frames.  It returns true if the button was clicked, or
// false if the button could not be found or interacted with.

module.exports = async function clickSignalHireToggle(page, timeout = 5_000) {
  const TOGGLE = 'button img[alt="SH"]';
  // Try clicking on the given root (page or frame)
  const tryClick = async (root) => {
    try {
      const btn = root.locator(TOGGLE).first();
      await btn.waitFor({ state: 'visible', timeout });
      await btn.click({ force: true });
      return true;
    } catch {
      return false;
    }
  };
  // 1️⃣ Try in the main frame
  if (await tryClick(page)) return true;
  // 2️⃣ Try in every iframe (SignalHire sometimes injects itself)
  for (const frame of page.frames()) {
    if (frame !== page && (await tryClick(frame))) return true;
  }
  // 3️⃣ Nowhere to be found
  return false;
};