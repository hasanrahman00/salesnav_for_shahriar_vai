// utils/cleanCompanyName.js
//
// Normalise company names by stripping legal suffixes, common
// business words and miscellaneous punctuation.  This helper
// converts names to title‑case and handles optional truncation at
// symbols.  It is designed to be robust yet easy to understand.

// A collection of patterns representing legal entity designators.
const LEGAL_SUFFIXES = [
  // US / generic
  'incorporated',
  'inc\\.?',
  'corp\\.?',
  'corporation',
  'co\\.?',
  'company',
  'llc',
  'l\\.l\\.c\\.',
  'ltd\\.?',
  'limited',
  'lp',
  'l\\.p\\.',
  'llp',
  'l\\.l\\.p\\.',
  'pc',
  'p\\.c\\.',
  // UK
  'plc',
  'p\\.l\\.c\\.',
  // Canada / generic FR‑CA
  'société\\s+par\\s+actions',
  // Australia
  'pty\\s*ltd\\.?',
  // Germany
  'gmbh',
  'ag',
  // France
  'sarl',
  'sa',
  'sas',
  // India
  'pvt\\s*ltd\\.?',
];

// Non‑legal but common “fluff” words that you want removed anywhere.
const GENERIC_BUSINESS_WORDS = [
  'group',
  'enterprise',
  'enterprises?',
  'industry',
  'industries',
  'holding',
  'holdings',
  'international',
  'solution',
  'solutions?',
  'system',
  'systems',
  'technology',
  'technologies',
  'venture',
  'ventures',
  'partner',
  'partners',
  'service',
  'services',
  'associate',
  'associates',
  'global',
  'network',
  'consulting',
  'logistics',
  'media',
  'labs?',
];

// Build one big regex for speed.
const LEGAL_RE = new RegExp(`\\b(?:${LEGAL_SUFFIXES.join('|')})\\b`, 'gi');
const GENERIC_RE = new RegExp(`\\b(?:${GENERIC_BUSINESS_WORDS.join('|')})\\b`, 'gi');

// Capitalise the first letter of each word while lowercasing the rest.
function titleCase(s) {
  return s.replace(/\b\w+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * Clean a raw company name string according to a set of rules.
 *
 * @param {string} raw Raw company name
 * @param {Object} [opts]
 * @param {boolean} [opts.truncateAtAnySymbol=false] If true, cut at the first non‑alphanumeric symbol (except space).
 * @returns {string}
 */
function cleanCompanyName(raw, opts = {}) {
  if (!raw) return '';
  const { truncateAtAnySymbol = false } = opts;
  let s = raw.normalize('NFKC').replace(/\p{Extended_Pictographic}/gu, ' ');
  // Remove anything from the first bracket onward
  s = s.replace(/[\(\[\{].*$/u, ' ');
  // Remove dotted abbreviations like "s.r.o.", "b.v.", "s.a." (2+ single letters with dots)
  s = s.replace(/\b(?:[A-Za-z]\.){2,}[A-Za-z]?\.?/g, ' ');
  // Remove everything after first comma or dot
  s = s.replace(/[.,].*$/u, ' ');
  // Remove trailing single‑letter token (e.g., "... CZ s")
  s = s.replace(/\s*\b[A-Za-z]\b\s*$/g, ' ');
  if (truncateAtAnySymbol) {
    const m = s.match(/[^0-9A-Za-z\s].*/u);
    if (m && m.index !== undefined) s = s.slice(0, m.index);
  }
  // Remove legal suffixes and generic words
  s = s.replace(LEGAL_RE, ' ');
  s = s.replace(GENERIC_RE, ' ');
  // Remove leftover punctuation/symbols, collapse spaces, title‑case
  s = s
    .replace(/[^0-9A-Za-z\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return titleCase(s);
}

module.exports = { cleanCompanyName };