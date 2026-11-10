// Dashboard: list, filter, sort, add, edit, delete and take notes on applications.
(function () {
  const STATUSES = ['Applied', 'Interview', 'Offer', 'Rejected'];

  const state = {
    status: '', // '' means all statuses
    sort: 'date_desc',
    applications: [],
    total: 0,
    openNotes: new Set(), // ids of rows with the notes panel open
    editingId: null, // null while adding, an id while editing
    deletingId: null,
  };

  // ---------- Elements ----------
  const $ = (id) => document.getElementById(id);
  const rowsEl = $('app-rows');
  const emptyEl = $('empty-state');
  const resultNote = $('result-note');
  const sortSelect = $('sort-select');
  const stageButtons = document.querySelectorAll('.stage');

  const appDialog = $('app-dialog');
  const appForm = $('app-form');
  const appFormError = $('app-form-error');
  const dialogTitle = $('dialog-title');
  const saveBtn = $('save-btn');

  const deleteDialog = $('delete-dialog');
  const deleteText = $('delete-text');
  const confirmDeleteBtn = $('confirm-delete-btn');

  // ---------- Helpers ----------

  // Build an element with properties and children, without touching innerHTML,
  // so text typed by the user can never run as HTML.
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null) continue;
      if (key === 'className') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, value);
    }
    for (const child of [].concat(children)) {
      if (child) node.append(child);
    }
    return node;
  }

  // 'YYYY-MM-DD' -> Date at local midnight (new Date('2026-01-05') would be UTC).
  function parseDay(value) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function todayString() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function formatDate(value) {
    return parseDay(value).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function daysAgo(value) {
    const today = parseDay(todayString());
    const days = Math.round((today - parseDay(value)) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 0) return `In ${-days} day${days === -1 ? '' : 's'}`;
    if (days < 7) return `${days} days ago`;
    const weeks = Math.floor(days / 7);
    if (days < 60) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
    const months = Math.floor(days / 30);
    return `${months} months ago`;
  }

  let toastTimer;
  function toast(message, isError = false) {
    const t = $('toast');
    t.textContent = message;
    t.classList.toggle('is-error', isError);
    t.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-visible'), 2800);
  }

  function showFormError(message) {
    appFormError.textContent = message;
    appFormError.classList.add('is-visible');
  }

  function clearFormError() {
    appFormError.textContent = '';
    appFormError.classList.remove('is-visible');
  }

  // ---------- Loading data ----------

  async function loadUser() {
    const { user } = await api('/api/auth/me');
    $('user-name').textContent = user.name;
  }

  async function loadSummary() {
    const { counts, total } = await api('/api/applications/summary');
    for (const status of STATUSES) {
      document.querySelector(`[data-count="${status}"]`).textContent = counts[status];
    }
    document.querySelector('[data-count="total"]').textContent = total;
    state.total = total;
  }

  async function loadApplications() {
    const params = new URLSearchParams({ sort: state.sort });
    if (state.status) params.set('status', state.status);
    const { applications } = await api(`/api/applications?${params}`);
    state.applications = applications;
    render();
  }

  async function refresh() {
    try {
      await Promise.all([loadSummary(), loadApplications()]);
    } catch (err) {
      toast(err.message, true);
    }
  }

  // ---------- Rendering ----------

  function render() {
    const apps = state.applications;

    stageButtons.forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.status === state.status));
    });

    resultNote.textContent = '';
    if (state.status) {
      resultNote.append(
        `Showing ${apps.length} ${state.status.toLowerCase()} application${apps.length === 1 ? '' : 's'}.`,
        el('button', { type: 'button', className: 'clear-filter', text: 'Show all', onClick: () => setFilter('') })
      );
    } else if (apps.length) {
      resultNote.textContent = `${apps.length} application${apps.length === 1 ? '' : 's'}`;
    }

    rowsEl.replaceChildren(...apps.flatMap(buildRows));
    renderEmpty(apps.length === 0);
  }

  function renderEmpty(isEmpty) {
    emptyEl.hidden = !isEmpty;
    rowsEl.closest('table').hidden = isEmpty;
    if (!isEmpty) return;

    if (state.status) {
      emptyEl.replaceChildren(
        el('h2', { text: `Nothing in ${state.status} right now` }),
        el('p', { text: 'When an application moves to this stage, it will show up here.' }),
        el('button', { type: 'button', className: 'btn btn-secondary', text: 'Show all applications', onClick: () => setFilter('') })
      );
    } else {
      emptyEl.replaceChildren(
        el('h2', { text: 'No applications yet' }),
        el('p', { text: 'Add the jobs you have applied to and track each one from application to offer.' }),
        el('button', { type: 'button', className: 'btn btn-primary', text: 'Add your first application', onClick: () => openForm() })
      );
    }
  }

  function buildRows(app) {
    const isOpen = state.openNotes.has(app.id);
    const notesId = `notes-${app.id}`;

    // Company, role and job link
    const main = el('td', { className: 'cell-main' }, [
      el('div', { className: 'cell-company', text: app.company }),
      el('div', { className: 'cell-role', text: app.role }),
      app.job_url
        ? el('a', {
            className: 'job-link',
            href: app.job_url,
            target: '_blank',
            rel: 'noopener noreferrer',
            text: 'Open job post',
          })
        : null,
    ]);

    const date = el('td', { className: 'cell-date' }, [
      formatDate(app.date_applied),
      el('small', { text: daysAgo(app.date_applied) }),
    ]);

    // Status dropdown that saves as soon as it changes
    const select = el(
      'select',
      {
        className: 'status-select',
        'aria-label': `Status for ${app.company}`,
        dataset: { status: app.status },
        onChange: (e) => changeStatus(app, e.target),
      },
      STATUSES.map((s) => {
        const option = el('option', { value: s, text: s });
        option.selected = s === app.status;
        return option;
      })
    );
    const status = el('td', { className: 'cell-status' }, select);

    // Notes toggle shows the first line of the note
    const preview = app.notes ? app.notes.split('\n')[0] : 'Add notes';
    const notes = el('td', { className: 'cell-notes' },
      el('button', {
        type: 'button',
        className: 'notes-toggle',
        'aria-expanded': String(isOpen),
        'aria-controls': notesId,
        onClick: () => toggleNotes(app.id),
      }, [
        el('span', { className: 'chev', 'aria-hidden': 'true', text: '›' }),
        el('span', { className: `preview${app.notes ? ' has-notes' : ''}`, text: preview }),
      ])
    );

    const actions = el('td', { className: 'cell-actions' }, [
      el('button', { type: 'button', className: 'btn btn-quiet', text: 'Edit', 'aria-label': `Edit ${app.company}`, onClick: () => openForm(app) }),
      el('button', { type: 'button', className: 'btn btn-quiet', text: 'Delete', 'aria-label': `Delete ${app.company}`, onClick: () => openDelete(app) }),
    ]);

    const row = el('tr', { className: `app-row${isOpen ? ' is-open' : ''}`, dataset: { id: app.id } },
      [main, date, status, notes, actions]);

    // Expandable notes editor underneath the row
    const textareaId = `notes-text-${app.id}`;
    const textarea = el('textarea', { id: textareaId, maxlength: '5000', placeholder: 'Interview feedback, contact name, salary info…' });
    textarea.value = app.notes || '';
    const savedMsg = el('span', { className: 'saved-msg', 'aria-live': 'polite' });

    const notesRow = el('tr', { className: 'notes-row', id: notesId }, el('td', { colspan: '5' },
      el('div', { className: 'notes-editor' }, [
        el('label', { for: textareaId, text: `Notes for ${app.company}` }),
        textarea,
        el('div', { className: 'notes-actions' }, [
          el('button', {
            type: 'button',
            className: 'btn btn-secondary',
            text: 'Save notes',
            onClick: (e) => saveNotes(app, textarea, e.target, savedMsg),
          }),
          savedMsg,
        ]),
      ])
    ));
    notesRow.hidden = !isOpen;

    return [row, notesRow];
  }

  // ---------- Actions ----------

  function setFilter(status) {
    state.status = status;
    state.openNotes.clear();
    loadApplications().catch((err) => toast(err.message, true));
  }

  function toggleNotes(id) {
    const row = rowsEl.querySelector(`.app-row[data-id="${id}"]`);
    const notesRow = $(`notes-${id}`);
    const toggle = row.querySelector('.notes-toggle');
    const opening = notesRow.hidden;

    notesRow.hidden = !opening;
    row.classList.toggle('is-open', opening);
    toggle.setAttribute('aria-expanded', String(opening));

    if (opening) {
      state.openNotes.add(id);
      notesRow.querySelector('textarea').focus();
    } else {
      state.openNotes.delete(id);
    }
  }

  async function saveNotes(app, textarea, button, savedMsg) {
    button.disabled = true;
    savedMsg.textContent = '';
    try {
      const { application } = await api(`/api/applications/${app.id}/notes`, {
        method: 'PATCH',
        body: { notes: textarea.value },
      });
      Object.assign(app, application);
      // Update the preview text without re-rendering (keeps the panel open)
      const row = rowsEl.querySelector(`.app-row[data-id="${app.id}"]`);
      const previewEl = row.querySelector('.preview');
      previewEl.textContent = app.notes ? app.notes.split('\n')[0] : 'Add notes';
      previewEl.classList.toggle('has-notes', Boolean(app.notes));
      savedMsg.textContent = 'Notes saved';
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
    }
  }

  async function changeStatus(app, select) {
    const previous = app.status;
    const next = select.value;
    select.dataset.status = next;
    select.disabled = true;
    try {
      await api(`/api/applications/${app.id}/status`, { method: 'PATCH', body: { status: next } });
      app.status = next;
      toast(`${app.company} moved to ${next}`);
      await loadSummary();
      // If a filter is on, the row may no longer belong in this view.
      if (state.status && state.status !== next) await loadApplications();
    } catch (err) {
      select.value = previous;
      select.dataset.status = previous;
      toast(err.message, true);
    } finally {
      select.disabled = false;
    }
  }

  function openForm(app = null) {
    state.editingId = app ? app.id : null;
    clearFormError();
    appForm.reset();

    const f = appForm.elements;
    if (app) {
      dialogTitle.textContent = 'Edit application';
      saveBtn.textContent = 'Save changes';
      f.company.value = app.company;
      f.role.value = app.role;
      f.date_applied.value = app.date_applied;
      f.status.value = app.status;
      f.job_url.value = app.job_url || '';
      f.notes.value = app.notes || '';
    } else {
      dialogTitle.textContent = 'Add application';
      saveBtn.textContent = 'Save application';
      f.date_applied.value = todayString();
      f.status.value = 'Applied';
    }

    appDialog.showModal();
    f.company.focus();
  }

  async function submitForm(event) {
    event.preventDefault();
    clearFormError();

    if (!appForm.checkValidity()) {
      const firstInvalid = appForm.querySelector(':invalid');
      const label = appForm.querySelector(`label[for="${firstInvalid.id}"]`).textContent;
      showFormError(`${label}: ${firstInvalid.validationMessage}`);
      firstInvalid.focus();
      return;
    }

    const f = appForm.elements;
    const body = {
      company: f.company.value,
      role: f.role.value,
      date_applied: f.date_applied.value,
      status: f.status.value,
      job_url: f.job_url.value,
      notes: f.notes.value,
    };

    const isEdit = state.editingId !== null;
    saveBtn.disabled = true;
    try {
      if (isEdit) {
        await api(`/api/applications/${state.editingId}`, { method: 'PUT', body });
      } else {
        await api('/api/applications', { method: 'POST', body });
      }
      appDialog.close();
      toast(isEdit ? 'Changes saved' : `${body.company.trim()} added`);
      await refresh();
    } catch (err) {
      showFormError(err.message);
    } finally {
      saveBtn.disabled = false;
    }
  }

  function openDelete(app) {
    state.deletingId = app.id;
    deleteText.textContent = `${app.role} at ${app.company} and its notes will be removed. This can't be undone.`;
    deleteDialog.showModal();
  }

  async function confirmDelete() {
    confirmDeleteBtn.disabled = true;
    try {
      await api(`/api/applications/${state.deletingId}`, { method: 'DELETE' });
      state.openNotes.delete(state.deletingId);
      deleteDialog.close();
      toast('Application deleted');
      await refresh();
    } catch (err) {
      toast(err.message, true);
    } finally {
      confirmDeleteBtn.disabled = false;
    }
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login';
    }
  }

  // ---------- Wire up events ----------

  stageButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      // Clicking the active stage again goes back to all
      const status = btn.dataset.status;
      setFilter(status === state.status ? '' : status);
    });
  });

  sortSelect.addEventListener('change', () => {
    state.sort = sortSelect.value;
    loadApplications().catch((err) => toast(err.message, true));
  });

  $('add-btn').addEventListener('click', () => openForm());
  appForm.addEventListener('submit', submitForm);
  confirmDeleteBtn.addEventListener('click', confirmDelete);
  $('logout-btn').addEventListener('click', logout);

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('dialog').close());
  });

  // Start
  loadUser().catch(() => {});
  refresh();
})();
