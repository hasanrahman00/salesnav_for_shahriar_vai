// routes/scrapeRoutes.js

const express = require('express');
const path = require('path');
const router = express.Router();

const { getCookieFilePath } = require('../utils/fileHandler');
const { launchStealthBrowser } = require('../utils/browser');
const {
  addLinkedInCookies,
  checkLinkedInByUrl,
} = require('../utils/linkedin_login');
const { ensureContactOutLogin } = require('../utils/contactout_login');
const { ensureSignalHireLogin } = require('../utils/signalhire_login');
// Import the SignalHire orchestration module.  This helper will
// scrape profiles from the SignalHire sidebar once the Sales
// Navigator list is ready.
const runSignalHire = require('../signalHire');

// Import the ContactOut orchestration module and CSV merge helper.  The
// runContactOut function will scrape ContactOut profiles and handle
// login re‑authentication.  mergeContactDomainsByNamePriority merges
// the resulting domains into the existing CSV.
const runContactOut = require('../contactOut');
const { mergeContactDomainsByNamePriority } = require('../utils/mergeContactDomains');
const { upgradeCsvAddEmailOnly } = require('../utils/upgradeCsvAddEmailOnly');
const salesDashBoardScroller = require('../utils/salesDashBoardScroller');
const { nextDelaySecs } = require('../utils/randomDelayer');

// -----------------------------------------------------------------------------
// Job persistence integration
//
// Jobs are persisted to disk via the jobsManager module.  When the
// server starts, jobsManager.loadJobs() is invoked by server.js to
// populate an in‑memory cache of job objects.  Here we import the
// relevant helpers and obtain a reference to the jobs cache.  Note:
// modifications to objects within this cache must be persisted by
// calling updateJob() or setJob(); they are not automatically saved
// back to disk.
const {
  getJobs,
  getJob,
  setJob,
  updateJob,
} = require('../utils/jobsManager');
const jobs = getJobs(); // alias to the in‑memory jobs cache

const scrapeSession = {
  isScraping: false,
  isPaused: false,
  pauseRequested: false,
  currentJobId: null,
};

// Import next page navigation helper.  This helper advances the Sales
// Navigator list to the next page until either a change is detected
// or no more pages exist.
const { clickNextPage } = require('../utils/nextPageNavigation');

// Expose a status endpoint so the frontend can determine the state of the
// scraper.  Returns { running, paused, url, listName, fileName, pageIndex }.

router.get('/status', (req, res) => {
  const currentId = scrapeSession.currentJobId;
  const currentJob = currentId ? getJob(currentId) : null;
  res.json({
    running: scrapeSession.isScraping,
    paused: scrapeSession.isPaused,
    currentJobId: currentId || null,
    job: currentJob ? {
      ...currentJob,
      stateReason: currentJob.stateReason || null,
      message: currentJob.message || null,
    } : null,
  });
});


// POST /api/stop
// Request the scraper to pause.  If no scrape is running, return an error.
router.post('/stop', (req, res) => {
  const jobId = scrapeSession.currentJobId;
  if (!scrapeSession.isScraping || !jobId || !jobs[jobId]) {
    return res.status(400).json({ error: 'No scrape is currently running.' });
  }
  scrapeSession.pauseRequested = true;
  // Mark job as pausing; runScrape will update to paused when it stops
  jobs[jobId].state = 'pausing';
  // Persist the job state change
  updateJob(jobId, { state: 'pausing' }).catch(() => { });
  return res.json({ message: 'Scrape will pause shortly.' });
});

// POST /api/resume
// Resume a previously paused scrape.  If no paused scrape exists, return an error.
router.post('/resume', (req, res) => {
  // Resume the current paused job
  const jobId = scrapeSession.currentJobId;
  if (!scrapeSession.isPaused || !jobId || !jobs[jobId]) {
    return res.status(400).json({ error: 'No paused scrape to resume.' });
  }
  jobs[jobId].state = 'running';
  // Persist the updated job state
  updateJob(jobId, { state: 'running' }).catch(() => { });
  scrapeSession.isPaused = false;
  scrapeSession.isScraping = true;
  scrapeSession.pauseRequested = false;
  // Kick off the scrape from the saved page index
  runScrape().catch((e) => {
    console.error('Resume scrape error:', e);
    scrapeSession.isScraping = false;
    scrapeSession.isPaused = false;
    jobs[jobId].state = 'paused';
  });
  return res.json({ message: 'Scrape resumed.' });
});

