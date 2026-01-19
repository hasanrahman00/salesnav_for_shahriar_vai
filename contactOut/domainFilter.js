// contactOut/domainFilter.js
//
// Filter out personal email domains and deduplicate business domains.
// When extracting email addresses from ContactOut, you often get a
// mixture of personal and corporate emails.  This helper retains only
// business domains, removes duplicates and optionally caps the
// number of domains returned.

// If available, use the free-email-domains package for a comprehensive
// list of personal domains.  Otherwise fall back to a small built‑in
// set of common free providers.
let freeEmailDomains;
try {
  freeEmailDomains = require('free-email-domains');
} catch {
  // Fallback list if the library is not installed
  freeEmailDomains = [
    'gmail.com',
    'yahoo.com',
    'hotmail.com',
    'outlook.com',
    'aol.com',
    'icloud.com',
    'protonmail.com',
    'gmx.com',
    'mail.com',
    'yandex.com',
  ];
}
const PERSONAL = new Set(freeEmailDomains.map((d) => d.toLowerCase()));

function getDomain(email) {
  const at = email.lastIndexOf('@');
  return at === -1 ? null : email.slice(at + 1).toLowerCase();
}

function filterBusinessDomains(rawEmails, limit = 3) {
  const domains = [];
  for (const email of rawEmails) {
    const domain = getDomain(email);
    if (!domain) continue;
    if (PERSONAL.has(domain)) continue;
    if (!domains.includes(domain)) domains.push(domain);
    if (domains.length === limit) break;
  }
  return domains;
}

module.exports = { filterBusinessDomains };