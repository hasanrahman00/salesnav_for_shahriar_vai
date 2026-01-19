// routes/cookieRoutes.js

const express = require('express');
const router = express.Router();

// The fileHandler module encapsulates all logic around persisting the
// LinkedIn cookie to disk.  Keeping this logic in one place avoids
// scattering file system calls throughout your route handlers.
const { saveCookieFile, getCookieFilePath, deleteCookieFile } = require('../utils/fileHandler');

// POST /api/save-cookie
// Accepts a JSON object with a `cookie` property containing the raw
// LinkedIn cookie JSON array.  The cookie is parsed and written to
// disk; on success a message is returned to the caller.  Errors are
// caught and logged to aid in debugging during development.
router.post('/save-cookie', async (req, res) => {
  try {
    const { cookie } = req.body;
    if (!cookie || typeof cookie !== 'string') {
      return res
        .status(400)
        .json({ error: 'Invalid cookie payload. Expecting a JSON string.' });
    }
    saveCookieFile(cookie);
    return res.json({ message: 'Cookie saved successfully.' });
  } catch (err) {
    console.error('save-cookie error:', err);
    return res
      .status(500)
      .json({ error: err.message || 'Failed to save cookie.' });
  }
});

// GET /api/cookie-status
// Returns whether a LinkedIn cookie file is already present on disk and a
// corresponding message.  The frontend can call this endpoint on
// page load to determine whether the user needs to paste a new
// cookie.  This endpoint does not read the cookie contents.
router.get('/cookie-status', (req, res) => {
  try {
    const exists = !!getCookieFilePath();
    if (exists) {
      return res.json({
        hasCookie: true,
        message: 'You already have cookies. No need to paste new cookie.',
      });
    }
    return res.json({
      hasCookie: false,
      message: 'No cookie found. Please paste your LinkedIn cookie JSON.',
    });
  } catch (err) {
    console.error('cookie-status error:', err);
    return res.status(500).json({ error: err.message || 'Failed to check cookie status.' });
  }
});

module.exports = router;

// DELETE /api/delete-cookie
// Removes the persisted LinkedIn cookie file if it exists.  The
// frontend can call this endpoint when the user clicks the Delete
// Cookie button.  A success message is returned even if the file
// did not exist.
router.delete('/delete-cookie', (req, res) => {
  try {
    deleteCookieFile();
    return res.json({ message: 'Cookie deleted successfully.' });
  } catch (err) {
    console.error('delete-cookie error:', err);
    return res.status(500).json({ error: err.message || 'Failed to delete cookie.' });
  }
});