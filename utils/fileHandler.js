//utils/fileHandler.js


const fs = require('fs');
const path = require('path');

// Directory where the LinkedIn cookie will be persisted.  This folder
// lives alongside the rest of the application code so that it can be
// checked into version control if desired.  The folder is created on
// demand; it does not exist until the first cookie is saved.
const cookiesDir = path.join(__dirname, '..', 'cookies');
const cookieFileName = 'linkedin_cookies.json';

/**
 * Ensure that the cookie directory exists.  If it does not, it will
 * be created.  Using the recursive option prevents errors if
 * intermediate directories are missing.
 */
function ensureDir() {
  if (!fs.existsSync(cookiesDir)) {
    fs.mkdirSync(cookiesDir, { recursive: true });
  }
}

/**
 * Persist a LinkedIn cookie to disk.  The input must be a string
 * containing a JSON array of cookie objects.  If the input cannot
 * be parsed or is not an array, an error is thrown.  Any existing
 * cookie file will be replaced with the new contents; only one
 * LinkedIn cookie file is retained at any time.
 *
 * @param {string} cookieText Raw JSON string representing an array of cookies
 * @returns {string} Absolute path to the saved cookie file
 */
function saveCookieFile(cookieText) {
  ensureDir();
  let parsed;
  try {
    parsed = JSON.parse(cookieText);
    if (!Array.isArray(parsed)) {
      throw new Error('Cookie data should be a JSON array');
    }
  } catch (err) {
    throw new Error('Invalid cookie JSON: ' + err.message);
  }
  const filePath = path.join(cookiesDir, cookieFileName);
  fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2));
  return filePath;
}

/**
 * Retrieve the absolute path to the persisted LinkedIn cookie file.
 * If no cookie has been saved yet, null is returned.
 *
 * @returns {string|null}
 */
function getCookieFilePath() {
  const filePath = path.join(cookiesDir, cookieFileName);
  return fs.existsSync(filePath) ? filePath : null;
}

/**
 * Delete the persisted LinkedIn cookie file from disk.  If the
 * file does not exist, the function simply returns without error.
 * This helper is used by the delete-cookie API route to allow
 * users to remove their stored cookies.
 */
function deleteCookieFile() {
  const filePath = path.join(cookiesDir, cookieFileName);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

module.exports = { saveCookieFile, getCookieFilePath, deleteCookieFile };