// public/app.js

// Frontend logic for the Sales Nav Helper.  This file wires up
// listeners on the buttons to call the backend API routes.  Basic
// validation is performed before sending data to the server.
document.addEventListener('DOMContentLoaded', () => {
  const cookieInput = document.getElementById('cookie');
  const saveBtn = document.getElementById('saveBtn');
  const deleteCookieBtn = document.getElementById('deleteCookieBtn');
  const statusEl = document.getElementById('status');
  const listNameInput = document.getElementById('listName');
  const urlInput = document.getElementById('url');
  const runBtn = document.getElementById('runBtn');
  const stopBtn = document.getElementById('stopBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const jobsBtn = document.getElementById('jobsBtn');
  const outEl = document.getElementById('out');

  // Track scraping state
  let isRunning = false;
  let isPaused = false;

  // Helper to refresh status from server
async function refreshStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data) {
      isRunning = !!data.running;
      const jobPaused = data.job && data.job.state === 'paused';
      isPaused = !!data.paused || jobPaused;
      updateButtons();

      // ✅ NEW: check for backend message (like cookie expired)
      if (data.job && data.job.message) {
        outEl.textContent = data.job.message;
        if (data.job.stateReason === 'cookie_expired') {
          outEl.style.color = 'red'; // highlight warning
        } else {
          outEl.style.color = '';
        }
      } else if (isRunning) {
        outEl.textContent = 'Scraping is running…';
        outEl.style.color = '';
      } else if (isPaused) {
        outEl.textContent = 'Scraping is paused.';
        outEl.style.color = '';
      } else {
        outEl.textContent = '';
        outEl.style.color = '';
      }
    }
  } catch {
    // ignore
  }
}


  // Update button states and labels based on running/paused
  function updateButtons() {
    // Allow starting a new job even if paused; disable only when running
    runBtn.disabled = isRunning;
    if (isRunning) {
      stopBtn.textContent = 'Stop';
      stopBtn.disabled = false;
    } else if (isPaused) {
      stopBtn.textContent = 'Start';
      stopBtn.disabled = false;
    } else {
      // When no job is running or paused, allow stop to start/resume current paused job (if any)
      stopBtn.textContent = 'Stop';
      stopBtn.disabled = true;
    }
  }

  // On page load, query cookie status and scraping status
  (async () => {
    try {
      const res = await fetch('/api/cookie-status');
      const data = await res.json();
      if (data && data.message) {
        statusEl.textContent = data.message;
      }
    } catch {}
    // Refresh scraping status
    await refreshStatus();
  })();

  // Save cookie handler
  saveBtn.addEventListener('click', async () => {
    const text = cookieInput.value.trim();
    statusEl.textContent = '';
    if (!text) {
      statusEl.textContent = 'Please paste your LinkedIn cookie JSON.';
      return;
    }
    try {
      const res = await fetch('/api/save-cookie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie: text }),
      });
      const data = await res.json();
      statusEl.textContent = data.message || data.error || '';
    } catch (err) {
      statusEl.textContent = 'Error: ' + (err.message || err);
    }
  });

  // Delete cookie handler
  deleteCookieBtn.addEventListener('click', async () => {
    statusEl.textContent = '';
    try {
      const res = await fetch('/api/delete-cookie', { method: 'DELETE' });
      const data = await res.json();
      statusEl.textContent = data.message || data.error || '';
      // Refresh cookie status after deletion
      try {
        const res2 = await fetch('/api/cookie-status');
        const data2 = await res2.json();
        if (data2 && data2.message) {
          statusEl.textContent = data2.message;
        }
      } catch {}
    } catch (err) {
      statusEl.textContent = 'Error: ' + (err.message || err);
    }
  });

  // Run scraper handler
  runBtn.addEventListener('click', async () => {
    // Allow starting a new job even if another job is paused.  Only
    // disable starting when a job is currently running.  When a job
    // is paused, creating a new job will automatically pause the
    // paused job and start the new one on the backend.
    if (isRunning) return;
    const url = urlInput.value.trim();
    const listName = listNameInput.value.trim();
    outEl.textContent = '';
    // Validate inputs
    if (!listName) {
      outEl.textContent = 'Please enter a list name.';
      return;
    }
    if (!url.toLowerCase().includes('people')) {
      outEl.textContent = 'Not valid, please use a valid LinkedIn Sales Navigator People URL.';
      return;
    }
    try {

      
      // Start scrape
      isRunning = true;
      isPaused = false;
      updateButtons();
      outEl.textContent = 'Scraping is running…';
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, listName }),
      });


      const data = await res.json();
      if (res.ok) {
        outEl.textContent = data.message || 'Scrape started.';
      } else {
        outEl.textContent = data.error || 'Error occurred.';
        // Reset state if error
        isRunning = false;
        isPaused = false;
        updateButtons();
      }
    } catch (err) {
      outEl.textContent = 'Error: ' + (err.message || err);
      isRunning = false;
      isPaused = false;
      updateButtons();
    }
  });

  // Stop/Resume handler
  stopBtn.addEventListener('click', async () => {
    // If running, request stop
    if (isRunning) {
      try {
        const res = await fetch('/api/stop', { method: 'POST' });
        const data = await res.json();
        outEl.textContent = data.message || '';
        // Immediately reflect paused state; actual pause will update backend
        isRunning = false;
        isPaused = true;
        updateButtons();
      } catch (err) {
        outEl.textContent = 'Error: ' + (err.message || err);
      }
    } else if (isPaused) {
      // Resume paused scrape
      try {
        const res = await fetch('/api/resume', { method: 'POST' });
        const data = await res.json();
        outEl.textContent = data.message || '';
        isRunning = true;
        isPaused = false;
        updateButtons();
      } catch (err) {
        outEl.textContent = 'Error: ' + (err.message || err);
      }
    }
  });

  // Download button handler – navigate to download page
  downloadBtn.addEventListener('click', () => {
    window.location.href = 'download.html';
  });

  // All Jobs button handler – navigate to the All Jobs page
  jobsBtn.addEventListener('click', () => {
    window.location.href = 'all-jobs.html';
  });
});