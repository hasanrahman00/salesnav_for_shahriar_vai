// server.js 
// entry file

const path = require('path');
const express = require('express');

// Create the Express application.  This app serves the static frontend
// assets out of the `public` folder and exposes two API routes for
// saving a cookie and triggering a scrape.  Keeping all of the route
// handlers in separate files (under the routes folder) makes the
// application easier to reason about and maintain.
const app = express();



// Middleware to parse JSON bodies.  Without this, Express will not
// understand the JSON sent from the frontend.
app.use(express.json({ limit: '10mb' }));

// Serve the compiled frontend assets from the `public` directory.  Any
// static files (HTML, CSS, JS) placed under `public` will be served
// relative to the root of the web server.
app.use(express.static(path.join(__dirname, 'public')));

// Ensure the data directory exists and perform an initial cleanup of old files.
const { ensureDataDir, cleanupOldFiles } = require('./utils/dataManager');

ensureDataDir().catch(() => {});
// Clean up files older than 3 days on startup.  Failure to delete old
// files will not stop the server.
cleanupOldFiles().catch(() => {});

// -----------------------------------------------------------------------------
// Jobs persistence on startup
//
// The scraping jobs are persisted across server restarts via JSON files in
// the `all_jobs` directory.  At startup we ensure the directory exists,
// load any existing jobs into memory, and clean up job files older than
// three days.  These asynchronous operations are fire‑and‑forget; any
// failures (e.g. permission errors) are ignored so that the server still
// starts.  The loaded jobs will be available via the jobsManager API.
const {
  ensureJobsDir,
  loadJobs,
  cleanupOldJobs,
} = require('./utils/jobsManager');

ensureJobsDir().catch(() => {});

loadJobs().catch(() => {});

cleanupOldJobs().catch(() => {});

// Register API routes.  The route files only handle API paths and
// should return JSON.  Mount them under the `/api` prefix so they do
// not collide with frontend paths.
app.use('/api', require('./routes/cookieRoutes'));

app.use('/api', require('./routes/scrapeRoutes'));

// The browser and third‑party login checks are performed lazily within
// the scrape route.  We intentionally avoid launching a browser at
// startup so that the application does not open windows until the user
// initiates a scrape.

// Catch‑all handler to return the frontend for any unknown route.  This
// allows direct browser navigation to a deep link (e.g. `/about`) and
// still serves the SPA.  A wildcard route of '*' is not valid in
// Express; using a wildcard pattern with a leading slash matches all
// paths that have not been served by previous middleware.
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the HTTP server on the configured port.  The port can be
// supplied via the `PORT` environment variable or defaults to 3000.
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});