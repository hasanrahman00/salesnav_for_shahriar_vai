// utils/nextPageNavigation.js
//
// Robust pagination for LinkedIn Sales Navigator with verbose console logging.
// Returns: 'moved' | 'no-more' | 'failed'

const { waitForLeadList } = require('./waitForLeadList');

const PAGINATION_ROOT = 'div[data-sn-view-name="search-pagination"]';
const NEXT_BUTTON_SEL = `${PAGINATION_ROOT} button[aria-label="Next"]`;
const PAGE_BTN_SEL = (n) => `${PAGINATION_ROOT} li[data-test-pagination-page-btn="${n}"] > button`;
const CURRENT_PAGE_BTN_SEL = `${PAGINATION_ROOT} li.artdeco-pagination__indicator--number.active.selected button[aria-current="true"]`;
const PAGE_STATE_SEL = `${PAGINATION_ROOT} .artdeco-pagination__page-state, ${PAGINATION_ROOT} .artdeco-pagination__state--a11y`;

const ROW_TITLE = 'a[data-control-name^="view_lead_panel"]';
const NO_LEADS_XPATH = "//div[h3[contains(text(), 'No leads matched your search')]]";

// Tunables
const MAX_ATTEMPTS = 3;          // up to 3 fallbacks total
const NEXT_WAIT_MS = 3000;       // wait for pagination buttons
// The old default (2500ms) is safe but slow. Lower default and allow override.
const SETTLE_MS = Number(process.env.SCRAPER_PAGINATION_SETTLE_MS || '1200');
const POLL_MS = 120;             // poll interval
const FIRST_ROW_ATTACH_MS = 700; // attach wait for rows
const NO_LEADS_WAIT_MS = 300;

const log = (...a) => console.log('[pagination]', ...a);
const warn = (...a) => console.warn('[pagination]', ...a);
const err  = (...a) => console.error('[pagination]', ...a);

/**
 * Attempt to navigate to the next page.
 * @param {import('playwright').Page} page
 * @param {number} urlNumber
 * @param {number} currentPageFromCaller
 * @returns {'moved'|'no-more'|'failed'}
 */
