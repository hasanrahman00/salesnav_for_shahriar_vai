// public/all-jobs.js

// Script to display all saved scraper jobs and allow resuming or stopping them.

document.addEventListener('DOMContentLoaded', () => {
  const jobListEl = document.getElementById('jobList');
  const backBtn = document.getElementById('backBtn');

  // Load jobs from the server
  async function loadJobs() {
    jobListEl.textContent = 'Loading jobs…';
    try {
      const res = await fetch('/api/jobs');
      const data = await res.json();
      if (!res.ok) {
        jobListEl.textContent = data.error || 'Failed to load jobs.';
        return;
      }
      let jobs = data.jobs || [];
      // Sort jobs so the most recent (by timestamp) appear first.  Jobs are created
      // with a timestamp string (YYYYMMDD_HHMMSS) which sorts lexically.  Use
      // this timestamp when available, falling back to fileName to preserve
      // chronology across slugs.  Newest jobs will appear at the top of the list.
      jobs = jobs.sort((a, b) => {
        // Compare by timestamp if both have it
        if (a.timestamp && b.timestamp) {
          return b.timestamp.localeCompare(a.timestamp);
        }
        // Otherwise compare by fileName which includes timestamp at the end
        return (b.fileName || '').localeCompare(a.fileName || '');
      });
      if (jobs.length === 0) {
        jobListEl.textContent = 'No jobs yet.';
        return;
      }
      // Render table-like header
      jobListEl.innerHTML = '';
      const header = document.createElement('div');
      header.className = 'job-row job-header';
      ['List Name', 'Page', 'Status', 'Actions'].forEach((txt) => {
        const span = document.createElement('span');
        span.className = 'job-col';
        span.textContent = txt;
        header.appendChild(span);
      });
      jobListEl.appendChild(header);
      jobs.forEach((job) => {
        const row = document.createElement('div');
        row.className = 'job-row';
        // List name column
        const nameCol = document.createElement('span');
        nameCol.className = 'job-col';
        nameCol.textContent = job.listName;
        // Page column
        const pageCol = document.createElement('span');
        pageCol.className = 'job-col';
        pageCol.textContent = job.pageIndex;
        // Status column
        const statusCol = document.createElement('span');
        statusCol.className = 'job-col';
        statusCol.textContent = job.state;

        // Actions column
        const actionsCol = document.createElement('span');

        actionsCol.className = 'job-col job-actions';

        const runBtn = document.createElement('button');

        runBtn.textContent = 'Run';

        runBtn.disabled = job.state === 'running';

        runBtn.addEventListener('click', async () => {
          try {
            const resRun = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/run`, {
              method: 'POST',
            });

            const dat = await resRun.json();

            alert(dat.message || dat.error || 'Started job.');
            loadJobs();

          } catch (err) {
            alert('Error: ' + (err.message || err));
          }
        });

        const stopBtn = document.createElement('button');

        stopBtn.textContent = 'Stop';

        stopBtn.disabled = job.state !== 'running';

        stopBtn.addEventListener('click', async () => {
          try {
            const resStop = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/stop`, {
              method: 'POST',
            });

            const dat = await resStop.json();

            alert(dat.message || dat.error || 'Stopped job.');

            loadJobs();

          } catch (err) {
            alert('Error: ' + (err.message || err));
          }
        });


        // NEW: Delete button (disabled while running)

        const deleteBtn = document.createElement('button');

        deleteBtn.textContent = 'Delete';

        deleteBtn.disabled = job.state === 'running';

        deleteBtn.addEventListener('click', async () => {
          if (!confirm(`Delete job "${job.listName}"? This cannot be undone.`)) return;
          try {
            const resDel = await fetch(`/api/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' });

            const dat = await resDel.json();

            if (!resDel.ok) return alert(dat.error || 'Failed to delete job.');

            alert(dat.message || 'Job deleted.');

            loadJobs(); // refresh list

          } catch (err) {
            alert('Error: ' + (err.message || err));
          }
        });



        actionsCol.appendChild(runBtn);
        actionsCol.appendChild(stopBtn);
        actionsCol.appendChild(deleteBtn);

        // Append columns to row
        row.appendChild(nameCol);
        row.appendChild(pageCol);
        row.appendChild(statusCol);
        row.appendChild(actionsCol);
        jobListEl.appendChild(row);
      });
    } catch (err) {
      jobListEl.textContent = 'Error loading jobs.';
    }
  }

  loadJobs();

  backBtn.addEventListener('click', () => {
    window.location.href = '/';
  });
});