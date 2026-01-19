// utils/saveProfilesCsv.js
//
// A robust CSV writer for SignalHire and ContactOut profile objects.  This
// helper inspects existing CSV headers to choose the correct set of
// columns, supports BOM handling, and can append to existing files
// without corrupting column order.  Values are safely escaped so
// that commas, quotes and newlines do not break the CSV structure.

const fs = require('fs/promises');
const { existsSync, createReadStream } = require('fs');
const path = require('path');
const readline = require('readline');

// Base columns from SignalHire (use snake_case for names and domain)
const BASE_COLUMNS = [
  { key: 'name', header: 'Name' },
  { key: 'first_name', header: 'First Name' },
  { key: 'last_name', header: 'Last Name' },
  { key: 'title', header: 'Title' },
  { key: 'company', header: 'Company' },
  { key: 'person_location', header: 'Location' },
  { key: 'person_title', header: 'LinkedIn URL' },
];
// Column variants
// Include a single `domain` column instead of domain1/domain2/domain3.
const EXT_DOMAIN = [...BASE_COLUMNS, { key: 'domain', header: 'Website' }];
const EXT_DOMAIN_EMAIL = [...EXT_DOMAIN, { key: 'Email', header: 'Email' }];
const EXT_EMAIL = [...BASE_COLUMNS, { key: 'Email', header: 'Email' }];

function esc(value) {
  if (value == null) return '""';
  const s = String(value)
    .replace(/\u0000/g, '')
    .replace(/\r?\n/g, ' ')
    .trim();
  return '"' + s.replace(/"/g, '""') + '"';
}

async function readHeaderLine(filePath) {
  if (!existsSync(filePath)) return null;
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const first = await new Promise((resolve) => {
    rl.once('line', (line) => resolve(line));
    rl.once('close', () => resolve(null));
  });
  rl.close();
  return first;
}

function chooseColumnsForExistingHeader(headerLine) {
  const lc = (headerLine || '').toLowerCase();
  // Determine whether an existing file has a domain column or old domain1/domain2 columns
  const hasDomain = lc.includes('domain') || lc.includes('website');
  const hasDomain1 = lc.includes('domain1');
  const hasDomain2 = lc.includes('domain2');
  const hasEmail = lc.includes('email');
  // If the file already uses the new domain column
  if (hasDomain && hasEmail) return EXT_DOMAIN_EMAIL;
  if (hasDomain) return EXT_DOMAIN;
  // If the file uses old domain1/domain2 columns, preserve them
  if (hasDomain1 && hasDomain2 && hasEmail) return [...BASE_COLUMNS, { key: 'domain1', header: 'domain1' }, { key: 'domain2', header: 'domain2' }, { key: 'Email', header: 'Email' }];
  if (hasDomain1 && hasDomain2) return [...BASE_COLUMNS, { key: 'domain1', header: 'domain1' }, { key: 'domain2', header: 'domain2' }];
  if (hasDomain1 && hasEmail) return [...BASE_COLUMNS, { key: 'domain1', header: 'domain1' }, { key: 'Email', header: 'Email' }];
  if (hasDomain1) return [...BASE_COLUMNS, { key: 'domain1', header: 'domain1' }];
  if (hasEmail) return EXT_EMAIL;
  return BASE_COLUMNS;
}

function ensureKeysForColumns(rows, columns) {
  for (const r of rows) {
    for (const c of columns) {
      if (!Object.prototype.hasOwnProperty.call(r, c.key)) {
        r[c.key] = '';
      }
    }
  }
}

/**
 * Save an array of profile objects to CSV.  The function
 * automatically determines whether to append or write a new file
 * based on the `append` option and whether the file already
 * exists.  When appending, the existing header is used to
 * maintain column order.  When creating a new file, a sensible
 * default header (including domain1 and Email) is chosen.  A BOM
 * may be prepended for Excel compatibility.  Missing keys are
 * added to rows as empty strings.
 *
 * @param {Object[]} rows Array of profile objects
 * @param {Object} opts Options
 * @param {string} opts.filePath Output CSV file path
 * @param {boolean} [opts.append] Whether to append to existing file; default: true if file exists
 * @param {boolean} [opts.includeBOM=true] Whether to include a BOM
 * @returns {Promise<string>} Absolute path to the saved file
 */
async function saveProfilesCsv(rows, opts = {}) {
  const { filePath = path.resolve(process.cwd(), 'output.csv'), append, includeBOM = true } = opts;
  if (!rows || rows.length === 0) return path.resolve(filePath);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const fileExists = existsSync(filePath);
  const shouldAppend = append === true || (append === undefined && fileExists);
  let columns;
  if (fileExists) {
    const headerLine = await readHeaderLine(filePath);
    columns = chooseColumnsForExistingHeader(headerLine);
  } else {
    // New files: include domain and Email columns
    columns = EXT_DOMAIN_EMAIL;
  }
  ensureKeysForColumns(rows, columns);
  const header = columns.map((c) => esc(c.header || c.key)).join(',') + '\r\n';
  const body =
    rows
      .map((r) => columns.map((c) => esc(r[c.key] ?? '')).join(','))
      .join('\r\n') + '\r\n';
  if (shouldAppend) {
    if (!fileExists) {
      const prefix = includeBOM ? '\uFEFF' : '';
      await fs.appendFile(filePath, prefix + header + body);
    } else {
      await fs.appendFile(filePath, body);
    }
  } else {
    const prefix = includeBOM ? '\uFEFF' : '';
    await fs.writeFile(filePath, prefix + header + body);
  }
  return path.resolve(filePath);
}

module.exports = { saveProfilesCsv, COLUMNS: EXT_DOMAIN_EMAIL };