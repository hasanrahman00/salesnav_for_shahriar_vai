// contactOut/collectProfiles.js
//
// Extract profile information from the ContactOut sidebar.  Each
// profile card contains the person's name and a list of email
// addresses.  This helper performs a two‑phase extraction: it first
// collects all visible cards, then performs a micro scroll and a
// second pass to capture any lazily rendered cards.  Duplicate
// profiles are deduplicated by name and domain list.

const { filterBusinessDomains } = require('./domainFilter');
const { cleanName } = require('../utils/nameCleaner');

const ROOT_SELECTOR = 'div[data-testid="contact-information"]';

/**
 * Collect profiles from a Page or Frame context.  Returns an array of
 * objects with fullName, firstName, lastName and domains (business
 * email domains).  If duplicate entries are found the last one wins.
 *
 * @param {import('playwright').Page|import('playwright').Frame} context
 * @returns {Promise<Array<{fullName:string, firstName:string, lastName:string, domains:string[]}>>}
 */
async function collectProfiles(context) {
  // First pass
  const beforeCount = await context.locator(ROOT_SELECTOR).count();
  let profiles = await extractOnce(context);
  // Micro‑scroll + short wait to trigger any late render
  await context
    .evaluate(() => {
      const t =
        document.scrollingElement || document.documentElement || document.body;
      if (t && t.scrollBy) {
        const step = Math.max(200, Math.floor((t.clientHeight || 800) * 0.5));
        t.scrollBy(0, step);
      }
    })
    .catch(() => {});
  await context.waitForTimeout(250);
  // If more cards appeared, do ONE retry and merge
  const afterCount = await context.locator(ROOT_SELECTOR).count();
  if (afterCount > beforeCount) {
    const second = await extractOnce(context);
    profiles = dedupeProfiles([...profiles, ...second]);
  }
  return profiles;
}

/* ---------------- helpers ---------------- */

async function extractOnce(context) {
  const raw = await context.locator(ROOT_SELECTOR).evaluateAll((cards) =>
    cards.map((card) => {
      // Name (fallback through several selectors)
      const nameEl =
        card.querySelector('div.css-72nh78') ||
        card.querySelector('[data-testid="contact-name"]') ||
        card.querySelector('h3, h4');
      const rawName = (nameEl?.textContent || '').trim();
      // Emails: spans containing "@"
      const rawEmails = [];
      card.querySelectorAll(':scope * span').forEach((span) => {
        const t = (span.textContent || '').trim();
        if (t.includes('@')) rawEmails.push(t);
      });
      return { rawName, rawEmails };
    })
  );
  // Post‑process outside the page
  return raw.map(({ rawName, rawEmails }) => {
    const fullName = cleanName(rawName);
    const tokens = fullName.split(/\s+/).filter(Boolean);
    const firstName = tokens[0] || '';
    const lastName = tokens.length > 1 ? tokens[tokens.length - 1] : '';
    const domains = filterBusinessDomains(rawEmails);
    return { fullName, firstName, lastName, domains };
  });
}

function dedupeProfiles(rows) {
  const seen = new Map();
  const out = [];
  for (const r of rows) {
    const key = `${r.fullName.toLowerCase()}|${(r.domains || [])
      .slice()
      .sort()
      .join(',')}`;
    if (!seen.has(key)) {
      seen.set(key, true);
      out.push(r);
    }
  }
  return out;
}

module.exports = collectProfiles;