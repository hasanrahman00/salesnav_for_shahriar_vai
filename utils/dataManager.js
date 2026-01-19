// utils/dataManager.js
//
// Helper functions to manage the storage of CSV files under the
// `data/` directory.  This module ensures the directory exists,
// lists available files, returns full file paths, deletes files on
// request and cleans up old files automatically.  Keeping this
// functionality in a single module makes it easy to adjust the
// retention policy or change the storage location in the future.

const fs = require('fs/promises');
const path = require('path');

// Resolve the data directory relative to this utils folder.  The
// directory will be created on demand if it does not exist.
const dataDir = path.join(__dirname, '..', 'data');

/**
 * Ensure that the data directory exists.  If it does not exist,
 * create it.  This should be called before reading or writing files
 * in the directory.
 */
async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

/**
 * List all files currently stored in the data directory.  Returns
 * an array of file names (not full paths).  Only files are
 * returned; subdirectories (if any) are ignored.
 */
async function listFiles() {
  await ensureDataDir();
  const entries = await fs.readdir(dataDir, { withFileTypes: true });
  return entries.filter((ent) => ent.isFile()).map((ent) => ent.name);
}

/**
 * Return the absolute path to a file in the data directory.  Does
 * not check whether the file exists.
 *
 * @param {string} fileName The name of the file
 */
function getFilePath(fileName) {
  return path.join(dataDir, fileName);
}

/**
 * Delete a file from the data directory.  If the file does not
 * exist, the promise resolves without error.
 *
 * @param {string} fileName The name of the file to delete
 */
async function deleteFile(fileName) {
  try {
    await fs.unlink(getFilePath(fileName));
  } catch (err) {
    // If the file is not found, ignore the error
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}

/**
 * Remove any files older than the specified number of days from the
 * data directory.  Useful for housekeeping so that stale CSVs do
 * not accumulate indefinitely.  Files are considered old if their
 * last modification time is older than `days` days ago.
 *
 * @param {number} [days=3] The age threshold in days
 */
async function cleanupOldFiles(days = 3) {
  const now = Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const files = await listFiles();
  for (const file of files) {
    try {
      const fullPath = getFilePath(file);
      const stat = await fs.stat(fullPath);
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(fullPath);
      }
    } catch (e) {
      // Ignore errors (e.g. file deleted concurrently)
    }
  }
}

module.exports = {
  ensureDataDir,
  listFiles,
  getFilePath,
  deleteFile,
  cleanupOldFiles,
  dataDir,
};