// File management API endpoints
const { listFiles, getFilePath, deleteFile } = require('../utils/dataManager');

// GET /api/files
// Return a list of CSV files currently stored in the data directory.
router.get('/files', async (req, res) => {
  try {
    const files = await listFiles();
    return res.json({ files });
  } catch (err) {
    console.error('files error:', err);
    return res.status(500).json({ error: 'Failed to list files.' });
  }
});

// GET /api/download/:fileName
// Stream a CSV file to the client.  Sets appropriate headers so the
// browser downloads the file rather than displaying it in‑line.
router.get('/download/:fileName', async (req, res) => {
  const { fileName } = req.params;
  try {
    const filePath = getFilePath(fileName);
    // Use res.download to automatically set headers and stream the file
    return res.download(filePath, fileName);
  } catch (err) {
    console.error('download error:', err);
    return res.status(500).json({ error: 'Failed to download file.' });
  }
});

// DELETE /api/delete/:fileName
// Delete a CSV file from the data directory.
router.delete('/delete/:fileName', async (req, res) => {
  const { fileName } = req.params;
  try {
    await deleteFile(fileName);
    return res.json({ message: 'File deleted successfully.' });
  } catch (err) {
    console.error('delete error:', err);
    return res.status(500).json({ error: 'Failed to delete file.' });
  }
});

// GET /api/jobs
// Return a list of all job objects.  Each job object includes its id,
// url, listName, timestamp, state, current page and file details.
router.get('/jobs', (req, res) => {
  try {
    // Use the jobsManager to retrieve the latest jobs.  Object.values
    // copies the array so that mutating the returned list does not
    // affect the internal cache.
    const list = Object.values(getJobs());
    return res.json({ jobs: list });
  } catch (err) {
    console.error('jobs list error:', err);
    return res.status(500).json({ error: 'Failed to list jobs.' });
  }
});

// POST /api/jobs/:id/run
// Start or resume a specific job.  If another job is running, it is
// paused first.  The target job is resumed from its saved page.
router.post('/jobs/:id/run', async (req, res) => {
  const { id } = req.params;
  // Look up the job via the persistence layer
  const job = jobs[id];
  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }
  // If this job is already running
  if (scrapeSession.currentJobId === id && scrapeSession.isScraping) {
    return res.json({ message: 'Job is already running.' });
  }
  // If another job is currently running, request it to pause and persist its state
  const currentId = scrapeSession.currentJobId;
  if (scrapeSession.isScraping && currentId && jobs[currentId]) {
    scrapeSession.pauseRequested = true;
    jobs[currentId].state = 'paused';
    jobs[currentId].pageIndex = jobs[currentId].pageIndex || 1;
    // Persist the pause state for the existing job
    updateJob(currentId, {
      state: 'paused',
      pageIndex: jobs[currentId].pageIndex,
    }).catch(() => { });
  }
  // Set this job as current and start/resume it
  scrapeSession.currentJobId = id;
  scrapeSession.isScraping = true;
  scrapeSession.isPaused = false;
  scrapeSession.pauseRequested = false;
  job.state = 'running';
  // Persist the updated state for this job
  updateJob(id, { state: 'running' }).catch(() => { });
  // Start scraping in the background
  runScrape().catch((e) => {
    console.error('Run job error:', e);
    scrapeSession.isScraping = false;
    scrapeSession.isPaused = false;
    job.state = 'paused';
    updateJob(id, { state: 'paused' }).catch(() => { });
  });
  return res.json({ message: 'Job started/resumed.' });
});

