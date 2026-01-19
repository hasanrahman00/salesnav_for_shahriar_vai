// utils/nextPageNavigation.js
//
// Navigate to the next page in Sales Navigator with up to 3 attempts.
// Success criteria: the first lead "fingerprint" changes (new page of results).
// Stop criteria: "No leads matched your search" OR Next button is disabled.

const { waitForLeadList } = require('./waitForLeadList');

const NEXT_BUTTON_SEL = 'button[aria-label="Next"]';
const ROW_TITLE = 'a[data-control-name^="view_lead_panel"]';
const NO_LEADS_XPATH = "//div[h3[contains(text(), 'No leads matched your search')]]";

async function clickNextPage(page, urlNumber, currentPage) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(
      `🌐 URL #${urlNumber} | Page #${currentPage}: Attempting next page (Attempt ${attempt}/3)…`,
    );

    try {
      // (0) Capture fingerprint before clicking
      const beforeKey = await getFirstResultKey(page);

      // Bail if "No leads"
      if (await isNoLeads(page)) {
        console.warn(
          `⚠️ No leads matched your search on URL #${urlNumber} | Page #${currentPage}. Stopping.`,
        );
        return 'no-more';
      }

      // (1) Next button
      const nextBtn = await page.waitForSelector(NEXT_BUTTON_SEL, { timeout: 15000 });

      // (1.a) Disabled = end
      const disabled = await nextBtn.evaluate(
        (btn) => btn.disabled || btn.getAttribute('aria-disabled') === 'true',
      );
      if (disabled) {
        console.warn('⚠️ Next button is disabled (last page).');
        return 'no-more';
      }

      // (2) Click
      await nextBtn.evaluate((btn) => btn.click());

      // (3) Wait for change or "no leads"
      const moved = await waitForPageChangeOrNoLeads(page, beforeKey, {
        settleMs: 8000,
        pollMs: 300,
      });

      if (moved === 'no-leads') {
        console.warn(
          `⚠️ No leads matched your search on URL #${urlNumber} | Page #${currentPage}. Stopping.`,
        );
        return 'no-more';
      }
      if (moved === true) {
        console.log(
          `✅ Page changed successfully! Now on URL #${urlNumber} | Page #${currentPage + 1}.`,
        );
        return 'moved';
      }

      // If we get here, we timed out waiting for a change
      console.warn("⚠️ Next click didn't change the list in time; retrying…");

      // NEW: After the first failed attempt (and on subsequent failures),
      // reload & wait for Sales dashboard before retrying.
      await reloadAndWaitForSalesDashboard(page);
    } catch (error) {
      console.warn(
        `⚠️ Next button click attempt ${attempt} failed: ${error?.message || error}`,
      );

      // NEW: Even on thrown errors, reload before the next attempt (if any)
      if (attempt < 3) {
        await reloadAndWaitForSalesDashboard(page);
      }
    }
  }

  console.error(
    `❌ Failed to go to next page after 3 attempts on URL #${urlNumber} | Page #${currentPage}.`,
  );
  return 'failed';
}


// ----- Helper functions -----

async function waitForPageChangeOrNoLeads(
  page,
  beforeKey,
  { settleMs = 8000, pollMs = 300 } = {},
) {
  const deadline = Date.now() + settleMs;
  // Try to give the SPA a moment to start swapping the list
  try {
    await waitForLeadList(page);
  } catch {}
  while (Date.now() < deadline) {
    // If a "no leads" banner appears, it's definitively the end.
    if (await isNoLeads(page)) return 'no-leads';
    // If the first row fingerprint changed, we moved to the next page.
    const afterKey = await getFirstResultKey(page);
    if (afterKey && beforeKey && afterKey !== beforeKey) return true;
    // Small backoff before polling again
    await delay(pollMs);
  }
  return false; // neither changed nor "no leads" within the time budget
}

async function isNoLeads(page) {
  try {
    await page.waitForSelector(`xpath=${NO_LEADS_XPATH}`, { timeout: 500 });
    return true;
  } catch {
    return false;
  }
}

async function getFirstResultKey(page) {
  try {
    const el = page.locator(ROW_TITLE).first();
    await el.waitFor({ state: 'attached', timeout: 800 });
    const [href, text] = await Promise.all([
      el.getAttribute('href').catch(() => ''),
      el.textContent().catch(() => ''),
    ]);
    return `${(href || '').trim()}|${normalize(text)}`;
  } catch {
    return '';
  }
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}


async function reloadAndWaitForSalesDashboard(page) {
  // Hard reload helps stale SPA state
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
  } catch (e) {
    // If reload fails (rare), soft-fallback to navigating to current URL
    try {
      const url = page.url();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    } catch {}
  }

  // Wait for list scaffolding & first row "tracker" to attach
  try {
    await waitForLeadList(page);
  } catch {}
  try {
    // ROW_TITLE is your tracker: a[data-control-name^="view_lead_panel"]
    const el = page.locator(ROW_TITLE).first();

    await el.waitFor({ state: 'attached', timeout: 10000 });
  } catch {}
}




module.exports = { clickNextPage };