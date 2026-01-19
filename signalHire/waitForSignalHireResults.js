// signalHire/waitForSignalHireResults.js
//
// After the SignalHire sidebar has been opened, wait until the
// results list has rendered.  SignalHire displays each result as
// a <li> with a specific class name.  This helper waits for the
// first result to become visible with a generous timeout.  If
// nothing appears within the timeout, the caller should handle
// the error (e.g. by retrying or refreshing the page).

const TIMEOUT = 8_000;

module.exports = async function waitForSignalHireResults(page) {
  // Each result row is rendered as a list item with a unique class
  const listItem = page.locator('li._1VGRZDYbh').first();
  await listItem.waitFor({ state: 'visible', timeout: TIMEOUT });
};