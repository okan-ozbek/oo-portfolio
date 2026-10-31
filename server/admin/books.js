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
  let books = [], allTags = [], activeTag = '', editing = null, deleting = null, version = 0;
  const pending = new Set();
  function tagEditor(prefix) {
    const root = $(`book-${prefix}-tags`);
    let tags = [];
    const chips = el('div', 'book-tag-chips');
    const input = el('input'); input.id = `book-${prefix}-tag-input`; input.maxLength = 60; input.placeholder = 'Add a tag…';
    input.autocomplete = 'off';
    const suggestions = el('div', 'book-tag-suggestions');
    root.append(chips, input, suggestions);
    function add(value) {
      const tag = value.trim();
      if (!tag) return;
      if (!tags.some(item => item.toLowerCase() === tag.toLowerCase())) {
        if (tags.length >= 20) { input.setCustomValidity('Use up to 20 tags.'); input.reportValidity(); return; }
        tags.push(allTags.find(item => item.toLowerCase() === tag.toLowerCase()) ?? tag);
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
        const remove = button('×', () => { tags = tags.filter(item => item !== tag); render(); }, 'book-tag-remove');
        remove.setAttribute('aria-label', `Remove tag ${tag}`);
        chip.append(el('span', '', tag), remove); chips.append(chip);
      }
      renderSuggestions();
    }
    input.addEventListener('input', () => { input.setCustomValidity(''); renderSuggestions(); });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); add(input.value); }
      if (event.key === 'Backspace' && !input.value) { tags.pop(); render(); }
    });
    return { set(value) { tags = [...value]; input.value = ''; input.setCustomValidity(''); render(); }, get() { add(input.value); return input.checkValidity() ? [...tags] : null; } };
  }
  const uploadTags = tagEditor('upload'), editTags = tagEditor('edit');
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
    const rows = $('book-rows'); rows.replaceChildren();
    for (const book of visible) {
      const row = el('article', 'book-row'); row.setAttribute('aria-label', book.name);
      const base = `/api/admin/books/${book.id}`;
      const cover = el('a', 'book-cover'); cover.href = `${base}/pdf`; cover.target = '_blank'; cover.rel = 'noopener'; cover.setAttribute('aria-label', `Read ${book.name}`);
      const image = el('img'); image.src = `${base}/thumbnail`; image.alt = `First page of ${book.name}`; image.loading = 'lazy'; image.width = 48; image.height = 66; cover.append(image);
      const title = el('div', 'book-title');
      title.append(button(book.name, () => openEdit(book), 'book-name'), el('span', 'book-file-meta', `PDF · ${(book.size / 1024 / 1024).toFixed(1)} MB`));
      const pages = el('span', 'book-pages', format.format(book.pages)); pages.setAttribute('aria-label', `${book.pages} pages`);
      const tags = el('div', 'book-row-tags');
      for (const tag of book.tags) tags.append(button(tag, () => { activeTag = tag; render(); }, tagClass(tag)));
      const edit = button(book.tags.length ? '＋' : '＋ Add tags', () => openEdit(book), 'book-add-tags'); edit.setAttribute('aria-label', `Edit tags for ${book.name}`); tags.append(edit);
      const actions = el('div', 'book-actions');
      const read = el('a', 'text-button', 'Read ↗'); read.href = `${base}/pdf`; read.target = '_blank'; read.rel = 'noopener';
      const download = el('a', 'secondary link-button', 'Download ↓'); download.href = `${base}/pdf?download=1`; download.download = `${book.name}.pdf`;
      const remove = button('Delete', () => { deleting = book; $('book-delete-name').textContent = book.name; $('book-delete-error').textContent = ''; $('book-delete-dialog').showModal(); }, 'book-delete-button');
      actions.append(read, download, remove); row.append(cover, title, pages, tags, actions); rows.append(row);
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
    editing = book; $('book-edit-name').value = book.name; editTags.set(book.tags); $('book-edit-error').textContent = ''; $('book-edit-dialog').showModal();
  }
  function busy(prefix, value) {
    if (value) pending.add(prefix); else pending.delete(prefix);
    for (const control of $(`book-${prefix}-form`).elements) control.disabled = value;
  }
  for (const prefix of ['upload', 'edit', 'delete']) {
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
    event.preventDefault(); if (!editing || pending.has('edit')) return;
    const tags = editTags.get(); if (!tags) return;
    const body = { name: $('book-edit-name').value, tags };
    busy('edit', true); $('book-edit-error').textContent = '';
    try { await api(`books/${editing.id}`, { method: 'PATCH', body }); $('book-edit-dialog').close(); await refresh(); toast('Book updated.'); }
    catch (error) { $('book-edit-error').textContent = error.message; }
    finally { busy('edit', false); }
  });
  $('book-delete-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!deleting || pending.has('delete')) return;
    busy('delete', true); $('book-delete-error').textContent = '';
    try { await api(`books/${deleting.id}`, { method: 'DELETE', body: {} }); $('book-delete-dialog').close(); await refresh(); toast('Book deleted.'); }
    catch (error) { $('book-delete-error').textContent = error.message; }
    finally { busy('delete', false); }
  });
  return { refresh, reset() {
    version++; books = []; allTags = []; activeTag = ''; editing = null; deleting = null;
    $('book-search').value = ''; $('book-rows').replaceChildren(); $('book-filters').replaceChildren();
    for (const prefix of ['upload', 'edit', 'delete']) $(`book-${prefix}-dialog`).close();
  } };
}
