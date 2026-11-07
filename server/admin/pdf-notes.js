import { readApiResponse } from './api-response.js';

const $ = id => document.getElementById(id);
const payload = note => ({ page: note.page, x: note.x, y: note.y, markdown: note.markdown });

export function initPdfNotes({ bookId, container, getViewer, revealToolbar, status }) {
  let notes = [], visible = true, placing = false, moving = null, editing = null, busy = false, csrf;
  let previewSequence = 0, previewTimer;
  let loadError = '';
  const dialog = $('pdf-note-dialog');
  try { visible = localStorage.getItem('pixelware-pdf-notes') !== 'hidden'; } catch { /* Use the default. */ }
  async function api(path, options = {}) {
    if (options.method && options.method !== 'GET' && !csrf) {
      ({ csrf } = await readApiResponse(await fetch('/api/admin/session')));
    }
    return readApiResponse(await fetch(`/api/admin/books/${bookId}/${path}`, {
      ...options, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    }));
  }
  function syncVisibility() {
    document.body.classList.toggle('pdf-notes-hidden', !visible);
    $('notes-toggle').setAttribute('aria-pressed', String(visible));
    $('notes-toggle').textContent = visible ? 'Hide notes' : 'Show notes';
  }
  function cancelPlacement() {
    placing = false; moving = null;
    document.body.classList.remove('pdf-note-placing');
    $('note-add').setAttribute('aria-pressed', 'false'); $('note-placement').hidden = true;
  }
  function startPlacement(note = null) {
    if (placing && !note) { cancelPlacement(); return; }
    visible = true; syncVisibility(); placing = true; moving = note;
    $('note-add').setAttribute('aria-pressed', 'true'); $('note-placement').hidden = false;
    document.body.classList.add('pdf-note-placing'); container.focus();
  }
  function render() {
    const viewer = getViewer();
    if (!viewer) return;
    for (const page of container.querySelectorAll('.page[data-page-number]')) {
      page.querySelectorAll('.pdf-post-it').forEach(node => node.remove());
      for (const note of notes.filter(item => item.page === Number(page.dataset.pageNumber))) {
        const card = document.createElement('aside'); card.className = 'pdf-post-it';
        card.dataset.noteId = note.id;
        card.style.left = `${note.x * 100}%`; card.style.top = `${note.y * 100}%`;
        card.classList.toggle('anchor-right', note.x > .6); card.classList.toggle('anchor-bottom', note.y > .75);
        card.setAttribute('aria-label', `Note on page ${note.page}`);
        const heading = document.createElement('div'); heading.className = 'pdf-post-it-heading';
        const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '✎ Edit note';
        edit.addEventListener('click', () => openEditor(note));
        const move = document.createElement('button'); move.type = 'button'; move.textContent = 'Move';
        move.setAttribute('aria-label', `Move note on page ${note.page}`);
        move.addEventListener('click', () => startPlacement(note));
        heading.append(edit, move);
        const content = document.createElement('div'); content.className = 'pdf-note-content'; content.innerHTML = note.html;
        card.append(heading, content); page.append(card);
      }
    }
  }
  async function preview() {
    const sequence = ++previewSequence, markdown = $('pdf-note-markdown').value;
    try {
      const { html } = await api('notes/preview', { method: 'POST', body: { markdown } });
      if (sequence === previewSequence && dialog.open) $('pdf-note-preview').innerHTML = html;
    } catch (error) { if (sequence === previewSequence && dialog.open) $('pdf-note-error').textContent = error.message; }
  }
  function openEditor(note) {
    cancelPlacement(); editing = { ...note }; previewSequence++;
    $('pdf-note-title').textContent = note.id ? 'Edit PDF note' : 'New PDF note';
    $('pdf-note-page').textContent = `PDF page ${note.page} · Also appears in Book Notes`;
    $('pdf-note-markdown').value = note.markdown ?? '';
    $('pdf-note-preview').innerHTML = note.html ?? '';
    $('pdf-note-error').textContent = ''; $('pdf-note-delete').hidden = !note.id;
    dialog.showModal(); $('pdf-note-markdown').focus();
  }
  function closeEditor() {
    if (busy) return;
    if ($('pdf-note-markdown').value !== (editing?.markdown ?? '') && !window.confirm('Discard the unsaved changes to this PDF note?')) return;
    previewSequence++; clearTimeout(previewTimer); dialog.close(); editing = null;
  }
  async function mutate(action) {
    if (busy) return;
    busy = true; $('pdf-note-error').textContent = '';
    for (const control of $('pdf-note-form').elements) control.disabled = true;
    try { await action(); }
    catch (error) { $('pdf-note-error').textContent = error.message; }
    finally { busy = false; for (const control of $('pdf-note-form').elements) control.disabled = false; }
  }
  async function place(page, x, y) {
    const position = { page, x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    if (!moving) { openEditor(position); return; }
    const note = moving; cancelPlacement();
    try {
      const { annotation } = await api(`annotations/${note.id}`, { method: 'PATCH', body: { ...payload(note), ...position } });
      notes = notes.map(item => item.id === note.id ? annotation : item); render(); status('Note moved.');
    } catch (error) { status(error.message, true); }
  }
  container.addEventListener('click', event => {
    if (!placing || event.target.closest('.pdf-post-it')) return;
    const page = event.target.closest('.page[data-page-number]');
    if (!page) return;
    event.preventDefault(); event.stopPropagation();
    const bounds = page.getBoundingClientRect();
    void place(Number(page.dataset.pageNumber), (event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
  }, true);
  container.addEventListener('keydown', event => {
    if (placing && event.key === 'Enter') { event.preventDefault(); void place(getViewer().currentPageNumber, .5, .5); }
  });
  window.addEventListener('keydown', event => { if (placing && event.key === 'Escape') { cancelPlacement(); revealToolbar(); } });
  window.addEventListener('beforeunload', event => {
    if (busy || dialog.open && $('pdf-note-markdown').value !== (editing?.markdown ?? '')) { event.preventDefault(); event.returnValue = ''; }
  });
  $('note-placement-cancel').addEventListener('click', cancelPlacement);
  $('note-add').addEventListener('click', () => startPlacement());
  $('notes-toggle').addEventListener('click', () => {
    visible = !visible; if (!visible) cancelPlacement(); syncVisibility();
    try { localStorage.setItem('pixelware-pdf-notes', visible ? 'visible' : 'hidden'); } catch { /* Retain in memory. */ }
  });
  for (const id of ['pdf-note-close', 'pdf-note-cancel']) $(id).addEventListener('click', closeEditor);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
  $('pdf-note-markdown').addEventListener('input', () => { previewSequence++; clearTimeout(previewTimer); previewTimer = setTimeout(() => void preview(), 450); });
  $('pdf-note-preview-button').addEventListener('click', () => void preview());
  $('pdf-note-form').addEventListener('submit', event => {
    event.preventDefault();
    void mutate(async () => {
      const { annotation } = await api(editing.id ? `annotations/${editing.id}` : 'annotations', {
        method: editing.id ? 'PATCH' : 'POST', body: { ...payload(editing), markdown: $('pdf-note-markdown').value },
      });
      notes = notes.filter(item => item.id !== annotation.id); notes.push(annotation); render();
      dialog.close(); editing = null; status('Note saved to this PDF and Book Notes.');
    });
  });
  $('pdf-note-delete').addEventListener('click', () => {
    void mutate(async () => {
      await api(`annotations/${editing.id}`, { method: 'DELETE', body: {} });
      notes = notes.filter(item => item.id !== editing.id); render(); dialog.close(); editing = null; status('Note deleted.');
    });
  });
  syncVisibility();
  return { render, get error() { return loadError; }, async load() {
    try { ({ annotations: notes } = await api('annotations')); }
    catch (error) { loadError = `PDF notes could not be loaded: ${error.message} Reload the reader to retry.`; status(loadError, true); }
  } };
}