async function clickNextPage(page, urlNumber, currentPageFromCaller) {
  const url = safeUrl(page);
  let { current: currentPage, total: totalPages } = await readPageState(page);
  currentPage = currentPage ?? currentPageFromCaller ?? 1;

  log(`URL #${urlNumber} | start page=${currentPage} total=${totalPages ?? '?'} | ${url}`);

  // End conditions first
  if (await isNoLeads(page)) {
    warn('End: "No leads matched your search" banner detected.');
    return 'no-more';
  }
  if (await isOnLastPage(page, currentPage, totalPages)) {
    warn(`End: last page detected (current=${currentPage}, total=${totalPages ?? '?'}).`);
    return 'no-more';
  }

  const beforeKey = await getListFingerprint(page);
  log('fingerprint.before =', summarizeKey(beforeKey));

  // --- Attempts 1..N: numeric next if present, else Next button ---
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const liveCurrent = (await readCurrentPage(page)) ?? currentPage;
    const want = (liveCurrent || 0) + 1;
    log(`Attempt ${attempt}/${MAX_ATTEMPTS} | current=${liveCurrent} -> target=${want}`);

    try {
      const pageBtn = page.locator(PAGE_BTN_SEL(want)).first();
      const hasNumbered = await pageBtn.count().catch(() => 0);

      if (hasNumbered) {
        log(`Clicking numbered page button for ${want} | selector=${PAGE_BTN_SEL(want)}`);
        await safeClick(pageBtn, 'page-number');
      } else {
        log('Numbered button not visible; trying Next button…');
        const nextBtn = await page.waitForSelector(NEXT_BUTTON_SEL, { timeout: NEXT_WAIT_MS });
        const disabled = await nextBtn.evaluate(
          (btn) => btn.disabled || btn.getAttribute('aria-disabled') === 'true'
        );
        if (disabled) {
          warn('End: Next button disabled (last page).');
          return 'no-more';
        }
        log(`Clicking Next | selector=${NEXT_BUTTON_SEL}`);
        await safeClick(nextBtn, 'next');
      }

      const moved = await waitForPageChangeOrStop(page, beforeKey, { settleMs: SETTLE_MS, pollMs: POLL_MS });
      if (moved === 'no-leads') {
        warn('End: "No leads matched your search" after click.');
        return 'no-more';
      }
      if (moved === true) {
        const afterKey = await getListFingerprint(page);
        log('✅ MOVED after click. fingerprint.after =', summarizeKey(afterKey));
        const { current: cur2, total: tot2 } = await readPageState(page);
        log(`Now on page=${cur2 ?? '?'} of ${tot2 ?? '?'}`);
        return 'moved';
      }

      warn("No change detected after click; quick retry…");
      await delay(220);
    } catch (e) {
      warn(`Attempt ${attempt} error: ${e?.message || e}`);
      await delay(180);
    }
  }

  // --- Rescue 1: hard reload, then try numbered/next once more quickly ---
  warn('Rescue #1: reload and re-check…');
  await reloadAndWaitForSalesDashboard(page);

  const movedAfterReload = await changedSince(page, beforeKey);
  if (movedAfterReload) {
    const afterKey = await getListFingerprint(page);
    log('✅ MOVED after reload. fingerprint.after =', summarizeKey(afterKey));
    const { current: curR, total: totR } = await readPageState(page);
    log(`Now on page=${curR ?? '?'} of ${totR ?? '?'}`);
    return 'moved';
  }

  try {
    let { current: cur2 } = await readPageState(page);
    const want2 = (cur2 ?? currentPage) + 1;
    const pageBtn2 = page.locator(PAGE_BTN_SEL(want2)).first();
    if (await pageBtn2.count().catch(() => 0)) {
      log(`Post-reload: clicking numbered button for ${want2}`);
      await safeClick(pageBtn2, 'page-number-post-reload');
    } else {
      log('Post-reload: numbered not visible; clicking Next');
      const nextBtn2 = await page.waitForSelector(NEXT_BUTTON_SEL, { timeout: NEXT_WAIT_MS });
      const disabled2 = await nextBtn2.evaluate(
        (btn) => btn.disabled || btn.getAttribute('aria-disabled') === 'true'
      );
      if (disabled2) {
        warn('End: Next disabled after reload (last page).');
        return 'no-more';
      }
      await safeClick(nextBtn2, 'next-post-reload');
    }
    const moved2 = await waitForPageChangeOrStop(page, beforeKey, { settleMs: SETTLE_MS, pollMs: POLL_MS });
    if (moved2 === 'no-leads') {
      warn('End: no leads after reload click.');
      return 'no-more';
    }
    if (moved2 === true) {
      const afterKey = await getListFingerprint(page);
      log('✅ MOVED after reload click. fingerprint.after =', summarizeKey(afterKey));
      const { current: curF, total: totF } = await readPageState(page);
      log(`Now on page=${curF ?? '?'} of ${totF ?? '?'}`);
      return 'moved';
    }
  } catch (e) {
    warn('Post-reload quick try failed:', e?.message || e);
  }

  // --- Rescue 2 (final): URL param jump (page/p/start) ---
  const { current: cur3 } = await readPageState(page);
  const desired = (cur3 ?? currentPage) + 1;
  const nextUrl = computeNextPageUrl(page.url(), desired);
  log('Rescue #2: URL jump planned =>', nextUrl || '(none)');

  if (nextUrl) {
    try {
      await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await waitForLeadList(page).catch(() => {});
      const ok = await changedSince(page, beforeKey);
      if (ok) {
        const afterKey = await getListFingerprint(page);
        log('✅ MOVED via URL jump. fingerprint.after =', summarizeKey(afterKey));
        const { current: curU, total: totU } = await readPageState(page);
        log(`Now on page=${curU ?? '?'} of ${totU ?? '?'}`);
        return 'moved';
      }
      warn('URL jump did not change list.');
    } catch (e) {
      warn('URL jump failed:', e?.message || e);
    }
  }

  // Last checks
  if (await isNoLeads(page)) {
    warn('End: banner detected at final check.');
    return 'no-more';
  }
  const { current: cEnd, total: tEnd } = await readPageState(page);
  if (await isOnLastPage(page, cEnd ?? currentPage, tEnd)) {
    warn(`End: last page at final check (current=${cEnd ?? '?'} total=${tEnd ?? '?'})`);
    return 'no-more';
  }

  err('❌ FAILED to move after all attempts/rescues.');
  return 'failed';
}

/* -------------------------- helpers -------------------------- */

async function safeClick(locator, label) {
  try { await locator.scrollIntoViewIfNeeded(); } catch {}
  try {
    await locator.click({ timeout: 1500 });
    log(`clicked: ${label}`);
  } catch {
    // overlay or intercept — small wiggle + force
    try {
      const page = locator.page ? locator.page() : null;
      if (page) { await page.mouse.move(5,5); await page.mouse.move(0,0); }
    } catch {}
    await locator.click({ timeout: 1500, force: true });
    log(`clicked (force): ${label}`);
  }
}

async function readCurrentPage(page) {
  try {
    const cur = page.locator(CURRENT_PAGE_BTN_SEL).first();
    const txt = (await cur.textContent({ timeout: 600 }))?.trim();
    const n = Number(txt);
    if (Number.isFinite(n)) return n;
  } catch {}
  return null;
}

