import { readApiResponse } from './api-response.js';
import { createMarkdownEditor } from './markdown-editor.js';
import { renderMarkdown } from '../blog-markdown.mjs';
import { bindNoteGestures, displayNoteLayout } from './pdf-note-gestures.js';

const $ = id => document.getElementById(id);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const payload = note => ({ page: note.page, x: note.x, y: note.y, width: note.width ?? null, height: note.height ?? null, markdown: note.markdown });

export function initPdfNotes({ bookId, container, getViewer, revealToolbar, status }) {
  let notes = [], visible = true, placing = false, editing = null, busy = false, csrf;
  let loadError = '', layoutSaving = false;
  const dialog = $('pdf-note-dialog');
  const readerModule = '/blog/assets/reader.js';
  const editor = createMarkdownEditor($('pdf-note-markdown'), {
    onLimit: message => { $('pdf-note-error').textContent = message; },
    enhance: root => import(readerModule).then(reader => reader.enhanceContent(root)),
  });
  const gestures = bindNoteGestures({ container, render, save: saveLayout, canStart: () => !layoutSaving && !busy && !placing });
  const previewObserver = new ResizeObserver(() => { if (dialog.open) updatePreview(); });
  try { visible = localStorage.getItem('pixelware-pdf-notes') !== 'hidden'; } catch { /* Use the default. */ }
  async function api(path, options = {}) {
    if (options.method && options.method !== 'GET' && !csrf) ({ csrf } = await readApiResponse(await fetch('/api/admin/session')));
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
    placing = false; document.body.classList.remove('pdf-note-placing');
    $('note-add').setAttribute('aria-pressed', 'false'); $('note-placement').hidden = true;
  }
  function startPlacement() {
    if (placing) { cancelPlacement(); return; }
    visible = true; syncVisibility(); placing = true;
    $('note-add').setAttribute('aria-pressed', 'true'); $('note-placement').hidden = false;
    document.body.classList.add('pdf-note-placing'); container.focus();
  }
  const pageElement = number => getViewer()?.getPageView(number - 1)?.div;
  function button(text, label, action) {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = text;
    if (label) node.setAttribute('aria-label', label);
    if (action) node.addEventListener('click', action);
    return node;
  }
  function render() {
    if (!getViewer() || gestures.active) return;
    for (const page of container.querySelectorAll('.page[data-page-number]')) {
      page.querySelectorAll('.pdf-post-it').forEach(node => node.remove());
      for (const note of notes.filter(item => item.page === Number(page.dataset.pageNumber))) {
        const card = document.createElement('aside'); card.className = 'pdf-post-it pdf-note-card';
        card.dataset.noteId = note.id; card.setAttribute('aria-label', `Note on page ${note.page}`);
        const sized = note.width != null && note.height != null, layout = sized ? displayNoteLayout(note, page.clientWidth, page.clientHeight) : note;
        card.style.left = `${layout.x * 100}%`; card.style.top = `${layout.y * 100}%`;
        card.classList.toggle('anchor-right', !sized && note.x > .6); card.classList.toggle('anchor-bottom', !sized && note.y > .75);
        if (sized) { card.style.width = `${layout.width * page.clientWidth}px`; card.style.height = `${layout.height * page.clientHeight}px`; card.style.maxHeight = 'none'; }
        const heading = document.createElement('div'); heading.className = 'pdf-post-it-heading';
        const edit = button('✎ Edit note', null, () => openEditor(note));
        const drag = button('⠿ Drag', `Drag note on page ${note.page}`);
        drag.className = 'pdf-note-drag'; drag.title = 'Hold and drag to move. Arrow keys move the note; Shift moves faster.';
        const resize = button('', `Resize note on page ${note.page}`);
        resize.className = 'pdf-note-resize'; resize.title = 'Drag to resize horizontally and vertically. Arrow keys resize; Shift resizes faster.';
        gestures.bind(drag, note, card, page, 'drag'); gestures.bind(resize, note, card, page, 'resize');
        heading.append(edit, drag);
        const content = document.createElement('div'); content.className = 'pdf-note-content'; content.innerHTML = note.html;
        card.append(heading, content, resize); page.append(card);
      }
    }
    if (dialog.open) { updatePreview(); observePreview(); }
  }
  async function saveLayout(note, change, mode) {
    if (layoutSaving) return;
    layoutSaving = true;
    const restoreFocus = document.activeElement?.closest('.pdf-post-it')?.dataset.noteId === note.id;
    const updated = { ...note, ...change };
    notes = notes.map(item => item.id === note.id ? updated : item); render();
    status(mode === 'resize' ? 'Saving note size…' : 'Saving note position…');
    try {
      const { annotation } = await api(`annotations/${note.id}`, { method: 'PATCH', body: payload(updated) });
      notes = notes.map(item => item.id === note.id ? annotation : item);
      status(mode === 'resize' ? 'Note resized.' : 'Note moved.');
    } catch (error) { notes = notes.map(item => item.id === note.id ? note : item); status(`Note layout was not saved: ${error.message}`, true); }
    finally {
      layoutSaving = false; render();
      if (restoreFocus) container.querySelector(`[data-note-id="${note.id}"] .pdf-note-${mode === 'resize' ? 'resize' : 'drag'}`)?.focus({ preventScroll: true });
    }
  }
  function observePreview() {
    previewObserver.disconnect();
    const card = container.querySelector(`[data-note-id="${editing?.id}"]`);
    if (card) previewObserver.observe(card);
  }
  function updatePreview() {
    if (!editing) return;
    $('pdf-note-preview-content').innerHTML = renderMarkdown(editor.value);
    const preview = $('pdf-note-preview'), page = pageElement(editing.page);
    if (!page) return;
    const card = container.querySelector(`[data-note-id="${editing.id}"]`);
    preview.style.width = `${card?.getBoundingClientRect().width ?? Math.min(innerWidth <= 700 ? 200 : 230, page.clientWidth * .65)}px`;
    preview.style.height = editing.height ? `${card?.getBoundingClientRect().height ?? editing.height * page.clientHeight}px` : '';
    preview.style.maxHeight = editing.height ? 'none' : innerWidth <= 700 ? '200px' : '280px';
  }
  function openEditor(note) {
    if (layoutSaving || gestures.active) return;
    cancelPlacement(); editing = { ...note };
    $('pdf-note-title').textContent = note.id ? 'Edit PDF note' : 'New PDF note';
    $('pdf-note-page').textContent = `PDF page ${note.page} · Also appears in Book Notes`;
    editor.value = note.markdown ?? ''; setEditorMode('live');
    $('pdf-note-error').textContent = ''; $('pdf-note-delete').hidden = !note.id;
    dialog.showModal(); updatePreview(); observePreview(); editor.focus();
  }
  function setEditorMode(mode) {
    editor.setMode(mode); $('pdf-note-live').setAttribute('aria-pressed', String(mode === 'live'));
    $('pdf-note-source').setAttribute('aria-pressed', String(mode === 'source'));
  }
  function closeEditor() {
    if (busy) return;
    if (editor.value !== (editing?.markdown ?? '') && !window.confirm('Discard the unsaved changes to this PDF note?')) return;
    previewObserver.disconnect(); dialog.close(); editing = null;
  }
  async function mutate(action) {
    if (busy) return;
    busy = true; $('pdf-note-error').textContent = ''; editor.disabled = true;
    for (const control of $('pdf-note-form').elements) control.disabled = true;
    try { await action(); }
    catch (error) { $('pdf-note-error').textContent = error.message; }
    finally { busy = false; editor.disabled = false; for (const control of $('pdf-note-form').elements) control.disabled = false; }
  }
  function place(page, x, y) { openEditor({ page, x: clamp(x, 0, 1), y: clamp(y, 0, 1) }); }
  container.addEventListener('click', event => {
    if (!placing || event.target.closest('.pdf-post-it')) return;
    const page = event.target.closest('.page[data-page-number]');
    if (!page) return;
    event.preventDefault(); event.stopPropagation();
    const bounds = page.getBoundingClientRect();
    place(Number(page.dataset.pageNumber), (event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
  }, true);
  container.addEventListener('keydown', event => { if (placing && event.key === 'Enter') { event.preventDefault(); place(getViewer().currentPageNumber, .5, .5); } });
  window.addEventListener('keydown', event => { if (placing && event.key === 'Escape') { cancelPlacement(); revealToolbar(); } });
  window.addEventListener('beforeunload', event => {
    if (busy || layoutSaving || gestures.active || dialog.open && editor.value !== (editing?.markdown ?? '')) { event.preventDefault(); event.returnValue = ''; }
  });
  $('note-placement-cancel').addEventListener('click', cancelPlacement);
  $('note-add').addEventListener('click', startPlacement);
  $('notes-toggle').addEventListener('click', () => {
    visible = !visible; if (!visible) cancelPlacement(); syncVisibility();
    try { localStorage.setItem('pixelware-pdf-notes', visible ? 'visible' : 'hidden'); } catch { /* Retain in memory. */ }
  });
  for (const id of ['pdf-note-close', 'pdf-note-cancel']) $(id).addEventListener('click', closeEditor);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
  editor.addEventListener('input', updatePreview);
  editor.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); $('pdf-note-form').requestSubmit(); } });
  $('pdf-note-live').addEventListener('click', () => setEditorMode('live'));
  $('pdf-note-source').addEventListener('click', () => setEditorMode('source'));
  $('pdf-note-form').addEventListener('submit', event => {
    event.preventDefault();
    void mutate(async () => {
      const { annotation } = await api(editing.id ? `annotations/${editing.id}` : 'annotations', {
        method: editing.id ? 'PATCH' : 'POST', body: { ...payload(editing), markdown: editor.value },
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
