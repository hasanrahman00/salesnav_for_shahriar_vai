# Sales Nav Scraper Documentation

This document provides an overview of the **Sales Nav Scraper** project, detailing its architecture, file structure and operation.  The scraper automates LinkedIn Sales Navigator lead extraction and enriches the results using the SignalHire and ContactOut Chrome extensions.  It also includes a persistent job system, CSV management and a polished front‑end interface.

## Overview

Sales Nav Scraper is a full‑stack Node.js application.  Users paste their LinkedIn cookie, specify a Sales Navigator people URL and a list name, then start the scraper.  The backend launches a stealthy Chrome instance via Playwright Extra, injects cookies for LinkedIn and third‑party extensions, navigates pages, extracts leads, enriches them with contact domains and writes everything to a CSV file.  Jobs can be paused and resumed, and multiple jobs are persisted on disk so they survive restarts.  The front‑end UI is clean and SaaS‑like, with gradient colours, wide inputs, centred titles and helpful messages.

### Key Features

* **Stealth automation** – The scraper uses Playwright Extra with the stealth plugin to avoid detection.  It stores cookies in a persistent context (`user_data/`) so sessions are retained across runs.  Browser extensions for SignalHire and ContactOut are loaded from the `extensions/` directory.
* **Modular scrapers** – Individual modules orchestrate the SignalHire and ContactOut sidebars.  These modules locate the extension toggle buttons, verify login status (with re‑authentication fallbacks), wait for result cards, extract and clean profile data, and write or merge CSV rows.
* **Persistent jobs** – Every scrape is represented by a job object stored as a JSON file in the `all_jobs/` directory.  Jobs record the original URL, current page index, current page URL, list name, file name, totals and state (`running`, `paused`, `completed`).  A `jobsManager` module loads jobs on server startup, saves updates and cleans up jobs older than three days.  Only one job runs at a time; starting a new job automatically pauses any current job.
* **Robust pause/resume** – A running job can be paused via the *Stop* button.  The job’s state and current URL are saved.  When resumed, the scraper navigates directly to the saved page URL rather than clicking through previous pages.  Jobs paused because of errors are marked as `paused`, not `completed`.
* **Automatic pagination with retries** – After extracting data from a page, the scraper scrolls down (human‑like), waits a random delay and clicks the **Next** button using a helper that retries up to three times.  If navigation fails repeatedly, the job is paused for later resumption.  Only when all pages are successfully scraped is the job marked as `completed`.
* **CSV handling with deduplication** – SignalHire rows are written to CSV via a robust writer that chooses headers dynamically and always includes a single `domain` column and an `Email` column.  ContactOut domains are merged into existing rows by name, populating the `domain` field (only one business domain per row).  A `deduplicateCsv` helper removes duplicate entries based on the LinkedIn URL column.  CSV files live in the `data/` folder and are automatically deleted after three days.
* **Cookie management** – A cookie file is stored in `cookies/`.  Users can save a new cookie (replacing the old one) or delete the existing cookie via the UI.  The backend exposes `/api/save-cookie`, `/api/cookie-status` and `/api/delete-cookie` routes.
* **Clean UI** – The front‑end uses the Google DM Sans font, gradient backgrounds and generous spacing.  Titles (including “Sales Nav Scraper”) are centred.  Inputs for list name and URL are wide and separated by adequate margins.  A tagline encourages responsible scraping.  Buttons are gradient‑coloured with clear states.  The All Jobs and Download pages sort items by newest first, so the latest job and file appear at the top.
* **Download and file management** – A `dataManager` module lists and deletes CSV files and cleans old files.  The download page shows each file’s list name, row/contact counts and provides download/delete buttons.  Files are named `<slug>_<timestamp>.csv` (e.g. `myList_20250921_221125.csv`).

## Project Structure