// POST /api/jobs/:id/stop
// Pause a specific job.  If the job is currently running, set a pause
// request.  Otherwise simply mark it as paused.
router.post('/jobs/:id/stop', (req, res) => {
  const { id } = req.params;
  const job = jobs[id];
  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }
  // If this job is the current running job
  if (scrapeSession.currentJobId === id && scrapeSession.isScraping) {
    scrapeSession.pauseRequested = true;
    job.state = 'pausing';
    // Persist the pausing state
    updateJob(id, { state: 'pausing' }).catch(() => { });
    return res.json({ message: 'Job will pause shortly.' });
  }
  // If the job is not currently running, mark it as paused
  job.state = 'paused';
  updateJob(id, { state: 'paused' }).catch(() => { });
  return res.json({ message: 'Job paused.' });
});

// Utility to compute a timestamp string for file names (YYYYMMDD_HHMMSS).
function timestampString() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    '_' +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

// Background task to perform scraping.  The job to run is determined by
// scrapeSession.currentJobId.  If a different job becomes current
// while this function is executing, the loop exits gracefully.  When
// paused, the job state is persisted and the browser context closed.
async function runScrape() {
  const jobId = scrapeSession.currentJobId;
  const job = jobs[jobId];
  if (!job) {
    scrapeSession.isScraping = false;
    scrapeSession.isPaused = false;
    return;
  }
  // Use the currentUrl to resume from a specific page.  If
  // undefined, fall back to the original URL.  The currentUrl is
  // updated after each page extraction.
  const { url, listName, filePath, currentUrl } = job;
  // Ensure cookie file exists
  const cookieFile = getCookieFilePath();
  if (!cookieFile) {
    scrapeSession.isScraping = false;
    scrapeSession.isPaused = false;
    job.state = 'paused';
    // Persist job state update
    await updateJob(jobId, {
      state: 'paused',
      pageIndex: job.pageIndex,
      currentUrl: job.currentUrl,
      totalRows: job.totalRows,
      totalContacts: job.totalContacts,
    }).catch(() => { });
    return;
  }
  // Launch browser
  const context = await launchStealthBrowser();
  try {
    // Ensure third‑party logins
    const coPath = path.join(__dirname, '..', 'contactout_cookies.json');
    const shPath = path.join(__dirname, '..', 'signalhire_cookies.json');
    let coRes;
    let shRes;
    try {
      coRes = await ensureContactOutLogin(context, coPath);
    } catch (err) {
      console.error('[contactout] login error:', err);
      coRes = { loggedIn: false, page: null };
    }
    try {
      shRes = await ensureSignalHireLogin(context, shPath);
    } catch (err) {
      console.error('[signalhire] login error:', err);
      shRes = { loggedIn: false, page: null };
    }
    // Close login tabs
    try {
      if (coRes && coRes.page) await coRes.page.close();
      if (shRes && shRes.page) await shRes.page.close();
    } catch { }
    if (!coRes?.loggedIn || !shRes?.loggedIn) {
      console.error('Third‑party login failed.');
      scrapeSession.isScraping = false;
      scrapeSession.isPaused = false;
      job.state = 'paused';
      // Persist paused state
      await updateJob(jobId, {
        state: 'paused',
        pageIndex: job.pageIndex,
        currentUrl: job.currentUrl,
        totalRows: job.totalRows,
        totalContacts: job.totalContacts,
      }).catch(() => { });
      return;
    }


    // Load LinkedIn cookies
    await addLinkedInCookies(context, cookieFile);

    // When resuming, navigate directly to the last scraped page if
    // available.  Otherwise start from the original URL.
    const startUrl = currentUrl || url;
    const liCheck = await checkLinkedInByUrl(context, startUrl);

    if (!liCheck.loggedIn) {

      console.error('LinkedIn cookie expired.');

      scrapeSession.isScraping = false;

      scrapeSession.isPaused = false;

      job.state = 'paused';

      job.stateReason = 'cookie_expired';

      job.message = 'LinkedIn cookie expired. Please update your cookie.';

      try { await context.close(); } catch { }

      await updateJob(jobId, {
        state: 'paused',
        stateReason: 'cookie_expired',
        message: 'LinkedIn cookie expired. Please update your cookie.',
        pageIndex: job.pageIndex,
        currentUrl: job.currentUrl,
        totalRows: job.totalRows,
        totalContacts: job.totalContacts,
      }).catch(() => { });
      return;
    }


    const page = liCheck.page;
    // When resuming, we jump directly to the previously saved page via
    // job.currentUrl.  Therefore we no longer need to click through
    // intermediate pages.  currentPage will be initialised to the
    // stored pageIndex below.
    // Reset totals when starting fresh; on resume keep running totals
    if (job.pageIndex === 1) {
      job.totalRows = 0;
      job.totalContacts = 0;
    }
    scrapeSession.isScraping = true;
    scrapeSession.isPaused = false;
    let currentPage = job.pageIndex;
    let continueScrape = true;
    while (continueScrape) {
      // Break immediately if this job is no longer active or a pause is requested
      if (scrapeSession.currentJobId !== jobId || scrapeSession.pauseRequested) {
        job.pageIndex = currentPage;
        job.state = 'paused';
        scrapeSession.isScraping = false;
        scrapeSession.isPaused = scrapeSession.pauseRequested;
        scrapeSession.pauseRequested = false;
        await context.close();
        // Persist paused state with current page and totals
        await updateJob(jobId, {
          pageIndex: job.pageIndex,
          state: 'paused',
          currentUrl: job.currentUrl,
          totalRows: job.totalRows,
          totalContacts: job.totalContacts,
        }).catch(() => { });
        return;
      }
      try {
        // Double‑check pause before starting SignalHire extraction
        if (scrapeSession.pauseRequested || scrapeSession.currentJobId !== jobId) {
          job.pageIndex = currentPage;
          job.state = 'paused';
          scrapeSession.isScraping = false;
          scrapeSession.isPaused = scrapeSession.pauseRequested;
          scrapeSession.pauseRequested = false;
          await context.close();
          await updateJob(jobId, {
            pageIndex: job.pageIndex,
            state: 'paused',
            currentUrl: job.currentUrl,
            totalRows: job.totalRows,
            totalContacts: job.totalContacts,
          }).catch(() => { });
          return;
        }
        // Scrape SignalHire
        let shRows = [];
        try {
          const result = await runSignalHire(page, {
            shCookiePath: shPath,
            coCookiePath: coPath,
            filePath: job.filePath,
          });
          shRows = (result && result.rows) || [];
          job.totalRows += shRows.length;
        } catch (shErr) {
          console.error('SignalHire scrape error:', shErr);
        }
        // Check again before running ContactOut
        if (scrapeSession.pauseRequested || scrapeSession.currentJobId !== jobId) {
          job.pageIndex = currentPage;
          job.state = 'paused';
          scrapeSession.isScraping = false;
          scrapeSession.isPaused = scrapeSession.pauseRequested;
          scrapeSession.pauseRequested = false;
          await context.close();
          await updateJob(jobId, {
            pageIndex: job.pageIndex,
            state: 'paused',
            currentUrl: job.currentUrl,
            totalRows: job.totalRows,
            totalContacts: job.totalContacts,
          }).catch(() => { });
          return;
        }
        // Scrape ContactOut if there are SignalHire rows
        if (Array.isArray(shRows) && shRows.length > 0) {
          try {
            // Ensure Email column exists
            await upgradeCsvAddEmailOnly(job.filePath).catch(() => { });
            const coResult = await runContactOut(page, {
              coCookiePath: coPath,
              shCookiePath: shPath,
            });
            const profiles = (coResult && coResult.profiles) || [];
            job.totalContacts += profiles.length;
            if (profiles.length > 0) {
              await mergeContactDomainsByNamePriority({
                baseCsvPath: job.filePath,
                contactProfiles: profiles,
                outPath: job.filePath,
                backup: false,
                overwrite: false,
              });
            }
            // After merging domains, deduplicate the CSV by LinkedIn URL
            const { deduplicateCsv } = require('../utils/deduplicateCsv');
            await deduplicateCsv(job.filePath).catch(() => { });
          } catch (coErr) {
            console.error('ContactOut scrape error:', coErr);
          }
        }
        // Check again after extraction before scrolling
        if (scrapeSession.pauseRequested || scrapeSession.currentJobId !== jobId) {
          job.pageIndex = currentPage;
          job.state = 'paused';
          scrapeSession.isScraping = false;
          scrapeSession.isPaused = scrapeSession.pauseRequested;
          scrapeSession.pauseRequested = false;
          await context.close();
          await updateJob(jobId, {
            pageIndex: job.pageIndex,
            state: 'paused',
            currentUrl: job.currentUrl,
            totalRows: job.totalRows,
            totalContacts: job.totalContacts,
          }).catch(() => { });
          return;
        }
        // Scroll page
        try {
          await salesDashBoardScroller(page, { minDelayMs: 400, maxDelayMs: 1000 });
        } catch (scrollErr) {
          console.warn('Scroll error:', scrollErr?.message || scrollErr);
        }
        // Random delay before next page
        try {
          const delaySeconds = nextDelaySecs(2, 5);
          await page.waitForTimeout(delaySeconds * 1000);
        } catch { }
        // Check again before moving to next page
        if (scrapeSession.pauseRequested || scrapeSession.currentJobId !== jobId) {
          job.pageIndex = currentPage;
          job.state = 'paused';
          scrapeSession.isScraping = false;
          scrapeSession.isPaused = scrapeSession.pauseRequested;
          scrapeSession.pauseRequested = false;
          await context.close();
          // Persist paused state with current page and totals
          await updateJob(jobId, {
            pageIndex: job.pageIndex,
            state: 'paused',
            currentUrl: job.currentUrl,
            totalRows: job.totalRows,
            totalContacts: job.totalContacts,
          }).catch(() => { });
          return;
        }
        // Advance page using the navigation helper.  The helper
        // returns 'moved' when the page changed, 'no-more' when
        // pagination ended and 'failed' when navigation failed.
        const navStatus = await clickNextPage(page, 1, currentPage);

        if (navStatus === 'moved') {
          currentPage++;
        }
        // Persist current page index on the job object for recovery
        job.pageIndex = currentPage;
        // Update the currentUrl to the page we just scraped.  This
        // ensures that when resuming a paused job, we can jump
        // directly to this page rather than clicking through pages.
        try {
          job.currentUrl = page.url();
        } catch {
          // ignore URL retrieval errors
        }
        // Persist page index, currentUrl and running totals after each iteration
        await updateJob(jobId, {
          pageIndex: job.pageIndex,
          currentUrl: job.currentUrl,
          totalRows: job.totalRows,
          totalContacts: job.totalContacts,
          state: job.state,
        }).catch(() => { });
        // Determine whether to continue scraping.  If navigation
        // failed, pause the job; if no more pages, complete; if
        // moved, continue.
        if (navStatus === 'failed') {
          // Mark as paused due to navigation failure
          job.state = 'paused';
          scrapeSession.isScraping = false;
          scrapeSession.isPaused = true;
          scrapeSession.pauseRequested = false;
          await context.close();
          // Persist paused state
          await updateJob(jobId, {
            state: 'paused',
            pageIndex: job.pageIndex,
            currentUrl: job.currentUrl,
            totalRows: job.totalRows,
            totalContacts: job.totalContacts,
          }).catch(() => { });
          return;
        }
        continueScrape = navStatus === 'moved';
      } catch (pageErr) {
        console.error('Scrape error on page', currentPage, ':', pageErr);
        continueScrape = false;
      }
    }

    // Finished all pages (keep the last page we reached)
    // job.pageIndex was already kept in-sync with `currentPage` inside the loop
    job.state = 'completed';
    scrapeSession.isScraping = false;
    scrapeSession.isPaused = false;
    await context.close();
    console.log('Scraping completed');

    // Persist final job state with the actual last page
    await updateJob(jobId, {
      pageIndex: job.pageIndex,      // <-- keep final page number
      state: 'completed',
      currentUrl: job.currentUrl,
      totalRows: job.totalRows,
      totalContacts: job.totalContacts,
    }).catch(() => { });



  } catch (err) {
    console.error('Unexpected scrape error:', err);
    scrapeSession.isScraping = false;
    scrapeSession.isPaused = false;
    job.state = 'paused';
    try {
      await context.close();
    } catch { }
    // Persist paused state on unexpected error
    await updateJob(jobId, {
      state: 'paused',
      pageIndex: job.pageIndex,
      currentUrl: job.currentUrl,
      totalRows: job.totalRows,
      totalContacts: job.totalContacts,
    }).catch(() => { });
  }
}


