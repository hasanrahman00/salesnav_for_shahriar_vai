// utils/deduplicateCsv.js
//
// This helper removes duplicate rows from a CSV file based on
// a specified key column.  By default it uses the LinkedIn URL
// column (under several aliases) as the unique key.  When
// duplicates are found, only the first occurrence is kept.
// Missing or empty keys are treated as unique entries and kept.

const fs = require('fs/promises');
// Note: csv-parse and csv-stringify may not always be installed in
// environments where this helper is used.  We require them lazily
// inside the function and fallback gracefully if the modules are
// missing.

/**
 * Deduplicate a CSV file by a unique key column.  The function
 * reads the CSV, builds a set of seen keys and writes back the
 * deduplicated rows.  If the file does not exist or cannot be
 * parsed, the function silently returns without error.
 *
 * @param {string} filePath Absolute path to the CSV file
 * @param {Array<string>} [keyAliases] Possible column names for the unique key
 */
async function deduplicateCsv(filePath, keyAliases = ['LinkedIn URL', 'LinkedIn', 'person_title']) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    // Lazily require the CSV parsers.  If the modules are missing,
    // skip deduplication.
    let parse;
    let stringify;
    try {
      parse = require('csv-parse/sync').parse;
      stringify = require('csv-stringify/sync').stringify;
    } catch {
      // Modules not available; cannot deduplicate
      return;
    }
    const rows = parse(raw, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
      // Allow variable column counts
      relax_column_count: true,
    });
    if (!rows.length) return;
    // Determine the column to use for deduplication.  Use the first
    // alias that exists in the header row.  If none are present,
    // deduplication cannot proceed.
    const header = Object.keys(rows[0]);
    let keyCol = null;
    for (const alias of keyAliases) {
      const found = header.find((h) => h.toLowerCase() === alias.toLowerCase());
      if (found) {
        keyCol = found;
        break;
      }
    }
    if (!keyCol) {
      // No matching key column; cannot deduplicate
      return;
    }
    const seen = new Set();
    const deduped = [];
    for (const row of rows) {
      const key = (row[keyCol] || '').toString().trim().toLowerCase();
      if (!key) {
        // Keep rows without a key
        deduped.push(row);
        continue;
      }
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(row);
    }
    // Write back the deduplicated CSV preserving original header order
    const csv = stringify(deduped, { header: true, columns: header, bom: true });
    await fs.writeFile(filePath, csv);
  } catch (err) {
    // Ignore file not found or parse errors
    // console.warn('deduplicateCsv error:', err.message || err);
  }
}

module.exports = { deduplicateCsv };