```
sales-nav-helper/
├── server.js                    # Express application entry point
├── package.json                 # Metadata and dependencies
├── routes/                      # API endpoints
│   ├── cookieRoutes.js          # Save/check/delete LinkedIn cookie
│   └── scrapeRoutes.js          # Start/stop/resume jobs, manage files and jobs
├── public/                      # Front‑end HTML/JS/CSS
│   ├── index.html               # Main interface: cookies & scraping controls
│   ├── download.html            # Lists CSV files for download/deletion
│   ├── all-jobs.html            # Displays saved jobs with run/stop actions
│   ├── app.js                   # Client logic for index page
│   ├── download.js              # Client logic for download page (sorts files)
│   ├── all-jobs.js              # Client logic for jobs page (sorts jobs)
│   └── style.css                # Shared styling (DM Sans, gradients, spacing)
├── utils/                       # Backend helpers
│   ├── browser.js               # Launches Playwright with stealth & extensions
│   ├── fileHandler.js           # Save/get/delete LinkedIn cookie file
│   ├── linkedin_login.js        # Injects LinkedIn cookies and checks login
│   ├── signalhire_login.js      # Injects SignalHire cookies and checks login
│   ├── contactout_login.js      # Injects ContactOut cookies and checks login
│   ├── randomDelayer.js         # Generates human‑like random delays
│   ├── waitForLeadList.js       # Waits for Sales Navigator list to load
│   ├── salesDashBoardScroller.js# Smoothly scrolls the lead list like a human
│   ├── nextPageNavigation.js    # Clicks “Next” with retries, returns status
│   ├── saveProfilesCsv.js       # Writes SignalHire rows to CSV (snake_case names; includes domain & Email)
│   ├── mergeContactDomains.js   # Merges ContactOut domains into CSV by name (uses domain column)
│   ├── deduplicateCsv.js        # Removes duplicate CSV rows by LinkedIn URL
│   ├── upgradeCsvAddEmailOnly.js# Ensures an Email column exists on older CSVs
│   ├── nameCleaner.js           # Cleans and splits person names
│   ├── cleanCompanyName.js      # Normalises and cleans company names
│   ├── dataManager.js           # Manages `data/` directory (list/delete/cleanup)
│   ├── jobsManager.js           # Persists jobs in `all_jobs/` and cleans old ones
│   └── cookieUtil.js            # Normalises Chrome‑exported cookies for Playwright
├── signalHire/                  # SignalHire scraping modules
│   ├── index.js                 # Orchestration: wait, click, extract, dedup & save
│   ├── clickSignalHireToggle.js # Finds and clicks the SignalHire toggle button
│   ├── waitForSignalHireResults.js # Waits for results in the sidebar
│   ├── extractSignalHireProfiles.js # Extracts and cleans profile data from sidebar
│   └── checkSignalHireLoggedIn.js # Detects if login screen is shown
├── contactOut/                  # ContactOut scraping modules
│   ├── index.js                 # Orchestration: wait, click, extract & dedup
│   ├── clickContactOutToggle.js # Finds and clicks the ContactOut floating button
│   ├── waitForContactOutResults.js # Waits for contact cards to appear
│   ├── collectProfiles.js       # Extracts names and business domains, dedupes
│   └── checkContactOutLoggedIn.js # Detects if login/signup page is shown
├── cookies/                     # Persisted LinkedIn cookie JSON
├── data/                        # CSV files generated by scrapes (auto‑cleaned)
├── all_jobs/                    # Persisted job JSON files (auto‑cleaned)
└── extensions/                  # Unpacked Chrome extensions for SignalHire and ContactOut

```

### Core Components

#### Server (`server.js`)

Initialises the Express application, sets up JSON body parsing and static file serving, ensures the `data/` and `all_jobs/` directories exist, cleans up old files and jobs on startup, and loads persisted jobs into memory using `jobsManager.loadJobs()`.  It mounts the route handlers (`cookieRoutes` and `scrapeRoutes`) and serves the front‑end files.  The server listens on port 3000.

#### Routes