// POST /api/scrape
// Kick off a new scraping session.  Requires `url` and `listName` in the
// request body.  If another scrape is currently running or paused, the
// request is rejected.  The scrape runs in the background and the
// response indicates that it has started.
router.post('/scrape', async (req, res) => {
  const { url, listName } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required.' });
  }
  if (!listName || typeof listName !== 'string' || !listName.trim()) {
    return res.status(400).json({ error: 'List name is required.' });
  }
  const lower = url.toLowerCase();
  if (!lower.includes('linkedin.com') || !lower.includes('people')) {
    return res
      .status(400)
      .json({ error: 'Not valid, please use a valid LinkedIn Sales Navigator People URL.' });
  }

  // Ensure cookie file exists
  const cookieFile = getCookieFilePath();
  if (!cookieFile) {
    return res.status(400).json({ error: 'No cookie saved. Please upload a cookie first.' });
  }

  // If another job is currently running, request it to pause and persist its state
  const currentId = scrapeSession.currentJobId;
  if (scrapeSession.isScraping && currentId && jobs[currentId]) {
    scrapeSession.pauseRequested = true;
    jobs[currentId].state = 'paused';
    // Save current page index for the running job
    jobs[currentId].pageIndex = jobs[currentId].pageIndex || 1;
    // Persist the paused job's updated fields
    updateJob(currentId, {
      state: 'paused',
      pageIndex: jobs[currentId].pageIndex,
    }).catch(() => { });
  }
  // Create a new job
  const timestamp = timestampString();
  const slug = listName.replace(/\s+/g, '_');
  const jobId = `${slug}_${timestamp}`;
  const fileName = `${slug}_${timestamp}.csv`;
  const filePath = path.join(__dirname, '..', 'data', fileName);
  const job = {
    id: jobId,
    url,
    listName,
    timestamp,
    fileName,
    filePath,
    pageIndex: 1,
    totalRows: 0,
    totalContacts: 0,
    state: 'running',
    // Store the current page URL so that a paused job can resume
    // directly from the last scraped page rather than navigating from
    // the beginning.  Initially this is the provided URL.
    currentUrl: url,
  };
  // Persist the new job to disk and add it to the in‑memory map
  jobs[jobId] = job;
  try {
    await setJob(job);
  } catch {
    // swallow persistence errors; job will remain in memory
  }
  // Update session to this job
  scrapeSession.currentJobId = jobId;
  scrapeSession.isScraping = true;
  scrapeSession.isPaused = false;
  scrapeSession.pauseRequested = false;
  // Start scraping in the background
  runScrape().catch((e) => {
    console.error('Background scrape error:', e);
    scrapeSession.isScraping = false;
    scrapeSession.isPaused = false;
    if (jobs[jobId]) jobs[jobId].state = 'paused';
  });
  return res.json({ message: 'Scrape started', fileName, jobId });
});


// DELETE /api/jobs/:id
// Permanently delete a job (disk + cache). Block if running.
router.delete('/jobs/:id', async (req, res) => {
  const { id } = req.params;
  const job = getJob(id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  // Safer: don’t allow deletion while the job is running
  if (scrapeSession.currentJobId === id && scrapeSession.isScraping) {
    return res.status(409).json({ error: 'Job is running. Stop it first, then delete.' });
  }

  try {
    const { deleteJobFile } = require('../utils/jobsManager');
    await deleteJobFile(id);  // removes JSON file and evicts from jobsCache
    return res.json({ message: 'Job deleted.' });
  } catch (e) {
    console.error('Delete job error:', e);
    return res.status(500).json({ error: 'Failed to delete job.' });
  }
});


module.exports = router;