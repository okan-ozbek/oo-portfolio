import { icon } from './icons.js';
import { formatMarkdown } from './blog-format.js';
import { enhanceContent } from '/blog/assets/reader.js';
import { bindComposerModes, createMarkdownEditor } from '/blog/assets/markdown-editor.js';
const $ = id => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (text, action, className = 'secondary') => {
  const node = el('button', className, text);
  node.type = 'button'; node.addEventListener('click', action);
  return node;
};
const tagClass = tag => `book-tag tone-${[...tag.toLowerCase()].reduce((sum, char) => sum + char.codePointAt(0), 0) % 6}`;
const format = new Intl.NumberFormat();

export function initBooks({ api, toast }) {
  let books = [], allTags = [], activeTag = '', editing = null, deleting = null, bookmarking = null, version = 0;
  let editSession = null, authVersion = 0;
  const editSessions = new Map();
  const pending = new Set();
  const completing = new Set();
  let noteSession = null;
  const noteInput = createMarkdownEditor($('book-notes-markdown'), { enhance: enhanceContent, onLimit: toast });
  const noteDirty = () => noteSession && noteSession.markdown !== noteSession.saved;
  function noteStatus(text, failed = false) {
    $('book-notes-status').textContent = text;
    $('book-notes-retry').hidden = !failed;
  }
  async function saveNote() {
    const active = noteSession;
    if (!active || active.loading) return false;
    clearTimeout(active.timer);
    if (active.saving) {
      if (!(await active.saving) || noteSession !== active) return false;
      return noteDirty() ? saveNote() : true;
    }
    if (!noteDirty()) return true;
    const markdown = active.markdown;
    noteStatus('Saving…'); $('book-notes-error').textContent = '';
    active.saving = (async () => {
      try {
        const { hasNotes } = await api(`books/${active.id}/notes`, { method: 'PATCH', body: { markdown } });
        if (noteSession !== active) return false;
        active.saved = markdown;
        books = books.map(book => book.id === active.id ? { ...book, hasNotes } : book);
        const control = document.querySelector(`[data-book-notes-id="${active.id}"]`);
        if (control) { control.classList.toggle('has-notes', hasNotes); control.title = hasNotes ? 'Edit notes' : 'Add notes'; }
        noteStatus(noteDirty() ? 'Unsaved changes' : 'All changes saved.');
        return true;
      } catch (error) {
        if (noteSession === active) { noteStatus('Changes could not be saved.', true); $('book-notes-error').textContent = error.message; }
        return false;
      } finally { active.saving = null; }
    })();
    const success = await active.saving;
    return success && noteSession === active && noteDirty() ? saveNote() : success;
  }
  async function previewNote() {
    const active = noteSession;
    if (!active || active.loading || $('book-notes-panes').dataset.mode !== 'preview' || active.previewMarkdown === active.markdown) return;
    const markdown = active.markdown, sequence = ++active.previewSequence;
    try {
      const { html } = await api(`books/${active.id}/notes/preview`, { method: 'POST', body: { markdown } });
      if (noteSession !== active || sequence !== active.previewSequence || $('book-notes-panes').dataset.mode !== 'preview') return;
      active.previewMarkdown = undefined;
      $('book-notes-preview').innerHTML = html || '<p class="blog-muted">Your notes take shape here.</p>';
      await enhanceContent($('book-notes-preview'));
      if (noteSession === active && sequence === active.previewSequence) active.previewMarkdown = markdown;
    } catch (error) { if (noteSession === active && sequence === active.previewSequence) $('book-notes-preview').textContent = error.message; }
  }
  function noteWordCount(markdown) {
    $('book-notes-words').textContent = `${markdown.trim() ? markdown.trim().split(/\s+/).length : 0} words`;
  }
  function noteChanged() {
    const active = noteSession;
    if (!active || active.loading) return;
    active.markdown = noteInput.value; active.previewSequence++;
    noteWordCount(active.markdown);
    noteStatus(noteDirty() ? 'Unsaved changes' : 'All changes saved.');
    clearTimeout(active.timer); clearTimeout(active.previewTimer);
    active.timer = setTimeout(() => void saveNote(), 700);
    if ($('book-notes-panes').dataset.mode === 'preview') active.previewTimer = setTimeout(() => void previewNote(), 400);
  }
  async function openNotes(book) {
    const active = noteSession = { id: book.id, markdown: '', saved: '', loading: true, previewSequence: 0 };
    noteInput.value = ''; noteInput.disabled = true;
    $('book-notes-name').textContent = book.name;
    $('book-notes-error').textContent = ''; $('book-notes-preview').replaceChildren();
    $('book-notes-words').textContent = '0 words';
    $('book-notes-clear').disabled = $('book-notes-done').disabled = true;
    noteStatus('Loading note…'); $('book-notes-dialog').showModal();
    try {
      const { markdown } = await api(`books/${book.id}/notes`);
      if (noteSession !== active) return;
      active.markdown = active.saved = markdown; active.loading = false;
      noteInput.value = markdown; noteInput.disabled = false;
      $('book-notes-clear').disabled = $('book-notes-done').disabled = false;
      noteStatus('All changes saved.'); noteWordCount(markdown); void previewNote(); noteInput.focus();
    } catch (error) {
      if (noteSession === active) { noteStatus('Note could not be loaded.'); $('book-notes-error').textContent = error.message; }
    }
  }
  async function closeNotes() {
    const active = noteSession;
    if (!active) return;
    if (!active.loading && !(await saveNote())) return;
    if (noteSession !== active) return;
    clearTimeout(active.timer); clearTimeout(active.previewTimer);
    noteSession = null; $('book-notes-dialog').close();
  }
  noteInput.addEventListener('input', noteChanged);
  const noteSnippets = { code: '\n```\n// Your code here\n```\n', mermaid: '\n```mermaid\nflowchart LR\n  A[Idea] --> B[Takeaway]\n```\n', link: '[Link text](https://example.com)' };
  for (const tool of document.querySelectorAll('[data-note-insert]')) {
    tool.append(icon(tool.dataset.noteIcon));
    tool.addEventListener('click', () => {
      if (!noteSession || noteSession.loading) return;
      const edit = formatMarkdown(noteInput.value, noteInput.selectionStart, noteInput.selectionEnd, tool.dataset.noteInsert);
      noteInput.focus();
      if (edit) {
        noteInput.setRangeText(edit.text, edit.start, edit.end, 'end');
        noteInput.setSelectionRange(edit.selectionStart, edit.selectionEnd);
      } else noteInput.setRangeText(noteSnippets[tool.dataset.noteInsert], noteInput.selectionStart, noteInput.selectionEnd, 'end');
      noteChanged();
    });
  }
  bindComposerModes(noteInput, $('book-notes-panes'), document.querySelectorAll('[data-note-mode]'), mode => {
    if (noteSession) { clearTimeout(noteSession.previewTimer); noteSession.previewSequence++; }
    if (mode === 'preview') void previewNote();
  });
  noteInput.addEventListener('keydown', event => {
    if (event.key === 'Tab') { event.preventDefault(); noteInput.setRangeText('  ', noteInput.selectionStart, noteInput.selectionEnd, 'end'); noteChanged(); }
    if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); void saveNote(); }
  });
  $('book-notes-retry').addEventListener('click', () => void saveNote());
  $('book-notes-clear').addEventListener('click', () => { noteInput.value = ''; noteChanged(); noteInput.focus(); });
  $('book-notes-close').addEventListener('click', () => void closeNotes());
  $('book-notes-form').addEventListener('submit', event => { event.preventDefault(); void closeNotes(); });
  $('book-notes-dialog').addEventListener('cancel', event => { event.preventDefault(); void closeNotes(); });
  window.addEventListener('beforeunload', event => { if (noteDirty() || noteSession?.saving) { event.preventDefault(); event.returnValue = ''; } });
  function tagEditor(prefix, onChange = () => {}) {
    const root = $(`book-${prefix}-tags`);
    let tags = [];
    const chips = el('div', 'book-tag-chips');
    const input = el('input'); input.id = `book-${prefix}-tag-input`; input.maxLength = 60; input.placeholder = 'Add a tag…';
    input.autocomplete = 'off';
    const suggestions = el('div', 'book-tag-suggestions');
    root.append(chips, input, suggestions);
    function changed() { render(); onChange([...tags]); }
    function add(value) {
      const tag = value.trim();
      if (!tag) return;
      if (!tags.some(item => item.toLowerCase() === tag.toLowerCase())) {
        if (tags.length >= 20) { input.setCustomValidity('Use up to 20 tags.'); input.reportValidity(); return; }
        tags.push(allTags.find(item => item.toLowerCase() === tag.toLowerCase()) ?? tag);
        onChange([...tags]);
      }
      input.value = ''; input.setCustomValidity(''); render(); input.focus();
    }
    function renderSuggestions() {
      suggestions.replaceChildren();
      const query = input.value.trim().toLowerCase();
      const available = allTags.filter(tag => !tags.includes(tag) && tag.toLowerCase().includes(query));
      for (const tag of available) suggestions.append(button(tag, () => add(tag), `${tagClass(tag)} tag-suggestion`));
      if (query && !allTags.some(tag => tag.toLowerCase() === query)) suggestions.append(button(`＋ Create “${input.value.trim()}”`, () => add(input.value), 'book-create-tag'));
    }
    function render() {
      chips.replaceChildren();
      for (const tag of tags) {
        const chip = el('span', tagClass(tag));
        const remove = button('×', () => { tags = tags.filter(item => item !== tag); changed(); }, 'book-tag-remove');
        remove.setAttribute('aria-label', `Remove tag ${tag}`);
        chip.append(el('span', '', tag), remove); chips.append(chip);
      }
      renderSuggestions();
    }
    input.addEventListener('input', () => { input.setCustomValidity(''); renderSuggestions(); });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); add(input.value); }
      if (event.key === 'Backspace' && !input.value && tags.length) { tags.pop(); changed(); }
    });
    return { set(value) { tags = [...value]; input.value = ''; input.setCustomValidity(''); render(); }, get() { add(input.value); return input.checkValidity() ? [...tags] : null; } };
  }
  const uploadTags = tagEditor('upload'), editTags = tagEditor('edit', tags => {
    if (!editSession) return;
    editSession.tags = tags; editSession.revision++; void saveEdit(editSession);
  });
  function editStatus(session, text, failed = false) {
    if (editSession !== session) return;
    $('book-edit-status').textContent = text;
    $('book-edit-retry').hidden = !failed;
  }
  async function saveEdit(session) {
    if (session.saving || session.authVersion !== authVersion) return;
    session.saving = true;
    try {
      // Serialize requests and always send the latest selection after an in-flight
      // save. A slower response must not overwrite a newer tag selection.
      while (session.savedRevision < session.revision && session.authVersion === authVersion) {
        const revision = session.revision;
        editStatus(session, 'Saving changes…');
        if (editSession === session) $('book-edit-error').textContent = '';
        try {
          const { book } = await api(`books/${session.id}`, { method: 'PATCH', body: { name: session.name, tags: [...session.tags] } });
          if (session.authVersion !== authVersion) return;
          session.savedRevision = revision;
          books = books.map(item => item.id === book.id ? { ...item, name: book.name, tags: book.tags } : item);
          allTags = [...new Set(books.flatMap(item => item.tags))].sort((a, b) => a.localeCompare(b));
          if (!allTags.includes(activeTag)) activeTag = '';
          render();
        } catch (error) {
          if (session.authVersion !== authVersion) return;
          editStatus(session, 'Changes could not be saved.', true);
          session.error = error.message;
          if (editSession === session) $('book-edit-error').textContent = error.message;
          if (!$('book-edit-dialog').open || editSession !== session) toast(`Book changes were not saved: ${error.message}`);
          return;
        }
      }
      editStatus(session, 'All changes saved.');
      session.error = '';
    } finally { session.saving = false; }
  }
  function commitName() {
    if (!editSession || editSession.authVersion !== authVersion) return;
    const input = $('book-edit-name');
    if (!input.checkValidity() || !input.value.trim()) {
      $('book-edit-error').textContent = 'Enter a book name of 1–200 characters.';
      return;
    }
    const name = input.value.trim();
    if (name !== editSession.name) { editSession.name = name; editSession.revision++; void saveEdit(editSession); }
  }
  function render() {
    const filters = $('book-filters'); filters.replaceChildren();
    const filter = (label, value) => {
      const node = button(label, () => { activeTag = value; render(); }, value ? tagClass(value) : 'book-tag book-all-tag');
      node.setAttribute('aria-pressed', String(activeTag === value)); filters.append(node);
    };
    filter('All books', '');
    for (const tag of allTags) filter(tag, tag);
    const query = $('book-search').value.trim().toLowerCase();
    const visible = books.filter(book => (!activeTag || book.tags.includes(activeTag)) && `${book.name} ${book.tags.join(' ')}`.toLowerCase().includes(query));
    $('book-count').textContent = activeTag || query ? `${visible.length} / ${books.length}` : books.length;
    $('book-empty').hidden = books.length !== 0;
    $('book-no-results').hidden = books.length === 0 || visible.length !== 0;
    $('book-table-wrap').hidden = visible.length === 0;
    const rows = $('book-rows'); rows.replaceChildren();
    for (const book of visible) {
      const row = el('tr', `book-entry${book.completed ? ' is-completed' : ''}`); row.setAttribute('aria-label', `${book.name}${book.completed ? ', completed' : ''}, edit details`); row.tabIndex = 0;
      row.addEventListener('click', event => {
        if (!event.target.closest('a, button, input')) openEdit(book);
      });
      row.addEventListener('keydown', event => {
        if (event.target === row && ['Enter', ' '].includes(event.key)) { event.preventDefault(); openEdit(book); }
      });
      const base = `/api/admin/books/${book.id}`;
      const previewUrl = `/admin/book-reader?book=${book.id}#page=${book.bookmarkPage ?? 1}`;
      const cover = el('a', 'book-cover'); cover.href = previewUrl; cover.target = '_blank'; cover.rel = 'noopener'; cover.setAttribute('aria-label', `Read ${book.name}`);
      const image = el('img'); image.src = `${base}/thumbnail`; image.alt = `First page of ${book.name}`; image.loading = 'lazy'; image.width = 48; image.height = 66; cover.append(image);
      const title = el('div', 'book-title');
      const preview = el('a', 'book-name', book.name); preview.href = previewUrl; preview.target = '_blank'; preview.rel = 'noopener';
      if (book.bookmarkPage) { cover.title = preview.title = `Resume at PDF page ${book.bookmarkPage}`; }
      const fileMeta = el('span', 'book-file-meta', `PDF · ${(book.size / 1024 / 1024).toFixed(1)} MB`);
      if (book.completed) fileMeta.append(el('span', 'book-completed-label', ' · Completed'));
      title.append(preview, fileMeta);
      const pages = el('span', 'book-pages', format.format(book.pages)); pages.setAttribute('aria-label', `${book.pages} pages`);
      const pageInfo = el('div', 'book-page-info');
      const bookmark = button('', () => openBookmark(book), `book-bookmark${book.bookmarkPage ? ' is-bookmarked' : ''}`);
      bookmark.append(icon('bookmark'), el('span', '', book.bookmarkPage ? `p. ${format.format(book.bookmarkPage)}` : 'Set page'));
      bookmark.setAttribute('aria-label', `Bookmark page for ${book.name}`);
      bookmark.title = book.bookmarkPage ? `Saved at PDF page ${book.bookmarkPage} of ${book.pages}. Click to update.` : 'Save your current PDF page';
      pageInfo.append(pages, bookmark);
      const tags = el('div', 'book-row-tags');
      for (const tag of book.tags) tags.append(button(tag, () => { activeTag = tag; render(); }, tagClass(tag)));
      const edit = button(book.tags.length ? '＋' : '＋ Add tags', () => openEdit(book), 'book-add-tags'); edit.setAttribute('aria-label', `Edit tags for ${book.name}`); tags.append(edit);
      const actions = el('div', 'book-actions');
      const complete = button('', () => void toggleComplete(book, complete), 'action-button book-completion');
      complete.dataset.bookId = book.id;
      complete.title = book.completed ? 'Mark incomplete' : 'Mark complete';
      complete.setAttribute('aria-label', `Mark ${book.name} as ${book.completed ? 'incomplete' : 'complete'}`);
      complete.setAttribute('aria-pressed', String(Boolean(book.completed)));
      complete.disabled = completing.has(book.id);
      complete.append(icon('verified'));
      const notes = button('', () => void openNotes(book), `action-button${book.hasNotes ? ' has-notes' : ''}`);
      notes.dataset.bookNotesId = book.id;
      notes.title = book.hasNotes ? 'Edit notes' : 'Add notes'; notes.setAttribute('aria-label', `Notes for ${book.name}`); notes.append(icon('notes'));
      const download = el('a', 'action-button'); download.href = `${base}/pdf?download=1`; download.download = `${book.name}.pdf`; download.title = 'Download PDF'; download.setAttribute('aria-label', `Download ${book.name}`); download.append(icon('download'));
      const remove = button('', () => { deleting = book; $('book-delete-name').textContent = book.name; $('book-delete-error').textContent = ''; $('book-delete-dialog').showModal(); }, 'action-button destructive');
      remove.title = 'Delete book'; remove.setAttribute('aria-label', `Delete ${book.name}`); remove.append(icon('trash'));
      actions.append(complete, notes, download, remove);
      for (const [className, node] of [['book-cover-cell', cover], ['book-title-cell', title], ['book-pages-cell', pageInfo], ['book-tags-cell', tags], ['book-actions-cell', actions]]) {
        const cell = el('td', className); cell.append(node); row.append(cell);
      }
      rows.append(row);
    }
  }
  async function toggleComplete(book, control) {
    if (completing.has(book.id)) return;
    const currentAuth = authVersion, hadFocus = document.activeElement === control;
    completing.add(book.id); control.disabled = true;
    try {
      const { book: saved } = await api(`books/${book.id}/completion`, { method: 'PATCH', body: { completed: !book.completed } });
      if (currentAuth !== authVersion) return;
      books = books.map(item => item.id === book.id ? { ...item, completed: saved.completed } : item);
      completing.delete(book.id); render();
      toast(saved.completed ? 'Book marked complete.' : 'Book marked incomplete.');
    } catch (error) { if (currentAuth === authVersion) toast(`Book status was not saved: ${error.message}`); }
    finally {
      if (currentAuth === authVersion) {
        completing.delete(book.id); control.disabled = false;
        const current = [...$('book-rows').querySelectorAll('.book-completion')].find(node => node.dataset.bookId === book.id);
        if (current) current.disabled = false;
        if (hadFocus && document.activeElement === document.body) current?.focus({ preventScroll: true });
      }
    }
  }
  async function refresh() {
    const current = ++version;
    $('book-error').textContent = ''; $('book-loading').hidden = false;
    try {
      const data = await api('books');
      if (current !== version) return;
      books = data.books; allTags = data.tags;
      if (!allTags.includes(activeTag)) activeTag = '';
      render();
    } finally { if (current === version) $('book-loading').hidden = true; }
  }
  function openUpload() {
    $('book-upload-form').reset(); uploadTags.set([]);
    $('book-upload-error').textContent = ''; $('book-upload-progress').textContent = '';
    $('book-upload-dialog').showModal();
  }
  function openEdit(book) {
    editing = book;
    const previous = editSessions.get(book.id);
    editSession = previous && previous.savedRevision < previous.revision ? previous : { id: book.id, name: book.name, tags: [...book.tags], revision: 0, savedRevision: 0, saving: false, authVersion };
    editSessions.set(book.id, editSession);
    $('book-edit-name').value = editSession.name; editTags.set(editSession.tags); $('book-edit-error').textContent = editSession.error ?? '';
    editStatus(editSession, editSession.error ? 'Changes could not be saved.' : editSession.saving ? 'Saving changes…' : 'Changes save automatically.', Boolean(editSession.error));
    $('book-edit-dialog').showModal();
  }
  function openBookmark(book) {
    bookmarking = book;
    $('book-bookmark-name').textContent = book.name;
    $('book-bookmark-page').value = book.bookmarkPage ?? '';
    $('book-bookmark-page').max = book.pages;
    $('book-bookmark-hint').textContent = `Use the PDF page number, from 1 to ${format.format(book.pages)}.`;
    $('book-bookmark-error').textContent = '';
    $('book-bookmark-clear').hidden = book.bookmarkPage == null;
    $('book-bookmark-dialog').showModal(); $('book-bookmark-page').focus(); $('book-bookmark-page').select();
  }
  async function saveBookmark(page) {
    if (!bookmarking || pending.has('bookmark')) return;
    const book = bookmarking, currentAuth = authVersion;
    busy('bookmark', true); $('book-bookmark-error').textContent = '';
    try {
      const result = await api(`books/${book.id}/bookmark`, { method: 'PATCH', body: { page } });
      if (currentAuth !== authVersion) return;
      books = books.map(item => item.id === book.id ? { ...item, bookmarkPage: result.book.bookmarkPage } : item);
      render(); $('book-bookmark-dialog').close();
      toast(page == null ? 'Bookmark cleared.' : `Saved at PDF page ${page}. Click the cover or title to resume.`);
    } catch (error) { if (currentAuth === authVersion) $('book-bookmark-error').textContent = error.message; }
    finally { busy('bookmark', false); }
  }
  function busy(prefix, value) {
    if (value) pending.add(prefix); else pending.delete(prefix);
    for (const control of $(`book-${prefix}-form`).elements) control.disabled = value;
  }
  for (const prefix of ['upload', 'edit', 'delete', 'bookmark']) {
    for (const action of ['close', 'cancel']) $(`book-${prefix}-${action}`).addEventListener('click', () => $(`book-${prefix}-dialog`).close());
    $(`book-${prefix}-dialog`).addEventListener('cancel', event => { if (pending.has(prefix)) event.preventDefault(); });
  }
  $('book-new').addEventListener('click', openUpload);
  $('book-empty-upload').addEventListener('click', openUpload);
  $('book-search').addEventListener('input', render);
  $('book-files').addEventListener('change', () => { $('book-upload-name').disabled = $('book-files').files.length !== 1; });
  $('book-refresh').addEventListener('click', () => refresh().catch(error => { $('book-error').textContent = error.message; }));
  $('book-upload-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (pending.has('upload')) return;
    const files = [...$('book-files').files], tags = uploadTags.get();
    if (!tags) return;
    const customName = $('book-upload-name').value.trim();
    if (files.some(file => !/\.pdf$/i.test(file.name) || file.size > 100 * 1024 * 1024)) { $('book-upload-error').textContent = 'Choose PDF files up to 100 MB each.'; return; }
    const current = version;
    busy('upload', true); $('book-upload-error').textContent = '';
    let uploaded = 0; const failed = [], errors = [];
    try {
      for (const [index, file] of files.entries()) {
        if (current !== version) return;
        $('book-upload-progress').textContent = `Processing ${index + 1} of ${files.length}: ${file.name}`;
        try {
          const query = new URLSearchParams({ name: files.length === 1 && customName ? customName : file.name.replace(/\.pdf$/i, ''), tags: JSON.stringify(tags) });
          await api(`books?${query}`, { method: 'POST', body: file, pdf: true }); uploaded++;
        } catch (error) { failed.push(file); errors.push(`${file.name}: ${error.message}`); }
      }
      if (current !== version) return;
      if (uploaded) { await refresh(); toast(`${uploaded} ${uploaded === 1 ? 'book added' : 'books added'} to your library.`); }
      if (!failed.length) $('book-upload-dialog').close();
      else {
        const remaining = new DataTransfer(); failed.forEach(file => remaining.items.add(file)); $('book-files').files = remaining.files;
        $('book-upload-error').textContent = errors.join('\n');
        $('book-upload-progress').textContent = `${uploaded} uploaded. ${failed.length} could not be added.`;
      }
    } catch (error) { $('book-upload-error').textContent = error.message; }
    finally { busy('upload', false); $('book-upload-name').disabled = $('book-files').files.length !== 1; }
  });
  $('book-edit-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!editing) return;
    editTags.get(); commitName();
  });
  $('book-edit-name').addEventListener('change', commitName);
  $('book-edit-dialog').addEventListener('close', commitName);
  $('book-edit-retry').addEventListener('click', () => { if (editSession) void saveEdit(editSession); });
  $('book-bookmark-form').addEventListener('submit', event => {
    event.preventDefault();
    if ($('book-bookmark-page').reportValidity()) void saveBookmark(Number($('book-bookmark-page').value));
  });
  $('book-bookmark-clear').addEventListener('click', () => { void saveBookmark(null); });
  $('book-delete-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!deleting || pending.has('delete')) return;
    busy('delete', true); $('book-delete-error').textContent = '';
    try { await api(`books/${deleting.id}`, { method: 'DELETE', body: {} }); $('book-delete-dialog').close(); await refresh(); toast('Book deleted.'); }
    catch (error) { $('book-delete-error').textContent = error.message; }
    finally { busy('delete', false); }
  });
  return { refresh, reset() {
    clearTimeout(noteSession?.timer); clearTimeout(noteSession?.previewTimer); noteSession = null;
    $('book-notes-dialog').close(); noteInput.value = ''; $('book-notes-preview').replaceChildren();
    authVersion++; editSession = null; editSessions.clear(); completing.clear();
    version++; books = []; allTags = []; activeTag = ''; editing = null; deleting = null; bookmarking = null;
    $('book-search').value = ''; $('book-rows').replaceChildren(); $('book-filters').replaceChildren();
    for (const prefix of ['upload', 'edit', 'delete', 'bookmark']) $(`book-${prefix}-dialog`).close();
  } };
}