* **cookieRoutes.js** – Provides API endpoints to save a LinkedIn cookie (`POST /api/save-cookie`), check cookie status (`GET /api/cookie-status`) and delete the cookie (`DELETE /api/delete-cookie`).  Cookies are stored under `cookies/linkedin_cookies.json` and only one cookie is kept at a time.
* **scrapeRoutes.js** – Implements all scraper logic and job management:
  * `POST /api/scrape` – Validates inputs, pauses any running job, creates a new job with a unique ID and timestamp, persists it via `jobsManager.setJob()`, sets the session state and launches the asynchronous `runScrape()` function.
  * `POST /api/stop` – Pauses the current job by setting a flag; the background scraper checks this flag and gracefully stops, saving the job’s `pageIndex`, `currentUrl` and totals.
  * `POST /api/resume` – Resumes the current job from the saved `currentUrl` and `pageIndex`.  The job state is switched back to `running` and the scraper restarts.
  * `GET /api/status` – Returns the scraper’s running/paused state and details about the current job (including URL, list name, page index and totals) so the UI can display status messages.
  * `GET /api/files`, `GET /api/download/:fileName`, `DELETE /api/delete/:fileName` – Use the `dataManager` to list CSV files, stream a file for download, or delete it.
  * `GET /api/jobs`, `POST /api/jobs/:id/run`, `POST /api/jobs/:id/stop` – List all persisted jobs, resume a specific paused job (pausing any running job first), or pause a job.  The front‑end *All Jobs* page uses these endpoints to display jobs and allow users to run or stop them individually.

#### Scraping Workflow

The `runScrape()` function in `scrapeRoutes.js` manages the scraping process:

1. **Preparation** – Looks up the current job, ensures a LinkedIn cookie is present, loads third‑party cookies and verifies SignalHire and ContactOut logins.  If logins fail, the job is paused and the user is asked to refresh cookies.
2. **Resume logic** – Navigates to `job.currentUrl` if resuming; otherwise starts with the original Sales Navigator URL.  The job’s `totalRows` and `totalContacts` counters are reset on a fresh run.
3. **Per‑page loop** – Until no more pages remain or a pause is requested:
   * Wait for the Sales Navigator lead list (`waitForLeadList`) and random delay.
   * Run the SignalHire orchestration (`signalHire/index.js`) to open the sidebar, verify login, extract rows, deduplicate by LinkedIn URL and write to CSV via `saveProfilesCsv.js`.
   * If any SignalHire rows were extracted, ensure the CSV has an Email column via `upgradeCsvAddEmailOnly()`, run the ContactOut orchestration (`contactOut/index.js`) to extract contact domains, merge them into the CSV via `mergeContactDomainsByNamePriority()`, and deduplicate the CSV with `deduplicateCsv.js`.
   * Scroll the page using `salesDashBoardScroller()` and wait a random delay from `randomDelayer.nextDelaySecs()`.
   * Attempt to click the **Next** button using `nextPageNavigation.clickNextPage()`, which retries up to three times.  The function returns `'moved'` (page changed), `'no-more'` (no more pages) or `'failed'` (navigation failure).  On failure, the job is paused; on no‑more, the job is marked completed.
   * After each page, update and persist `job.pageIndex`, `job.currentUrl`, `job.totalRows`, `job.totalContacts` and `job.state` using `jobsManager.updateJob()`.
4. **Completion** – When all pages are scraped, reset `pageIndex` to 1, mark the job as `completed`, close the browser context and persist the final state.  Unexpected errors result in the job being paused.

#### Utility Modules

