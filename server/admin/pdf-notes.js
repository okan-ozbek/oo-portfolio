import { readApiResponse } from './api-response.js';
import { createMarkdownEditor } from './markdown-editor.js';
import { bindNoteGestures, displayNoteLayout } from './pdf-note-gestures.js';
import { icon } from './icons.js';

const $ = id => document.getElementById(id);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const payload = note => ({ page: note.page, x: note.x, y: note.y, width: note.width ?? null, height: note.height ?? null, markdown: note.markdown });

export function initPdfNotes({ bookId, container, getViewer, status }) {
  let notes = [], visible = true, placing = false, editing = null, csrf, loadError = '', layoutSaving = false;
  const readerModule = '/blog/assets/reader.js';
  const gestures = bindNoteGestures({ container, render, save: saveLayout, canStart: () => !layoutSaving && !editing && !placing });
  try { visible = localStorage.getItem('pixelware-pdf-notes') !== 'hidden'; } catch { /* Use the default. */ }
  async function api(path, options = {}) {
    if (options.method && !csrf) ({ csrf } = await readApiResponse(await fetch('/api/admin/session')));
    return readApiResponse(await fetch(`/api/admin/books/${bookId}/${path}`, {
      ...options, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    }));
  }
  function syncVisibility() {
    document.body.classList.toggle('pdf-notes-hidden', !visible);
    $('notes-toggle').setAttribute('aria-pressed', String(visible));
    $('notes-toggle').title = visible ? 'Hide notes' : 'Show notes';
  }
  function cancelPlacement() {
    placing = false; document.body.classList.remove('pdf-note-placing');
    $('note-add').setAttribute('aria-pressed', 'false'); $('note-placement').hidden = true;
  }
  async function startPlacement() {
    if (placing) { cancelPlacement(); return; }
    if (!(await finishEditing())) return;
    visible = true; syncVisibility(); placing = true;
    $('note-add').setAttribute('aria-pressed', 'true'); $('note-placement').hidden = false;
    document.body.classList.add('pdf-note-placing'); container.focus();
  }
  const pageElement = number => getViewer()?.getPageView(number - 1)?.div;
  const noteKey = note => note.id ?? 'draft';
  function button(text, label, action, glyph) {
    const node = document.createElement('button'); node.type = 'button';
    if (glyph) node.append(icon(glyph)); else node.textContent = text;
    node.setAttribute('aria-label', label); node.title = label;
    if (action) node.addEventListener('click', action);
    return node;
  }
  function position(card, note, page) {
    const sized = note.width != null && note.height != null, layout = sized ? displayNoteLayout(note, page.clientWidth, page.clientHeight) : note;
    card.style.left = `${layout.x * 100}%`; card.style.top = `${layout.y * 100}%`;
    card.classList.toggle('anchor-right', !sized && note.x > .6); card.classList.toggle('anchor-bottom', !sized && note.y > .75);
    if (sized) { card.style.width = `${layout.width * page.clientWidth}px`; card.style.height = `${layout.height * page.clientHeight}px`; card.style.maxHeight = 'none'; }
    else {
      const width = Math.min(innerWidth <= 700 ? 200 : 230, page.clientWidth * .65);
      card.style.width = `${width}px`;
      card.classList.remove('anchor-right', 'anchor-bottom');
      card.style.left = `${clamp(note.x * page.clientWidth - (note.x > .6 ? width : 0), 0, page.clientWidth - width)}px`;
      if (card.isConnected) card.style.top = `${clamp(note.y * page.clientHeight - (note.y > .75 ? card.offsetHeight : 0), 0, Math.max(0, page.clientHeight - card.offsetHeight))}px`;
    }
  }
  function createCard(note, page) {
    const card = document.createElement('aside'); card.className = 'pdf-post-it pdf-note-card';
    card.dataset.noteId = noteKey(note); card.setAttribute('aria-label', `Note on page ${note.page}`); position(card, note, page);
    const heading = document.createElement('div'); heading.className = 'pdf-post-it-heading';
    const edit = button('', `Edit note on page ${note.page}`, () => void startEditing(note), 'edit');
    const drag = button('⠿ Drag', `Drag note on page ${note.page}`); drag.className = 'pdf-note-drag';
    drag.title = 'Hold and drag to move. Arrow keys move the note; Shift moves faster.';
    const resize = button('', `Resize note on page ${note.page}`); resize.className = 'pdf-note-resize';
    resize.title = 'Drag to resize horizontally and vertically. Arrow keys resize; Shift resizes faster.';
    gestures.bind(drag, note, card, page, 'drag'); gestures.bind(resize, note, card, page, 'resize');
    heading.append(edit, drag);
    const content = document.createElement('div'); content.className = 'pdf-note-content'; content.innerHTML = note.html ?? '';
    content.tabIndex = 0; content.title = 'Click to edit this note';
    content.addEventListener('click', event => { if (!card.classList.contains('pdf-note-editing') && !event.target.closest('a,button,input')) void startEditing(note); });
    content.addEventListener('keydown', event => { if (!card.classList.contains('pdf-note-editing') && event.target === content && ['Enter', ' '].includes(event.key)) { event.preventDefault(); void startEditing(note); } });
    card.append(heading, content, resize); page.append(card); position(card, note, page); return card;
  }
  function render() {
    if (!getViewer() || gestures.active) return;
    const displayed = editing && !editing.note.id ? [...notes, editing.note] : notes;
    for (const page of container.querySelectorAll('.page[data-page-number]')) {
      for (const card of page.querySelectorAll('.pdf-post-it')) if (card !== editing?.card) card.remove();
      for (const note of displayed.filter(item => item.page === Number(page.dataset.pageNumber))) {
        if (editing && noteKey(note) === noteKey(editing.note)) {
          position(editing.card, note, page);
          if (editing.card.parentElement !== page) page.append(editing.card);
        } else createCard(note, page);
      }
    }
  }
  async function saveLayout(note, change, mode) {
    if (layoutSaving) return;
    layoutSaving = true;
    const restoreFocus = document.activeElement?.closest('.pdf-post-it')?.dataset.noteId === note.id;
    const updated = { ...note, ...change }; notes = notes.map(item => item.id === note.id ? updated : item); render();
    try {
      const { annotation } = await api(`annotations/${note.id}`, { method: 'PATCH', body: payload(updated) });
      notes = notes.map(item => item.id === note.id ? annotation : item); status(mode === 'resize' ? 'Note resized.' : 'Note moved.');
    } catch (error) { notes = notes.map(item => item.id === note.id ? note : item); status(`Note layout was not saved: ${error.message}`, true); }
    finally {
      layoutSaving = false; render();
      if (restoreFocus) container.querySelector(`[data-note-id="${note.id}"] .pdf-note-${mode === 'resize' ? 'resize' : 'drag'}`)?.focus({ preventScroll: true });
    }
  }
  function editStatus(active, message, error = false) {
    active.message.textContent = message; active.message.classList.toggle('is-error', error);
  }
  async function saveDraft(active) {
    clearTimeout(active.timer);
    if (active.saving) { if (!(await active.saving)) return false; return saveDraft(active); }
    if (editing !== active || active.deleting) return false;
    const markdown = active.editor.value;
    if (!markdown.trim()) return false;
    if (markdown === active.saved && active.note.id) return true;
    active.error.textContent = ''; editStatus(active, 'Saving…');
    active.saving = (async () => {
      try {
        const { annotation } = await api(active.note.id ? `annotations/${active.note.id}` : 'annotations', {
          method: active.note.id ? 'PATCH' : 'POST', body: { ...payload(active.note), markdown },
        });
        const previousId = active.note.id;
        notes = notes.filter(note => note.id !== previousId); notes.push(annotation);
        active.note = annotation; active.saved = markdown; active.card.dataset.noteId = annotation.id;
        editStatus(active, active.editor.value === markdown ? 'Saved' : 'Unsaved'); return true;
      } catch (error) { editStatus(active, 'Save failed', true); active.error.textContent = error.message; return false; }
      finally { active.saving = null; }
    })();
    const success = await active.saving;
    return success && active.editor.value !== active.saved ? saveDraft(active) : success;
  }
  async function finishEditing() {
    const active = editing;
    if (!active) return true;
    if (active.finishing) return active.finishing;
    active.finishing = finishDraft(active).finally(() => { active.finishing = null; });
    return active.finishing;
  }
  async function finishDraft(active) {
    if (active.deleting) return false;
    if (!active.note.id && !active.editor.value.trim()) { endEditing(active); return true; }
    if (!(await saveDraft(active))) {
      if (!active.editor.value.trim()) active.error.textContent = 'Write a note or use Delete to remove it.';
      active.editor.focus(); return false;
    }
    if (editing === active) endEditing(active);
    return true;
  }
  function endEditing(active) {
    clearTimeout(active.timer); active.editor.destroy(); editing = null; active.card.remove(); render();
  }
  async function deleteNote(active) {
    if (active.deleting || active.finishing) return;
    clearTimeout(active.timer);
    active.deleting = true; active.editor.disabled = true;
    try {
      if (active.saving) await active.saving;
      if (editing !== active) return;
      if (active.note.id) await api(`annotations/${active.note.id}`, { method: 'DELETE', body: {} });
      notes = notes.filter(note => note.id !== active.note.id); endEditing(active); status('Note deleted.');
    } catch (error) { active.error.textContent = error.message; }
    finally { active.deleting = false; if (editing === active) active.editor.disabled = false; }
  }
  async function startEditing(note) {
    if (editing && noteKey(editing.note) === noteKey(note)) { editing.editor.focus(); return; }
    if (layoutSaving || gestures.active || !(await finishEditing())) return;
    cancelPlacement();
    const page = pageElement(note.page);
    const card = container.querySelector(`[data-note-id="${noteKey(note)}"]`) ?? createCard(note, page);
    card.classList.add('pdf-note-editing');
    const heading = card.querySelector('.pdf-post-it-heading'), content = card.querySelector('.pdf-note-content');
    // Replace the rendered body with the same live editor used by Book Notes.
    const textarea = document.createElement('textarea'); textarea.id = 'pdf-note-inline-markdown'; textarea.maxLength = 100000;
    textarea.placeholder = 'Write a note… Markdown formats as you type.'; textarea.value = note.markdown ?? '';
    const label = document.createElement('label'); label.htmlFor = textarea.id; label.className = 'sr-only'; label.textContent = `Note on page ${note.page} · Live Markdown`;
    content.replaceChildren(label, textarea); content.removeAttribute('tabindex'); content.removeAttribute('title');
    const message = document.createElement('span'); message.className = 'pdf-note-save-status'; message.setAttribute('role', 'status');
    const error = document.createElement('p'); error.className = 'pdf-note-inline-error'; error.setAttribute('role', 'alert');
    const active = editing = { note, card, message, error, saved: note.markdown ?? '', saving: null, deleting: false };
    const done = button('', 'Done editing note', () => void finishEditing(), 'check'); done.className = 'pdf-note-done';
    const remove = button('', 'Delete note', () => void deleteNote(active), 'trash');
    heading.replaceChildren(message, remove, done); card.append(error); card.querySelector('.pdf-note-resize').hidden = true;
    active.editor = createMarkdownEditor(textarea, {
      onLimit: text => { error.textContent = text; },
      enhance: root => import(readerModule).then(reader => reader.enhanceContent(root)),
    });
    active.editor.addEventListener('input', () => {
      error.textContent = ''; editStatus(active, active.editor.value === active.saved ? 'Saved' : 'Unsaved');
      clearTimeout(active.timer); active.timer = setTimeout(() => void saveDraft(active), 700);
    });
    active.editor.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void saveDraft(active); }
      if (event.key === 'Escape' || (event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void finishEditing(); }
    });
    editStatus(active, note.id ? 'Saved' : 'New note'); active.editor.focus();
  }
  const place = (page, x, y) => void startEditing({ page, x: clamp(x, 0, 1), y: clamp(y, 0, 1), markdown: '' });
  container.addEventListener('click', event => {
    if (!placing || event.target.closest('.pdf-post-it')) return;
    const page = event.target.closest('.page[data-page-number]'); if (!page) return;
    event.preventDefault(); event.stopPropagation(); const bounds = page.getBoundingClientRect();
    place(Number(page.dataset.pageNumber), (event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
  }, true);
  container.addEventListener('keydown', event => { if (placing && event.key === 'Enter') { event.preventDefault(); place(getViewer().currentPageNumber, .5, .5); } });
  window.addEventListener('keydown', event => { if (placing && event.key === 'Escape') cancelPlacement(); });
  window.addEventListener('beforeunload', event => {
    if (layoutSaving || gestures.active || editing && (editing.saving || editing.editor.value !== editing.saved)) { event.preventDefault(); event.returnValue = ''; }
  });
  $('note-placement-cancel').addEventListener('click', cancelPlacement);
  $('note-add').addEventListener('click', () => void startPlacement());
  $('notes-toggle').addEventListener('click', async () => {
    if (!(await finishEditing())) return;
    visible = !visible; if (!visible) cancelPlacement(); syncVisibility();
    try { localStorage.setItem('pixelware-pdf-notes', visible ? 'visible' : 'hidden'); } catch { /* Retain in memory. */ }
  });
  syncVisibility();
  return { render, get error() { return loadError; }, async load() {
    try { ({ annotations: notes } = await api('annotations')); }
    catch (error) { loadError = `PDF notes could not be loaded: ${error.message} Reload the reader to retry.`; status(loadError, true); }
  } };
}