async function readPageState(page) {
  const current = await readCurrentPage(page);
  let total = null;
  try {
    const label = page.locator(PAGE_STATE_SEL).first();
    const txt = (await label.textContent({ timeout: 900 })) || '';
    const m = txt.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
    if (m) {
      const t = Number(m[2]);
      if (Number.isFinite(t)) total = t;
    }
  } catch {}
  return { current, total };
}

async function isOnLastPage(page, current, total) {
  try {
    const nextBtn = await page.waitForSelector(NEXT_BUTTON_SEL, { timeout: 1200 });
    const disabled = await nextBtn.evaluate(
      (btn) => btn.disabled || btn.getAttribute('aria-disabled') === 'true'
    );
    if (disabled) return true;
  } catch {}
  if (Number.isFinite(current) && Number.isFinite(total) && total >= 1) {
    if (current >= total) return true;
  }
  return false;
}

async function waitForPageChangeOrStop(page, beforeKey, { settleMs = SETTLE_MS, pollMs = POLL_MS } = {}) {
  const deadline = Date.now() + settleMs;
  try { await page.locator(ROW_TITLE).first().waitFor({ state: 'attached', timeout: FIRST_ROW_ATTACH_MS }); } catch {}
  while (Date.now() < deadline) {
    if (await isNoLeads(page)) return 'no-leads';
    const afterKey = await getListFingerprint(page);
    if (afterKey && beforeKey && afterKey !== beforeKey) return true;
    await delay(pollMs);
  }
  return false;
}

async function isNoLeads(page) {
  try {
    await page.waitForSelector(`xpath=${NO_LEADS_XPATH}`, { timeout: NO_LEADS_WAIT_MS });
    return true;
  } catch { return false; }
}

/** Strong fingerprint: first+last href|text + count */
async function getListFingerprint(page) {
  try {
    const rows = page.locator(ROW_TITLE);
    const count = await rows.count().catch(() => 0);
    if (count === 0) return '';
    const first = rows.first();
    const last  = rows.nth(Math.max(0, count - 1));
    await first.waitFor({ state: 'attached', timeout: FIRST_ROW_ATTACH_MS }).catch(() => {});
    let [fHref, fText, lHref, lText] = await Promise.all([
      first.getAttribute('href').catch(() => ''),
      first.textContent().catch(() => ''),
      last.getAttribute('href').catch(() => ''),
      last.textContent().catch(() => ''),
    ]);
    return `${norm(fHref)}|${norm(fText)}||${norm(lHref)}|${norm(lText)}||count:${count}`;
  } catch { return ''; }
}

async function changedSince(page, beforeKey) {
  const after = await getListFingerprint(page);
  log('fingerprint.after(candidate) =', summarizeKey(after));
  if (beforeKey && after && beforeKey !== after) return true;
  await delay(200);
  const after2 = await getListFingerprint(page);
  log('fingerprint.after(resample)  =', summarizeKey(after2));
  return !!(beforeKey && after2 && beforeKey !== after2);
}

function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function reloadAndWaitForSalesDashboard(page) {
  const urlBefore = safeUrl(page);
  log('reload ->', urlBefore);
  try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }); }
  catch {
    try { const url = page.url(); await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }); } catch {}
  }
  try { await waitForLeadList(page); } catch {}
  try { await page.locator(ROW_TITLE).first().waitFor({ state: 'attached', timeout: 5000 }); } catch {}
  log('reload done; url=', safeUrl(page));
}

function safeUrl(page) {
  try { return page.url(); } catch { return '(no-url)'; }
}

/**
 * Build a next-page URL when query params exist (page/p/start).
 * If none present, adds ?page=desiredPage.
 */
function computeNextPageUrl(currentUrl, desiredPage) {
  try {
    const u = new URL(currentUrl);
    if (u.searchParams.has('page'))  { u.searchParams.set('page', String(desiredPage)); return u.toString(); }
    if (u.searchParams.has('p'))     { u.searchParams.set('p',    String(desiredPage)); return u.toString(); }
    if (u.searchParams.has('start')) {
      const base = Number(u.searchParams.get('start') || '0');
      const step = 25; // typical SalesNav page size (tune if different)
      u.searchParams.set('start', String(base + step));
      return u.toString();
    }
    u.searchParams.set('page', String(desiredPage));
    return u.toString();
  } catch { return null; }
}

function summarizeKey(key) {
  if (!key) return '(empty)';
  // shorten long fingerprints so logs stay readable
  const s = String(key);
  if (s.length <= 120) return s;
  return s.slice(0, 100) + ' … ' + s.slice(-18);
}

module.exports = { clickNextPage };
