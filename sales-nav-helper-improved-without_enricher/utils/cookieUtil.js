// utils/cookieUtil.js

const fs = require('fs');

// Minimal helper to load a Chrome-exported cookie JSON and convert to Playwright.

function normalizeSameSite(v) {
  if (v == null) return undefined; // allow omitting
  const s = String(v).toLowerCase();
  if (s === 'no_restriction' || s === 'none') return 'None';
  if (s === 'lax') return 'Lax';
  if (s === 'strict') return 'Strict';
  if (s === 'unspecified') return undefined;
  return undefined; // drop any unknown values
}

function loadAndConvert(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return raw.map((c) => ({
    name: c.name,
    value: String(c.value ?? ''),
    domain: c.domain, // ".example.com" or "example.com" both fine
    path: c.path || '/',
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    // Playwright wants seconds (int) and usually omit for session cookies
    expires:
      typeof c.expirationDate === 'number' && !c.session
        ? Math.floor(c.expirationDate)
        : undefined,
    sameSite: normalizeSameSite(c.sameSite),
  }));
}

module.exports = { loadAndConvert };