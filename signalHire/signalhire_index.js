// signalHire/index.js
//
// Orchestrate the SignalHire scraping process.  This module ties
// together several helpers: waiting for the Sales Navigator list,
// opening the SignalHire sidebar, waiting for results, extracting
// profiles, upgrading the CSV header if necessary and persisting
// results to disk.  Retries are supported to handle intermittent
// failures; the page is reloaded between attempts.  Each helper is
// designed to be small and beginner friendly so that developers can
// easily reason about and modify the behaviour.

const path = require('path');
const fs = require('fs/promises');
const { waitForLeadList } = require('../utils/waitForLeadList');
// Ensure the CSV includes an Email column when appending to an existing file.
const { upgradeCsvAddEmailOnly } = require('../utils/upgradeCsvAddEmailOnly');
const { waitRandomIncreasing, nextDelaySecs } = require('../utils/randomDelayer');
const clickSignalHireToggle = require('./clickSignalHireToggle');
const waitForSignalHireResults = require('./waitForSignalHireResults');
const extractSignalHireProfiles = require('./extractSignalHireProfiles');
// Use the robust CSV writer that automatically handles domain1 and Email columns.
const { saveProfilesCsv } = require('../utils/saveProfilesCsv');

// Additional helpers to detect login state and re‑authenticate
const checkSignalHireLoggedIn = require('./checkSignalHireLoggedIn');
const { ensureSignalHireLogin } = require('../utils/signalhire_login');
const { ensureContactOutLogin } = require('../utils/contactout_login');

// Default CSV location: used only when no filePath option is provided.
const DEFAULT_OUTPUT_CSV = path.resolve(process.cwd(), 'output.csv');

// Default options.  Retries controls how many attempts are made to
// open the sidebar before giving up.  The log function can be
// overridden to customise logging behaviour (e.g. to integrate with
// your own logger).
const DEFAULTS = {
  retries: 3,
  log: (...a) => console.log('[SignalHire]', ...a),
};

/**
 * Run the SignalHire scraping flow.  The page argument should be
 * pointing at a LinkedIn Sales Navigator people list.  The
 * function waits for the list to become visible, opens the
 * SignalHire sidebar, extracts all profiles and saves them to a
 * CSV.  Retries are performed if the sidebar cannot be opened on
 * the first attempt.  Returns an object with the rows and the
 * output file path on success.
 *
 * @param {import('playwright').Page} page The Playwright page to scrape
 * @param {Object} [opts] Optional overrides for retries and logging
 */
module.exports = async function runSignalHire(page, opts = {}) {
  // Extract options, providing defaults where appropriate.  The
  // shCookiePath and coCookiePath values are used when the sidebar
  // indicates the user is not logged in and a re‑authentication is
  // required.  They may be undefined if the caller does not wish to
  // support re‑authentication within this helper.
  const {
    retries,
    log,
    shCookiePath,
    coCookiePath,
  } = { ...DEFAULTS, ...opts };
  await ensureSidebarReadyWithRetries(page, retries, log, shCookiePath, coCookiePath);
  // After the sidebar is ready, pause for a human‑like delay before starting extraction.
  try {
    await waitRandomIncreasing(page, 'pre-signalhire-extract', { base: 1000, max: 2000 });
  } catch {}
  log('Extracting profiles …');
  const rows = await extractSignalHireProfiles(page);
  log(`Extracted ${rows.length} row(s).`);
  // Deduplicate new rows by LinkedIn URL.  We first build a set of
  // existing LinkedIn URLs from the output CSV (if it exists), then
  // filter out any rows whose URL already exists in the file or
  // within this batch.  This prevents duplicate profiles from
  // appearing across pages or runs.
  let existingUrls = new Set();
  const outputPath = opts.filePath || DEFAULT_OUTPUT_CSV;
  try {
    const exists = await fs
      .access(outputPath)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      const rawCsv = await fs.readFile(outputPath, 'utf8');
      // Lazily require csv-parse/sync.  If not available, skip dedup.
      let parse;
      try {
        parse = require('csv-parse/sync').parse;
      } catch {
        parse = null;
      }
      if (parse) {
        const records = parse(rawCsv, {
          columns: true,
          skip_empty_lines: true,
          relax_column_count: true,
        });
        for (const rec of records) {
          const urlField = rec['LinkedIn URL'] || rec['LinkedIn'] || rec['person_title'];
          if (urlField) {
            existingUrls.add(String(urlField).trim().toLowerCase());
          }
        }
      }
    }
  } catch (e) {
    // ignore parse or IO errors
  }
  const seenUrls = new Set();
  const uniqueRows = [];
  for (const r of rows) {
    const url = r.person_title ? String(r.person_title).trim().toLowerCase() : '';
    if (!url) {
      // Keep rows without a URL
      uniqueRows.push(r);
      continue;
    }
    if (existingUrls.has(url) || seenUrls.has(url)) {
      continue;
    }
    seenUrls.add(url);
    uniqueRows.push(r);
  }
  // Ensure each unique row has domain and Email keys so that the CSV header
  // includes these columns on the first write.  Without this, later
  // merges may produce inconsistent column counts.  Also ensure
  // snake_case name keys (first_name, last_name) exist when saving.
  for (const r of uniqueRows) {
    // Copy legacy first/last names if they exist
    if (Object.prototype.hasOwnProperty.call(r, 'first_Name')) {
      r.first_name = r.first_Name;
      delete r.first_Name;
    }
    if (Object.prototype.hasOwnProperty.call(r, 'last_Name')) {
      r.last_name = r.last_Name;
      delete r.last_Name;
    }
    if (!Object.prototype.hasOwnProperty.call(r, 'first_name')) r.first_name = '';
    if (!Object.prototype.hasOwnProperty.call(r, 'last_name')) r.last_name = '';
    if (!Object.prototype.hasOwnProperty.call(r, 'domain')) r.domain = '';
    if (!Object.prototype.hasOwnProperty.call(r, 'Email')) r.Email = '';
  }
  // Determine the output path.  If opts.filePath is provided, use it;
  // otherwise fall back to the default path in the current working directory.
  // outputPath was already defined earlier in the function; reuse it here.
  // Determine whether to append.  If the file exists and the caller
  // did not provide an explicit append flag, we append to avoid
  // losing existing data.  Otherwise honour the caller's append.
  const callerProvidedAppend = Object.prototype.hasOwnProperty.call(opts, 'append')
    ? opts.append
    : undefined;
  const exists = await fs
    .access(outputPath)
    .then(() => true)
    .catch(() => false);
  const effectiveAppend =
    callerProvidedAppend !== undefined ? callerProvidedAppend : exists;
  // Before saving, ensure the CSV header includes Email (if the
  // file already exists).  We silently ignore any errors.
  if (exists) {
    await upgradeCsvAddEmailOnly(outputPath).catch(() => {});
  }
  log('Saving CSV …');
  
  await saveProfilesCsv(uniqueRows, {
    filePath: outputPath,
    append: effectiveAppend,
  });
  log('Saved ->', outputPath);
  return { rows: uniqueRows, filePath: outputPath };
};