* **browser.js** – Wraps Playwright Extra to launch a persistent context with the stealth plugin and loads unpacked extensions.  Accepts custom arguments to hide automation indicators.
* **fileHandler.js** – Saves the LinkedIn cookie JSON array to `cookies/linkedin_cookies.json`, retrieves the path and deletes it on request.  Ensures only one cookie file exists.
* **linkedin_login.js** – Adds LinkedIn cookies to the browser context and verifies login by checking for login/sign‑in URLs.  Provides `addLinkedInCookies()` and `checkLinkedInByUrl()`.
* **signalhire_login.js** / **contactout_login.js** – Load cookies for their respective extensions into the context and navigate to profile pages to verify login.  Each returns an object with `loggedIn` and the page used for login.
* **randomDelayer.js** – Exposes `nextDelaySecs(min, max)` and `waitRandomIncreasing(page)` to insert random human‑like delays between actions.
* **waitForLeadList.js** – Waits for the Sales Navigator results list to be visible and ensures at least ten leads load to avoid partial lists.
* **salesDashBoardScroller.js** – Scrolls a container element by small increments with random delays to trigger lazy loading and mimic natural scrolling.
* **nextPageNavigation.js** – Clicks the Next button with retries.  It detects “No leads matched your search” messages, disabled buttons and timeouts and returns a status used by `runScrape()`.
* **saveProfilesCsv.js** – Writes an array of profile objects to a CSV file.  It chooses column headers based on existing files, preserves domain columns and includes a UTF‑8 BOM.  Supports appending or overwriting.
* **mergeContactDomains.js** – Reads a base CSV, matches rows by cleaned full/first/last name and inserts the first business domain into the `domain` column.  Clears any legacy `domain1`, `domain2` or `domain3` columns.
* **deduplicateCsv.js** – Removes duplicate rows from a CSV file.  By default it uses the LinkedIn URL column (aliases: “LinkedIn URL”, “LinkedIn” or “person_title”) as the unique key.  Keeps the first occurrence and discards subsequent duplicates.
* **upgradeCsvAddEmailOnly.js** – Ensures old CSVs contain an “Email” column.  It rewrites the header and adds empty values for missing emails; used when ContactOut is integrated into older files.
* **nameCleaner.js** and **cleanCompanyName.js** – Clean raw names (remove titles, prefixes, suffixes) and company names (remove legal/generic terms), returning canonical values and splitting first/last names.
* **dataManager.js** – Manages the `data/` directory where CSV files are stored.  Exposes `ensureDataDir()`, `listFiles()` (now returning sorted lists), `getFilePath()`, `deleteFile()` and `cleanupOldFiles()`.
* **jobsManager.js** – Manages job persistence in `all_jobs/`.  Provides `loadJobs()`, `setJob()`, `updateJob()`, `getJobs()`, `getJob()`, `deleteJobFile()` and `cleanupOldJobs()`.  Jobs include `id`, `url`, `listName`, `timestamp`, `fileName`, `filePath`, `pageIndex`, `totalRows`, `totalContacts`, `currentUrl` and `state`.
* **cookieUtil.js** – Converts Chrome‑exported cookie objects into the format Playwright expects and normalises `sameSite` values.

### SignalHire Modules

* **signalHire/index.js** – Orchestrates the SignalHire extension: waits for the Sales Navigator list, opens the sidebar by clicking the extension toggle, checks login status (re‑authenticates if necessary), waits for results, extracts profile data (name, title, company, location, LinkedIn URL) and deduplicates rows by URL.  Inserts delays before extraction and uses `saveProfilesCsv.js` to append rows to the CSV.
* **clickSignalHireToggle.js** – Searches the main frame and all iframes for the SignalHire toggle button (`<button><img alt="SH" …>`), waits for it to be visible and clicks it using both DOM and Playwright strategies.  Falls back to scanning new frames until the button is found.
* **waitForSignalHireResults.js** – Waits up to eight seconds for the first result card (`li._1VGRZDYbh`) to become visible in the page or any extension frame.  Throws a TimeoutError if not found.
* **extractSignalHireProfiles.js** – Extracts details from each SignalHire card.  It scrolls the sidebar until the number of cards stabilises, collects raw text and attribute values, cleans names and company names, splits first/last names and returns an array of profile objects.  Ensures each row has a `domain` field and an `Email` field for CSV consistency.
* **checkSignalHireLoggedIn.js** – Detects if the SignalHire sidebar shows a login or sign‑in prompt by inspecting the DOM for specific elements.  Used by the orchestrator to re‑authenticate when necessary.

### ContactOut Modules

