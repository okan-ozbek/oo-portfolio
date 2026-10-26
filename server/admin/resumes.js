const $ = id => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const slugify = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '');
const format = new Intl.NumberFormat();
const encodeFile = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
  reader.readAsDataURL(file);
});

export function initResumes({ api, toast, refreshLinks }) {
  let selected = null, copying = null, deleting = null, pending = false, dirty = false, version = 0;
  function reset() {
    version++;
    selected = null;
    $('resume-library').replaceChildren();
    $('resume-detected-links').replaceChildren();
    $('resume-editor').hidden = true;
    for (const name of ['upload', 'copy', 'delete']) $(`resume-${name}-dialog`).close();
  }
  function setDirty(value) {
    dirty = value;
    $('resume-publish').disabled = value;
    $('resume-build-note').textContent = value ? 'Unsaved selections. Build your draft before publishing.' : 'Draft ready. Publish to update the shared PDF.';
  }
  function button(text, action, className = 'secondary') {
    const node = el('button', className, text);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('PDF link copied.'); }
    catch { toast('Copy is unavailable. Select the PDF URL to copy it.'); }
  }
  function showDetail(resume) {
    selected = resume;
    $('resume-editor').hidden = false;
    $('resume-editor-title').textContent = resume.name;
    $('resume-editor-meta').textContent = `${resume.pages} ${resume.pages === 1 ? 'page' : 'pages'} · ${resume.files.length} source files · ${resume.mainFile}`;
    $('resume-preview').href = `/api/admin/resumes/${resume.id}/pdf`;
    $('resume-download').href = `/api/admin/resumes/${resume.id}/pdf?download=1`;
    $('resume-default').checked = resume.isDefault;
    $('resume-build-error').textContent = '';
    $('resume-detected-links').replaceChildren();
    for (const link of resume.links) {
      const row = el('article', 'resume-link-row');
      const header = el('div', 'resume-link-top');
      const label = el('label', 'resume-track-label');
      const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = link.tracked; checkbox.disabled = !link.trackable;
      checkbox.dataset.key = link.key;
      label.append(checkbox, el('span', '', link.trackable ? 'Track this destination' : 'Keep original destination'));
      header.append(label, el('span', 'field-note', `${link.occurrences} ${link.occurrences === 1 ? 'link' : 'links'} · page ${link.pages.join(', ')}`));
      row.append(header, el('p', 'resume-destination', link.destination));
      if (link.trackable) {
        const fields = el('div', 'resume-link-fields');
        const nameLabel = el('label', '', 'Link name');
        const name = el('input'); name.value = link.label; name.maxLength = 100; name.dataset.field = 'label'; name.disabled = !link.tracked; name.required = true;
        nameLabel.append(name);
        const slugLabel = el('label', '', 'Tracking URL');
        const slug = el('input'); slug.value = link.slug; slug.pattern = '[a-z0-9]+(-[a-z0-9]+)*'; slug.maxLength = 80; slug.dataset.field = 'slug'; slug.readOnly = Boolean(link.linkId); slug.disabled = !link.tracked; slug.required = true;
        const prefix = el('div', 'slug-field'); prefix.append(el('span', '', '/r/'), slug); slugLabel.append(prefix);
        fields.append(nameLabel, slugLabel); row.append(fields);
        checkbox.addEventListener('change', () => { name.disabled = !checkbox.checked; slug.disabled = !checkbox.checked; setDirty(true); });
        if (link.linkId) { name.readOnly = true; row.append(el('p', 'field-note', link.enabled ? 'Already connected. Edit its name or pause it in Link analytics.' : 'This tracking link is paused. Activate it in Link analytics before sharing.')); }
      } else row.append(el('p', 'field-note', 'Only external HTTP(S) destinations can be tracked. Email, phone, and internal PDF links keep their original behavior.'));
      row.addEventListener('input', () => setDirty(true));
      $('resume-detected-links').append(row);
    }
    if (!resume.links.length) $('resume-detected-links').append(el('p', 'muted', 'No external hyperlinks were found. The PDF is ready to preview and publish.'));
    setDirty(false);
    $('resume-publish').textContent = resume.published ? 'Publish current draft ↗' : 'Publish PDF ↗';
  }
  async function loadDetail(id) {
    const revision = ++version;
    const { resume } = await api(`resumes/${id}`);
    if (revision !== version) return;
    showDetail(resume);
    for (const card of $('resume-library').children) card.classList.toggle('selected', card.dataset.id === id);
  }
  async function refresh() {
    const { resumes } = await api('resumes');
    $('resume-library').replaceChildren();
    $('resume-empty').hidden = resumes.length > 0;
    for (const resume of resumes) {
      const card = el('article', `resume-card${selected?.id === resume.id ? ' selected' : ''}`); card.dataset.id = resume.id;
      const top = el('div', 'resume-card-top');
      top.append(el('span', 'resume-paper-icon', '▤'), el('span', `resume-badge${resume.published ? ' live' : ''}`, resume.isDefault ? 'ON YOUR WEBSITE' : resume.published ? 'PUBLISHED' : 'DRAFT'));
      card.append(top, button(resume.name, () => loadDetail(resume.id).catch(error => toast(error.message)), 'resume-card-title'), el('p', 'field-note', `${resume.pages} ${resume.pages === 1 ? 'page' : 'pages'} · ${resume.trackedLinks} tracked destinations`));
      const stats = el('div', 'resume-card-stats');
      for (const [number, label] of [[resume.downloads, 'DOWNLOADS'], [resume.clicks, 'LINK CLICKS']]) { const stat = el('div'); stat.append(el('strong', '', format.format(number)), el('span', '', label)); stats.append(stat); }
      card.append(stats);
      const url = el('p', 'resume-public-url', `/resumes/${resume.slug}.pdf`); url.title = resume.url; card.append(url);
      if (resume.published && resume.unpublishedChanges) card.append(el('p', 'field-note', 'New draft waiting to be published.'));
      const actions = el('div', 'resume-card-actions');
      actions.append(button('Manage ↗', () => loadDetail(resume.id).then(() => $('resume-editor').scrollIntoView({ behavior: 'smooth', block: 'start' })).catch(error => toast(error.message))));
      if (resume.published) actions.append(button('Copy URL', () => copy(resume.url), 'text-button'));
      actions.append(button('Duplicate', () => {
        copying = resume; $('resume-copy-name').value = `${resume.name.slice(0, 70)} copy`; $('resume-copy-slug').value = `${resume.slug.slice(0, 50)}-copy`; $('resume-copy-error').textContent = ''; $('resume-copy-dialog').showModal();
      }, 'text-button'));
      if (resume.published) actions.append(button('Unpublish', () => perform($('resumes-view'), async () => {
        await api(`resumes/${resume.id}`, { method: 'PATCH', body: { published: false } }); await refresh(); if (selected?.id === resume.id) await loadDetail(resume.id); toast('Resume unpublished. Its tracking links still work.');
      }, 'resume-error'), 'text-button'));
      const remove = button('', () => { deleting = resume; $('resume-delete-name').textContent = resume.name; $('resume-delete-error').textContent = ''; $('resume-delete-dialog').showModal(); }, 'icon-button resume-trash');
      remove.setAttribute('aria-label', `Delete resume ${resume.name}`);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', 'M3 6h14M8 3h4l1 3H7l1-3ZM5 6l1 11h8l1-11M8 9v5M12 9v5'); svg.append(path); remove.append(svg); actions.append(remove); card.append(actions);
      $('resume-library').append(card);
    }
    if (selected && !resumes.some(resume => resume.id === selected.id)) { selected = null; $('resume-editor').hidden = true; }
  }
  async function perform(scope, work, errorId) {
    if (pending) return;
    pending = true; $(errorId).textContent = '';
    const controls = [...scope.querySelectorAll('button,input')].filter(node => !node.disabled);
    controls.forEach(node => { node.disabled = true; });
    try { await work(); } catch (error) { $(errorId).textContent = error.message; }
    finally { pending = false; controls.filter(node => node.isConnected).forEach(node => { node.disabled = false; }); if (dirty) $('resume-publish').disabled = true; }
  }
  function openUpload() {
    $('resume-upload-form').reset(); delete $('resume-slug').dataset.edited; $('resume-upload-error').textContent = ''; $('resume-upload-dialog').showModal();
  }
  for (const id of ['resume-new', 'resume-empty-upload']) $(id).addEventListener('click', openUpload);
  for (const name of ['upload', 'copy', 'delete']) {
    for (const suffix of ['close', 'cancel']) $(`resume-${name}-${suffix}`).addEventListener('click', () => { if (!pending) $(`resume-${name}-dialog`).close(); });
    $(`resume-${name}-dialog`).addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  }
  $('resume-name').addEventListener('input', () => { if (!$('resume-slug').dataset.edited) $('resume-slug').value = slugify($('resume-name').value); });
  $('resume-slug').addEventListener('input', () => { $('resume-slug').dataset.edited = 'true'; });
  $('resume-upload-form').addEventListener('submit', event => {
    event.preventDefault();
    perform($('resume-upload-dialog'), async () => {
      const main = $('resume-main').files[0];
      const files = new Map();
      const supported = /\.(tex|sty|cls|clo|bib|bst|bbx|cbx|lbx|def|cfg|fd|enc|map|ttf|otf|woff|png|jpg|jpeg|pdf|eps)$/i;
      for (const file of $('resume-folder').files) {
        const path = file.webkitRelativePath.split('/').slice(1).join('/');
        if (path.split('/').some(part => part.startsWith('.') || ['build', 'node_modules'].includes(part)) || !supported.test(path)) continue;
        files.set(path, file);
      }
      let mainFile = main.name;
      const candidates = [...files].filter(([, file]) => file.name === main.name);
      if (candidates.length > 1) throw new Error('The folder has multiple files with the main filename. Use a distinct filename.');
      if (candidates.length === 1) mainFile = candidates[0][0];
      for (const file of $('resume-support').files) files.set(file.name, file);
      files.set(mainFile, main);
      if (files.size > 80 || [...files.values()].reduce((sum, file) => sum + file.size, 0) > 10 * 1024 * 1024) throw new Error('Upload at most 80 files and 10 MB total.');
      $('resume-upload-progress').hidden = false;
      try {
        const body = { name: $('resume-name').value, slug: $('resume-slug').value, mainFile, files: await Promise.all([...files].map(async ([path, file]) => ({ path, content: await encodeFile(file) }))) };
        const { resume } = await api('resumes', { method: 'POST', body });
        showDetail(resume); await refresh(); $('resume-upload-dialog').close(); toast('Resume compiled. Choose which links to track.');
      } finally { $('resume-upload-progress').hidden = true; }
    }, 'resume-upload-error');
  });
  $('resume-links-form').addEventListener('submit', event => {
    event.preventDefault(); if (!selected) return;
    const links = [...$('resume-detected-links').children].filter(row => row.querySelector('input[data-key]')).map(row => ({ key: row.querySelector('input[data-key]').dataset.key, tracked: row.querySelector('input[data-key]').checked, slug: row.querySelector('[data-field=slug]')?.value, label: row.querySelector('[data-field=label]')?.value }));
    perform($('resumes-view'), async () => {
      $('resume-build').textContent = 'Building PDF…';
      try { const { resume } = await api(`resumes/${selected.id}/compile`, { method: 'POST', body: { links } }); showDetail(resume); await refresh(); await refreshLinks(); toast('Tracking connected. Your draft PDF is ready.'); }
      finally { $('resume-build').textContent = 'Save tracking & build PDF ↗'; }
    }, 'resume-build-error');
  });
  $('resume-publish').addEventListener('click', () => {
    if (!selected || dirty) return;
    perform($('resumes-view'), async () => {
      const { resume } = await api(`resumes/${selected.id}/publish`, { method: 'POST', body: { makeDefault: $('resume-default').checked } });
      showDetail(resume); await refresh(); toast('PDF published. Your share link is ready.');
    }, 'resume-build-error');
  });
  $('resume-copy-form').addEventListener('submit', event => {
    event.preventDefault(); if (!copying) return;
    perform($('resume-copy-dialog'), async () => {
      const { resume } = await api(`resumes/${copying.id}/duplicate`, { method: 'POST', body: { name: $('resume-copy-name').value, slug: $('resume-copy-slug').value } });
      showDetail(resume); await refresh(); $('resume-copy-dialog').close(); toast('Variant created with its own tracking setup.');
    }, 'resume-copy-error');
  });
  $('resume-delete-form').addEventListener('submit', event => {
    event.preventDefault(); if (!deleting) return;
    perform($('resume-delete-dialog'), async () => {
      await api(`resumes/${deleting.id}`, { method: 'DELETE', body: {} }); await refresh(); await refreshLinks(); $('resume-delete-dialog').close(); toast('Resume, its links, and tracking history deleted.');
    }, 'resume-delete-error');
  });
  return { refresh, reset };
}