// ----- Helper functions -----

/**
 * Ensure that the SignalHire sidebar is open and ready.  This
 * function encapsulates the logic to wait for the Sales Navigator
 * list, open the SignalHire sidebar via the toggle button and
 * verify that results are visible.  If an attempt fails, the page
 * is reloaded and the process is retried.  After a successful
 * attempt the function returns; otherwise it throws an error once
 * the maximum number of retries has been reached.
 *
 * @param {import('playwright').Page} page The Playwright page
 * @param {number} maxRetries Maximum number of attempts
 * @param {Function} log Logger for informational messages
 */
async function ensureSidebarReadyWithRetries(page, maxRetries, log, shPath, coPath) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log(`Open sidebar attempt ${attempt}/${maxRetries}`);
      // 1) SALES NAV TRACKER: if not visible, wait for SalesNav list
      const salesNavVisible = await isSalesNavTrackerVisible(page, 500);
      if (!salesNavVisible) {
        await waitForLeadList(page);
      }
      // 2) SH SIDEBAR TRACKER: if visible, we're done (do not click toggle)
      if (await isSHSidebarTrackerVisible(page, 500)) {
        log('Sidebar already open ✔ (tracker found)');
        return;
      }
      // 3) Not visible → click toggle then confirm results
      const clicked = await clickSignalHireToggle(page, 10_000);
      if (!clicked) throw new Error('SignalHire toggle not found/clickable');
      // Immediately check if the extension shows a sign‑in prompt.  If so,
      // attempt to re‑authenticate using provided cookie paths.
      const loggedIn = await checkSignalHireLoggedIn(page);
      if (!loggedIn) {
        log('SignalHire extension not logged in; attempting relogin …');
        const context = page.context();
        // Perform SignalHire login if a cookie path was supplied
        if (shPath) {
          try {
            const shRes = await ensureSignalHireLogin(context, shPath);
            if (shRes && shRes.page) await shRes.page.close().catch(() => {});
          } catch (e) {
            log('Error during SignalHire re‑login:', e?.message || e);
          }
        }
        // Perform ContactOut login if a cookie path was supplied
        if (coPath) {
          try {
            const coRes = await ensureContactOutLogin(context, coPath);
            if (coRes && coRes.page) await coRes.page.close().catch(() => {});
          } catch (e) {
            log('Error during ContactOut re‑login:', e?.message || e);
          }
        }
        // Reload the LinkedIn page to apply any new cookies
        await page.reload({ waitUntil: 'domcontentloaded' });
        // Wait again for SalesNav list if necessary
        const salesNavAgain = await isSalesNavTrackerVisible(page, 500);
        if (!salesNavAgain) {
          await waitForLeadList(page);
        }
        // Click the toggle again after relogin
        const clicked2 = await clickSignalHireToggle(page, 10_000);
        if (!clicked2) throw new Error('SignalHire toggle not found/clickable after relogin');
        // If still not logged in, treat as failure for this attempt
        const loggedInAfter = await checkSignalHireLoggedIn(page);
        if (!loggedInAfter) {
          throw new Error('SignalHire login failed after relogin');
        }
      }
      // At this point, either we were logged in originally or have just
      // re‑authenticated.  Wait for the results to appear.  If no
      // results appear, an exception will be thrown which triggers a
      // retry.  Otherwise we can proceed.
      await waitForSignalHireResults(page);
      log('Sidebar is open ✔');
      return;
    } catch (err) {
      log(`Attempt ${attempt} failed: ${err?.message || err}`);
      if (attempt === maxRetries) throw err;
      log('Refreshing page and retrying …');
      await safeReload(page, log);
    }
  }
}

async function isSalesNavTrackerVisible(page, timeout = 500) {
  try {
    const ROW_TITLE = 'a[data-control-name^="view_lead_panel"]';
    await page.locator(ROW_TITLE).first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

async function isSHSidebarTrackerVisible(page, timeout = 500) {
  try {
    const tracker = page.locator('li._1VGRZDYbh').first();
    await tracker.waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

async function safeReload(page, log) {
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
  } catch {
    log('Reload(domcontentloaded) failed, trying plain reload …');
    await page.reload().catch(() => {});
  }
  await page
    .waitForLoadState('networkidle', { timeout: 10_000 })
    .catch(() => {});
}