* **contactOut/index.js** – Controls the ContactOut extension: waits for the Sales Navigator list, opens the ContactOut sidebar via a floating button, checks login state (re‑authenticates if necessary), waits for contact cards, extracts profiles (full name, first name, last name, business domains) and deduplicates them.  Returns the profiles for merging into the CSV.
* **clickContactOutToggle.js** – Locates and clicks the ContactOut floating button using several selectors (`#floating-button`, `[data-testid="contactout-floating-button"]`, etc.).  Searches the main frame and extension iframes, waits for attachment and uses JS/Playwright click strategies.
* **waitForContactOutResults.js** – Waits up to 15 seconds for contact cards (`div[data-testid="contact-information"]`) to appear in any frame.  Throws if no cards appear.
* **collectProfiles.js** – Extracts raw names and email addresses from each contact card, cleans names with `nameCleaner.js` and filters out free email domains using `domainFilter.js`.  Returns deduplicated profile objects with `fullName`, `firstName`, `lastName` and an array of up to three business domains.
* **checkContactOutLoggedIn.js** – Detects if the ContactOut sidebar displays a sign‑in or sign‑up prompt by checking for specific buttons/headers.  Used by the orchestrator to re‑authenticate when necessary.

## Front‑End Interface

### Main Page (`index.html`)

The main page contains two sections: **Cookies** and **Sales Navigator**.  The cookie section includes a centred title, a text area to paste the LinkedIn cookie JSON array, and buttons to save or delete the cookie.  The UI shows a message when a cookie already exists so users know they don’t need to re‑paste it.  The Sales Navigator section includes inputs for **List Name** and **Sales Nav URL** (both wide with proper spacing) and a row of buttons: *Run Scraper*, *Stop/Start*, *Download* (navigates to the download page) and *All Jobs* (navigates to the jobs page).  A status message area displays real‑time updates such as “Scraping is running…”, “Scraping paused.” or “Scraping completed.”  A tagline at the bottom of the page reads “Extract unlimited number leads without LinkedIn account suspension.”

### All Jobs Page (`all-jobs.html`)

Lists all persisted jobs from `all_jobs/` in a simple table layout.  Columns include **List Name**, **Page** (the current page index), **Status** (running, paused or completed) and **Actions**.  Each row has *Run* and *Stop* buttons: *Run* resumes a paused job from its saved page, automatically pausing any running job; *Stop* pauses the job.  Jobs are sorted by their timestamps so the most recent job appears at the top.  The **Back** button returns to the main page.

### Download Page (`download.html`)

Displays CSV files stored in the `data/` directory.  Each row shows the **List Name** (derived from the job metadata), **Records** (total SignalHire rows / total ContactOut profiles), and buttons to *Download* or *Delete* the file.  Files are sorted by timestamp (newest first).  The page uses the same styling as the main interface and provides a **Back** button to return to the main page.

## Extending and Maintaining

* **Adding new extensions** – To integrate another extension (e.g. a different contact finder), create a new directory under `extensions/` with the unpacked extension code, implement login helpers in `utils/`, and build a new orchestrator similar to `signalHire/index.js` or `contactOut/index.js` that handles toggling, login detection, waiting for results and extracting data.  Integrate it into the scrape loop in `runScrape()`.
* **Adjusting delays** – Modify parameters in `randomDelayer.js` (e.g. `nextDelaySecs()` range) or `salesDashBoardScroller.js` to simulate faster or slower human behaviour.  Increase retry counts in `nextPageNavigation.js` for slower networks.
* **Debugging login failures** – Ensure the cookie file is up‑to‑date and exported from a logged‑in browser.  If an extension fails to login, update the cookies in `extensions/signalhire` or `extensions/contacout` (JSON exported from Chrome).  Use the login helpers’ console logs to identify authentication issues.
* **Customising the UI** – Edit `public/style.css` to adjust colours, fonts or spacing.  Modify `public/app.js`, `public/all-jobs.js` or `public/download.js` to change button behaviour or add new features.  The UI uses minimal dependencies and vanilla JS for ease of maintenance.
* **Housekeeping** – Job and file cleanups are performed automatically on server startup.  You can adjust the retention period by changing the `days` argument in `cleanupOldFiles()` and `cleanupOldJobs()` calls in `server.js`.

## Conclusion

Sales Nav Scraper provides a robust, extensible platform for harvesting LinkedIn Sales Navigator leads and enriching them with contact data.  Its modular architecture, persistent job management, deduplication, thorough error handling and modern UI make it suitable for production use and further development.  Use this documentation as a guide to navigate the codebase, extend functionality and troubleshoot issues.