// signalHire/extractSignalHireProfiles.js
//
// Scrape profile details from the SignalHire sidebar.  Each profile
// card contains the person's name, location, title, company and a
// link to their LinkedIn profile.  This helper waits for the
// SignalHire sidebar to be fully loaded, scrolls through the list
// until all cards are rendered, extracts the relevant fields, and
// performs post‑processing such as name splitting and company
// normalisation.

const { cleanName } = require('../utils/nameCleaner');
const { cleanCompanyName } = require('../utils/cleanCompanyName');

module.exports = async function extractSignalHireProfiles(page) {
  // Determine which frame the SignalHire cards reside in
  const root = await getSignalHireRoot(page);
  const cardSel = 'li._1VGRZDYbh';
  // Wait for the first card to appear
  await root.locator(cardSel).first().waitFor({ state: 'visible', timeout: 15000 });
  // Scroll until all cards are loaded (handles lazy rendering)
  await loadAllCards(root, cardSel);
  // Extract raw data for each card in the DOM context
  const rows = await root.locator(cardSel).evaluateAll((nodes) => {
    return nodes.map((card) => {
      const q = (sel) => card.querySelector(sel);
      const safeText = (sel) => (q(sel)?.textContent || '').trim();
      const safeAttr = (sel, attr) => q(sel)?.getAttribute(attr) || '';
      return {
        name: safeText('h3.X9UUt5-wC'),
        person_location: safeText('i._1rkN4HF-c + span'),
        title: safeText('i._23sCxfSQ5 + span'),
        company: safeText('i._1kYVNzVgg + span'),
        person_title: safeAttr('div._4rhT6X1EK a', 'href'),
      };
    });
  });
  // Post‑process: clean names and company, split first/last
  return rows.map((r) => {
    const cleanedName = cleanName(r.name);
    const tokens = cleanedName.split(' ').filter(Boolean);
    const first = tokens[0] || '';
    const last = tokens.length > 1 ? tokens[tokens.length - 1] : '';
    return {
      ...r,
      name: cleanedName,
      first_name: first,
      last_name: last,
      company: cleanCompanyName(r.company),
    };
  });
};

/**
 * Determine the correct root context for scraping.  SignalHire
 * sometimes injects its UI into a Chrome extension frame.  If the
 * cards are found directly on the page, return the page; otherwise
 * search for a frame whose URL looks like a SignalHire extension.
 *
 * @param {import('playwright').Page} page The Playwright page
 * @returns {Promise<import('playwright').Frame|import('playwright').Page>}
 */
async function getSignalHireRoot(page) {
  const exists = await page.locator('li._1VGRZDYbh').first().count();
  if (exists) return page;
  const frame = page
    .frames()
    .find((f) => {
      const url = f.url();
      return url.startsWith('chrome-extension://') && /signalhire/i.test(url);
    });
  return frame || page;
}

/**
 * Scroll through the SignalHire results list until the number of
 * cards stabilises.  This helper repeatedly scrolls a container and
 * monitors the count of list items.  It stops once two consecutive
 * scrolls yield the same count, or once a safety cap is reached.
 *
 * @param {import('playwright').Frame|import('playwright').Page} root The root context
 * @param {string} cardSel CSS selector for the result cards
 */
async function loadAllCards(root, cardSel) {
  // Find a scrollable container near the list (UL or its parent)
  const list = root.locator(`ul:has(${cardSel})`).first();
  // Use the list if present, otherwise fall back to the first card's scrollable ancestor
  const container = (await list.count())
    ? list
    : root
        .locator(cardSel)
        .first()
        .locator("xpath=ancestor::*[contains(@style,'overflow')][1]");
  const handle =
    (await container.elementHandle()) ||
    (await root.locator(cardSel).first().elementHandle());
  let stable = 0;
  let prev = 0;
  while (stable < 2) {
    const count = await root.locator(cardSel).count();
    // Robust scroll: perform two downward scrolls
    await root.evaluate((el) => {
      el.scrollBy(0, el.clientHeight * 0.8);
      el.scrollBy(0, el.clientHeight * 0.8);
    }, handle);
    await root.waitForTimeout(400);
    const next = await root.locator(cardSel).count();
    if (next === count && count === prev) {
      stable += 1;
    } else {
      stable = 0;
    }
    prev = next;
    // Safety cap to avoid infinite loop on very long lists
    if (next > 2000) break;
  }
}