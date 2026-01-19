// public/download.js
// Script to list available CSV files and provide download and delete actions.

document.addEventListener('DOMContentLoaded', () => {
  const fileListEl = document.getElementById('fileList');
  const backBtn = document.getElementById('backBtn');

  // Fetch and render list of files
  async function loadFiles() {
    fileListEl.innerHTML = 'Loading files…';
    try {
      // Fetch available files
      const resFiles = await fetch('/api/files');
      const dataFiles = await resFiles.json();
      if (!resFiles.ok) {
        fileListEl.textContent = dataFiles.error || 'Failed to load files.';
        return;
      }
      let files = dataFiles.files || [];
      // Sort files so that the newest (latest timestamp) appear first.  File names
      // are of the form `<slug>_YYYYMMDD_HHMMSS.csv`.  Extract the timestamp
      // portion and sort descending so that the latest downloads are at the top.
      files = files.sort((a, b) => {
        const tsA = (a.match(/_(\d{8}_\d{6})\.csv$/) || [])[1] || '';
        const tsB = (b.match(/_(\d{8}_\d{6})\.csv$/) || [])[1] || '';
        if (tsA && tsB) {
          return tsB.localeCompare(tsA);
        }
        return b.localeCompare(a);
      });
      // Fetch job metadata to correlate list names and counts
      let jobMap = {};
      try {
        const resJobs = await fetch('/api/jobs');
        const dataJobs = await resJobs.json();
        if (resJobs.ok && Array.isArray(dataJobs.jobs)) {
          dataJobs.jobs.forEach((j) => {
            jobMap[j.fileName] = j;
          });
        }
      } catch {}
      if (files.length === 0) {
        fileListEl.textContent = 'No files available.';
        return;
      }
      // Render table header
      fileListEl.innerHTML = '';
      const header = document.createElement('div');
      header.className = 'file-row file-header';
      // Display header columns: List Name, Records (rows/contacts), Download, Delete
      ['List Name', 'Records', 'Download', 'Delete'].forEach((txt) => {
        const span = document.createElement('span');
        span.className = 'file-col';
        span.textContent = txt;
        header.appendChild(span);
      });
      fileListEl.appendChild(header);
      // Render file rows with list name, counting data, and actions
      files.forEach((file) => {
        const row = document.createElement('div');
        row.className = 'file-row';
        // List name column
        const nameCol = document.createElement('span');
        nameCol.className = 'file-col';
        const job = jobMap[file];
        nameCol.textContent = job ? job.listName : file;
        // Counting data column: totalRows/totalContacts
        const countCol = document.createElement('span');
        countCol.className = 'file-col';
        if (job) {
          const total = job.totalRows || 0;
          const contacts = job.totalContacts || 0;
          countCol.textContent = `${total}/${contacts}`;
        } else {
          countCol.textContent = '-';
        }
        // Download button
        const downloadCol = document.createElement('span');
        downloadCol.className = 'file-col';
        const downloadBtn = document.createElement('button');
        downloadBtn.textContent = 'Download';
        downloadBtn.addEventListener('click', () => {
          window.location.href = `/api/download/${encodeURIComponent(file)}`;
        });
        downloadCol.appendChild(downloadBtn);
        // Delete button
        const deleteCol = document.createElement('span');
        deleteCol.className = 'file-col';
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', async () => {
          if (!confirm(`Delete ${file}?`)) return;
          try {
            const delRes = await fetch(`/api/delete/${encodeURIComponent(file)}`, {
              method: 'DELETE',
            });
            const delData = await delRes.json();
            alert(delData.message || delData.error || 'Deleted.');
            loadFiles();
          } catch (err) {
            alert('Error: ' + (err.message || err));
          }
        });
        deleteCol.appendChild(deleteBtn);
        // Append columns to row
        row.appendChild(nameCol);
        row.appendChild(countCol);
        row.appendChild(downloadCol);
        row.appendChild(deleteCol);
        fileListEl.appendChild(row);
      });
    } catch (err) {
      fileListEl.textContent = 'Error loading files.';
    }
  }

  // Load files on page load
  loadFiles();

  // Back button returns to home page
  backBtn.addEventListener('click', () => {
    window.location.href = '/';
  });
});