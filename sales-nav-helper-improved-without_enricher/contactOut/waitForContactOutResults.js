// contactOut/waitForContactOutResults.js
//
// Wait for ContactOut profile cards to appear.  This helper
// continuously checks both the main page and all frames for at least
// one card matching the data-testid attribute.  If no card is found
// within the timeout an error is thrown.  The function returns the
// context (page or frame) in which the cards were found.

const CARD_SEL = 'div[data-testid="contact-information"]';

module.exports = async function waitForContactOutResults(page, timeout = 15000) {
  const end = Date.now() + timeout;
  const has = async (ctx) => (await ctx.locator(CARD_SEL).first().count()) > 0;
  if (await has(page)) return page;
  while (Date.now() < end) {
    for (const f of page.frames()) {
      if (await has(f)) return f;
    }
    await page.waitForTimeout(150);
  }
  throw new Error('ContactOut cards not found. Is the sidebar open?');
};