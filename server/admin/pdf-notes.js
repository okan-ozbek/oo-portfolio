import { readApiResponse } from './api-response.js';
import { createMarkdownEditor } from './markdown-editor.js';
import { bindNoteGestures, constrainNoteHorizontally, displayNoteLayout, noteViewport, pageForNoteRect } from './pdf-note-gestures.js';
import { icon } from './icons.js';
import { initNoteAppearance } from './note-appearance.js';
import { capturePdfSelection, randomNoteRect } from './pdf-text-anchor.js';

const $ = id => document.getElementById(id);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const payload = note => ({ page: note.page, x: note.x, y: note.y, width: note.width ?? null, height: note.height ?? null, markdown: note.markdown, anchor: note.anchor ?? null });

export function initPdfNotes({ bookId, container, getViewer, status, onLayoutChange = () => {} }) {
  let notes = [], visible = true, editing = null, csrf, loadError = '', layoutSaving = false, creating = false;
  let selectedAnchor = null, selectionError = '', outlinedId = null, hoveredId = null, focusedId = null;
  const readerModule = '/blog/assets/reader.js';
  initNoteAppearance();
  document.addEventListener('noteappearancechange', () => editing?.editor.measure());
  const gestures = bindNoteGestures({ container, render, save: saveLayout, canStart: () => !layoutSaving && !editing });
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
  const pageElement = number => getViewer()?.getPageView(number - 1)?.div;
  const noteKey = note => note.id ?? 'draft';
  const displayedNotes = () => editing && !editing.note.id ? [...notes, editing.note] : notes;
  function outlineLink(id) {
    outlinedId = id;
    for (const card of container.querySelectorAll('.pdf-post-it')) card.classList.toggle('pdf-note-linked-active', Boolean(id) && card.dataset.noteId === id);
    for (const mark of container.querySelectorAll('.pdf-note-highlight')) mark.classList.toggle('pdf-note-linked-active', Boolean(id) && mark.dataset.linkedNoteId === id);
  }
  function hoverLink(id) { hoveredId = id; outlineLink(hoveredId ?? focusedId); }
  function focusLink(id) { focusedId = id; outlineLink(hoveredId ?? focusedId); }
  function renderHighlights(displayed) {
    for (const page of container.querySelectorAll('.page[data-page-number]')) {
      const number = Number(page.dataset.pageNumber);
      const fragments = displayed.flatMap(note => (note.anchor?.rects ?? []).filter(rect => rect.page === number).map(rect => ({ rect, id: noteKey(note) })));
      let layer = page.querySelector('.pdf-note-highlights');
      if (!fragments.length) { layer?.remove(); continue; }
      if (!layer) {
        layer = document.createElement('div'); layer.className = 'pdf-note-highlights'; layer.setAttribute('aria-hidden', 'true'); page.append(layer);
      }
      layer.replaceChildren(...fragments.map(({ rect, id }) => {
        const mark = document.createElement('span'); mark.className = 'pdf-note-highlight'; mark.dataset.linkedNoteId = id;
        Object.assign(mark.style, { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` });
        return mark;
      }));
    }
    outlineLink(outlinedId);
  }
  let hoverFrame;
  container.addEventListener('pointermove', event => {
    cancelAnimationFrame(hoverFrame);
    const { target, clientX, clientY, buttons } = event;
    hoverFrame = requestAnimationFrame(() => {
      if (!visible || buttons || gestures.active) { hoverLink(null); return; }
      const card = target.closest('.pdf-post-it');
      if (card) { hoverLink(card._noteRef.anchor ? card.dataset.noteId : null); return; }
      const page = target.closest('.page[data-page-number]');
      if (!page) { hoverLink(null); return; }
      const bounds = page.getBoundingClientRect(), x = (clientX - bounds.left) / bounds.width, y = (clientY - bounds.top) / bounds.height;
      const note = displayedNotes().find(item => item.anchor?.rects.some(rect => rect.page === Number(page.dataset.pageNumber) && x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height));
      hoverLink(note ? noteKey(note) : null);
    });
  });
  container.addEventListener('pointerleave', () => { cancelAnimationFrame(hoverFrame); hoverLink(null); });
  container.addEventListener('focusin', event => {
    const card = event.target.closest('.pdf-post-it'); focusLink(card?._noteRef.anchor ? card.dataset.noteId : null);
  });
  container.addEventListener('focusout', () => queueMicrotask(() => {
    const card = document.activeElement?.closest('.pdf-post-it'); focusLink(card?._noteRef.anchor ? card.dataset.noteId : null);
  }));
  function button(text, label, action, glyph) {
    const node = document.createElement('button'); node.type = 'button';
    if (glyph) node.append(icon(glyph)); else node.textContent = text;
    node.setAttribute('aria-label', label); node.title = label;
    if (action) node.addEventListener('click', action);
    return node;
  }
  function position(card, note, page) {
    const sized = note.width != null && note.height != null;
    const width = Math.min(innerWidth <= 700 ? 200 : 230, page.clientWidth * .65);
    let layout = sized ? displayNoteLayout(note, page.clientWidth, page.clientHeight) : {
      ...note, width: width / page.clientWidth, height: 120 / page.clientHeight,
      x: clamp(note.x * page.clientWidth - (note.x > .6 ? width : 0), 0, page.clientWidth - width) / page.clientWidth,
    };
    layout = constrainNoteHorizontally(layout, page.getBoundingClientRect(), noteViewport(container));
    // A resized height is a minimum; wrapped content can make the note taller.
    card.style.height = 'auto';
    card.style.minHeight = sized ? `${layout.height * page.clientHeight}px` : '120px';
    card.style.left = `${layout.x * 100}%`; card.style.top = `${layout.y * 100}%`;
    card.style.width = `${layout.width * page.clientWidth}px`;
    card.classList.remove('anchor-right', 'anchor-bottom');
    if (!sized && card.isConnected) card.style.top = `${clamp(note.y * page.clientHeight - (note.y > .75 ? card.offsetHeight : 0), 0, Math.max(0, page.clientHeight - card.offsetHeight))}px`;
  }
  function createCard(note, page) {
    const card = document.createElement('aside'); card.className = 'pdf-post-it pdf-note-card';
    card.dataset.noteId = noteKey(note); card.setAttribute('aria-label', `Note on page ${note.page}`); position(card, note, page);
    const heading = document.createElement('div'); heading.className = 'pdf-post-it-heading pdf-note-drag';
    heading.tabIndex = 0; heading.setAttribute('aria-label', `Drag note on page ${note.page}`); heading.title = 'Drag this header to move the note. Arrow keys also move it.';
    const edit = button('', `Edit note on page ${note.page}`, () => void startEditing(note), 'edit');
    const grip = document.createElement('span'); grip.className = 'pdf-note-grip'; grip.textContent = '⠿'; grip.setAttribute('aria-hidden', 'true');
    const resize = button('', `Resize note on page ${note.page}`); resize.className = 'pdf-note-resize';
    resize.title = 'Drag to resize horizontally and vertically. Arrow keys resize; Shift resizes faster.';
    gestures.bind(heading, note, card, page, 'drag'); gestures.bind(resize, note, card, page, 'resize');
    heading.append(edit, grip);
    const content = document.createElement('div'); content.className = 'pdf-note-content'; content.innerHTML = note.html ?? '';
    content.tabIndex = 0; content.title = 'Click to edit this note';
    content.addEventListener('click', event => { if (!card.classList.contains('pdf-note-editing') && !event.target.closest('a,button,input')) void startEditing(note); });
    content.addEventListener('keydown', event => { if (!card.classList.contains('pdf-note-editing') && event.target === content && ['Enter', ' '].includes(event.key)) { event.preventDefault(); void startEditing(note); } });
    card._noteRef = note; card.append(heading, content, resize); page.append(card); position(card, note, page); return card;
  }
  function render() {
    if (!getViewer() || gestures.active) return;
    onLayoutChange();
    const displayed = displayedNotes();
    for (const page of container.querySelectorAll('.page[data-page-number]')) {
      const localNotes = displayed.filter(item => item.page === Number(page.dataset.pageNumber));
      const keys = new Set(localNotes.map(noteKey));
      for (const card of page.querySelectorAll('.pdf-post-it')) if (card !== editing?.card && !keys.has(card.dataset.noteId)) card.remove();
      for (const note of localNotes) {
        if (editing && noteKey(note) === noteKey(editing.note)) {
          position(editing.card, note, page);
          if (editing.card.parentElement !== page) page.append(editing.card);
        } else {
          const current = page.querySelector(`[data-note-id="${noteKey(note)}"]`);
          if (current?._noteRef === note) position(current, note, page);
          else { current?.remove(); createCard(note, page); }
        }
      }
    }
    renderHighlights(displayed);
  }
  let scrollFrame, previousScrollLeft = container.scrollLeft;
  container.addEventListener('scroll', () => {
    if (container.scrollLeft === previousScrollLeft) return;
    previousScrollLeft = container.scrollLeft;
    cancelAnimationFrame(scrollFrame); scrollFrame = requestAnimationFrame(render);
  }, { passive: true });
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
    if (!markdown.trim() && !active.note.anchor) return false;
    if (markdown === active.saved && active.note.id) return true;
    active.error.textContent = ''; editStatus(active, 'Saving…');
    active.saving = (async () => {
      try {
        const { annotation } = await api(active.note.id ? `annotations/${active.note.id}` : 'annotations', {
          method: active.note.id ? 'PATCH' : 'POST', body: { ...payload(active.note), markdown },
        });
        const previousId = active.note.id;
        notes = notes.filter(note => note.id !== previousId); notes.push(annotation);
        if (outlinedId === noteKey(active.note)) outlinedId = annotation.id;
        if (hoveredId === noteKey(active.note)) hoveredId = annotation.id;
        if (focusedId === noteKey(active.note)) focusedId = annotation.id;
        active.note = annotation; active.saved = markdown; active.card.dataset.noteId = annotation.id; active.card._noteRef = annotation;
        render();
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
    if (!active.note.id && !active.editor.value.trim() && !active.note.anchor) { endEditing(active); return true; }
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
    render(); editStatus(active, note.id ? 'Saved' : 'New note'); active.editor.focus();
    if (!note.id && note.anchor) void saveDraft(active);
  }
  function rememberSelection() {
    selectedAnchor = null; selectionError = '';
    try { selectedAnchor = capturePdfSelection(container, window.getSelection()); }
    catch (error) { selectionError = error.message; }
  }
  async function createNote() {
    if (creating || layoutSaving || gestures.active) return;
    if (!selectedAnchor && !selectionError) rememberSelection();
    const anchor = selectedAnchor, error = selectionError; selectedAnchor = null; selectionError = '';
    if (error) { status(error, true); return; }
    creating = true;
    try {
      if (!(await finishEditing())) return;
      visible = true; syncVisibility();
      const bounds = container.getBoundingClientRect();
      const rect = randomNoteRect({ left: bounds.left + container.clientLeft, top: bounds.top + container.clientTop, width: container.clientWidth, height: container.clientHeight }, innerWidth <= 700 ? 200 : 230, 180);
      const page = pageForNoteRect(rect, container.querySelectorAll('.page[data-page-number]'));
      if (!page) return;
      const reference = page.getBoundingClientRect();
      const layout = constrainNoteHorizontally({ x: (rect.left - reference.left) / reference.width, y: (rect.top - reference.top) / reference.height, width: rect.width / reference.width, height: rect.height / reference.height }, reference, noteViewport(container));
      window.getSelection()?.removeAllRanges();
      await startEditing({ page: Number(page.dataset.pageNumber), ...layout, markdown: '', anchor });
    } catch (error) { status(`Could not create a note: ${error.message}`, true); }
    finally { creating = false; }
  }
  document.addEventListener('pointerdown', event => {
    if (editing && !event.composedPath().includes(editing.card)) void finishEditing();
  }, true);
  document.addEventListener('focusout', event => {
    const active = editing;
    // CodeMirror briefly focuses the document while replacing a rendered block
    // with source. Only a real transfer to another control should finish editing.
    if (event.relatedTarget && active && !active.card.contains(event.relatedTarget)) {
      queueMicrotask(() => { if (editing === active && !active.card.contains(document.activeElement)) void finishEditing(); });
    }
  });
  window.addEventListener('blur', () => { if (editing) void finishEditing(); });
  window.addEventListener('beforeunload', event => {
    if (layoutSaving || gestures.active || editing && (editing.saving || editing.editor.value !== editing.saved)) { event.preventDefault(); event.returnValue = ''; }
  });
  $('note-add').addEventListener('pointerdown', rememberSelection);
  $('note-add').addEventListener('click', () => void createNote());
  $('notes-toggle').addEventListener('click', async () => {
    if (!(await finishEditing())) return;
    visible = !visible; if (!visible) { hoveredId = focusedId = null; outlineLink(null); } syncVisibility();
    try { localStorage.setItem('pixelware-pdf-notes', visible ? 'visible' : 'hidden'); } catch { /* Retain in memory. */ }
  });
  syncVisibility();
  return { render, get error() { return loadError; }, async load() {
    try { ({ annotations: notes } = await api('annotations')); }
    catch (error) { loadError = `PDF notes could not be loaded: ${error.message} Reload the reader to retry.`; status(loadError, true); }
  } };
}
