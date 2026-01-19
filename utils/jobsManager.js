// utils/jobsManager.js
//
// A helper module to manage persistent scraper job state.  Jobs are
// persisted as JSON files under the `all_jobs` directory so that
// paused or completed jobs survive server restarts.  The manager
// maintains an in-memory cache of jobs and keeps the cache in sync
// with the file system.

const fs = require('fs/promises');
const path = require('path');

// Directory where job state JSON files are stored.  Located one
// level up from utils to avoid polluting the codebase.  Files are
// named `<jobId>.json` and contain the serialized job object.
const jobsDir = path.join(__dirname, '..', 'all_jobs');

// In-memory cache of jobs, keyed by jobId.  This cache is populated
// on server startup by `loadJobs()` and updated whenever jobs are
// created or modified.  The cache is not automatically persisted
// until `setJob()` or `updateJob()` is called.
let jobsCache = {};

/**
 * Ensure that the jobs directory exists.  If it does not exist,
 * create it.  This should be called before reading or writing job
 * files.
 */
async function ensureJobsDir() {
  await fs.mkdir(jobsDir, { recursive: true });
}

/**
 * Load all job JSON files from the jobs directory into the in-memory
 * cache.  Each file is parsed and its contents stored under the
 * corresponding jobId.  If parsing fails for a file, it will be
 * skipped.  Returns the jobs cache.
 */
async function loadJobs() {
  await ensureJobsDir();
  const files = await fs.readdir(jobsDir).catch(() => []);
  const jobs = {};
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const jobId = file.replace(/\.json$/i, '');
    try {
      const raw = await fs.readFile(path.join(jobsDir, file), 'utf8');
      const job = JSON.parse(raw);
      // Ensure the job's id matches the file name for consistency
      if (job && typeof job === 'object') {
        job.id = job.id || jobId;
        jobs[job.id] = job;
      }
    } catch (e) {
      // Ignore malformed job files
      console.warn('jobsManager: failed to load job', file, ':', e.message);
    }
  }
  jobsCache = jobs;
  return jobsCache;
}

/**
 * Save a single job object to the file system and update the cache.
 * The job's id property is used to determine the file name.
 *
 * @param {Object} job The job object to persist
 */
async function saveJob(job) {
  if (!job || !job.id) throw new Error('Invalid job object');
  await ensureJobsDir();
  const filePath = path.join(jobsDir, `${job.id}.json`);
  const json = JSON.stringify(job, null, 2);
  await fs.writeFile(filePath, json, 'utf8');
  jobsCache[job.id] = job;
}

/**
 * Delete a job file from disk and remove it from the cache.  If the
 * file does not exist, the promise resolves without error.
 *
 * @param {string} jobId The id of the job to delete
 */
async function deleteJobFile(jobId) {
  if (!jobId) return;
  const filePath = path.join(jobsDir, `${jobId}.json`);
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  delete jobsCache[jobId];
}

/**
 * Delete job files older than the specified number of days from the
 * jobs directory.  This helps to prevent stale job records from
 * accumulating indefinitely.
 *
 * @param {number} [days=3] Number of days after which jobs should be deleted
 */
async function cleanupOldJobs(days = 3) {
  const now = Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  await ensureJobsDir();
  const files = await fs.readdir(jobsDir).catch(() => []);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(jobsDir, file);
    try {
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(filePath);
        const jobId = file.replace(/\.json$/i, '');
        delete jobsCache[jobId];
      }
    } catch (e) {
      // Ignore errors for concurrent deletions
    }
  }
}

/**
 * Get the current in-memory jobs map.  This map is updated when
 * jobs are loaded or saved.
 */
function getJobs() {
  return jobsCache;
}

/**
 * Retrieve a job by its id from the cache.
 *
 * @param {string} jobId The job id
 */
function getJob(jobId) {
  return jobsCache[jobId] || null;
}

/**
 * Add or replace a job in the cache and persist it to disk.
 *
 * @param {Object} job The job object to store
 */
async function setJob(job) {
  await saveJob(job);
}

/**
 * Update an existing job with new properties and persist the
 * modifications.  Only own enumerable properties of the updates
 * object are applied.
 *
 * @param {string} jobId The id of the job to update
 * @param {Object} updates Partial fields to merge into the job
 */
async function updateJob(jobId, updates) {
  if (!jobId) return;
  const job = jobsCache[jobId] || {};
  Object.assign(job, updates);
  await saveJob(job);
}

module.exports = {
  jobsDir,
  ensureJobsDir,
  loadJobs,
  cleanupOldJobs,
  getJobs,
  getJob,
  setJob,
  updateJob,
  deleteJobFile,
};