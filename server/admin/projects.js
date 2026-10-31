import { icon } from './icons.js';
import { technicalPresets, projectPresets, artworkNode, enhanceArtwork } from '/blog/assets/visuals.js';
const $ = id => document.getElementById(id);
const fields = ['title', 'caption', 'description', 'url', 'state'];
const node = (tag, className, text) => { const item = document.createElement(tag); item.className = className; if (text !== undefined) item.textContent = text; return item; };
const details = project => Object.fromEntries([...fields, 'thumbnail'].map(key => [key, project[key]]));

export function initProjects({ api, toast }) {
  let projects = [], editor = null, baseline = '', busy = false, epoch = 0;
  const dirty = () => editor && JSON.stringify(details(editor)) !== baseline;
  const leave = async () => {
    if (busy || (dirty() && !window.confirm('Discard unsaved project changes?'))) return false;
    if (editor) showLibrary();
    return true;
  };
  function showLibrary() { editor = null; $('project-editor').hidden = true; $('project-library').hidden = false; $('project-new').focus(); }
  function renderList() {
    const query = $('project-search').value.toLowerCase(), filter = $('project-filter').value;
    const visible = projects.filter(project => (filter === 'all' || project.state === filter) && [project.title, project.caption, project.description].join(' ').toLowerCase().includes(query));
    $('project-count').textContent = String(projects.length); $('project-rows').replaceChildren(); $('project-empty').hidden = visible.length > 0;
    for (const project of visible) {
      const row = node('tr', 'project-library-row');
      const artwork = artworkNode({ preset: project.thumbnail }, project.id, false, 'project-library-art');
      const copy = node('div', 'project-library-copy');
      const titleLine=node('div','project-title-line');titleLine.append(node('strong','',project.title));
      copy.append(titleLine,node('p','muted',project.caption || project.description));
      if (project.state === 'published' && project.url) { const link = node('a', 'project-destination', `(${project.url})`); link.href = project.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; titleLine.append(link); }
      const state = node('span', `blog-status ${project.state}`, { draft: 'Draft', teaser: 'Coming soon', published: 'Published' }[project.state]);
      const edit = node('button', 'action-button');edit.append(icon('edit'));edit.title='Edit project'; edit.type = 'button'; edit.setAttribute('aria-label', `Edit ${project.title}`); edit.addEventListener('click', () => open(project));
      const identity=node('td','project-identity'),status=node('td','project-status-cell'),actions=node('td','project-actions-cell');const inner=node('div','project-identity-inner');inner.append(artwork,copy);identity.append(inner);status.append(state);actions.append(edit);const views=node('td','unique-views',new Intl.NumberFormat().format(project.uniqueViews??0));views.setAttribute('aria-label',`${project.uniqueViews??0} unique device views`);row.append(identity,status,views,actions);$('project-rows').append(row);
    }
    enhanceArtwork($('project-rows'));
  }
  async function refresh() { const current = epoch; const data = await api('projects'); if (current !== epoch) return; projects = data.projects; renderList(); }
  function renderState() {
    $('project-state-note').textContent = { draft: 'Only visible in this workspace.', teaser: 'Shown on the homepage as Coming soon. The destination stays private.', published: 'Visible on the homepage with a link to its destination.' }[editor.state];
    $('project-url').required = editor.state === 'published';
    $('project-save-status').textContent = dirty() ? 'Unsaved changes' : editor.id ? 'All changes saved' : 'New project';
  }
  function renderArtwork() {
    $('project-selected-preview').replaceChildren(artworkNode({ preset: editor.thumbnail }, editor.id ?? 'new-project'));
    for (const [id, collection] of [['project-original-presets', projectPresets], ['project-technical-presets', technicalPresets]]) {
      $(id).replaceChildren();
      for (const preset of collection) {
        const choice = node('button', 'blog-preset'); choice.type = 'button'; choice.setAttribute('aria-label', `Use ${preset.name} thumbnail`); choice.setAttribute('aria-pressed', String(editor.thumbnail === preset.id));
        const caption = node('div', 'blog-preset-caption'); caption.append(node('strong', '', preset.name), node('small', '', preset.topic), node('i', 'blog-preset-check', editor.thumbnail === preset.id ? '✓' : '↗'));
        choice.append(artworkNode({ preset: preset.id }, editor.id ?? 'new-project'), caption);
        choice.addEventListener('click', () => { editor.thumbnail = preset.id; renderArtwork(); renderState(); }); $(id).append(choice);
      }
    }
    enhanceArtwork($('project-editor'));
  }
  function open(project) {
    editor = structuredClone(project ?? { title: '', caption: '', description: '', url: '', state: 'draft', thumbnail: 'project-network' }); baseline = JSON.stringify(details(editor));
    for (const field of fields) $(`project-${field}`).value = editor[field];
    $('project-editor-heading').textContent = project ? 'Edit project' : 'Create project'; $('project-delete').hidden = !project;
    $('project-error').textContent = ''; $('project-library').hidden = true; $('project-editor').hidden = false;
    renderState(); renderArtwork(); $('project-title').focus();
  }
  for (const field of fields) $(`project-${field}`).addEventListener('input', () => { if (!editor) return; editor[field] = $(`project-${field}`).value; renderState(); });
  $('project-new').addEventListener('click', () => open());
  $('project-search').addEventListener('input', renderList); $('project-filter').addEventListener('change', renderList);
  $('project-back').addEventListener('click', async () => { if (await leave()) showLibrary(); });
  async function save(event) {
    event.preventDefault(); if (!editor || busy || !$('project-form').reportValidity()) return;
    const active = editor, current = epoch; busy = true; $('project-save').disabled = true;
    // Freeze fields while the request is pending so a late response cannot lose typing.
    const controls = [...$('project-form').elements]; controls.forEach(control => control.disabled = true);
    $('project-error').textContent = ''; $('project-save-status').textContent = 'Saving…';
    try {
      const { project } = await api(active.id ? `projects/${active.id}` : 'projects', { method: active.id ? 'PUT' : 'POST', body: { project: details(active), version: active.version } });
      if (current !== epoch) return;
      projects=projects.filter(item=>item.id!==project.id).concat(project).sort((a,b)=>a.position-b.position);renderList();showLibrary();toast('Project saved.');
    } catch (error) { if (current === epoch) { $('project-error').textContent = error.message; $('project-save-status').textContent = 'Changes not saved'; } }
    finally { busy = false; $('project-save').disabled = false; controls.forEach(control => control.disabled = false); }
  }
  $('project-save').addEventListener('click', save); $('project-form').addEventListener('submit', save);
  $('project-delete').addEventListener('click', () => { if (busy) return; $('project-delete-error').textContent = ''; $('project-delete-dialog').showModal(); });
  $('project-delete-cancel').addEventListener('click', () => { if (!busy) $('project-delete-dialog').close(); });
  $('project-delete-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  $('project-delete-confirm').addEventListener('click', async () => {
    if (!editor?.id || busy) return; busy = true; const current = epoch; $('project-delete-confirm').disabled = true;
    try { await api(`projects/${editor.id}`, { method: 'DELETE', body: { version: editor.version } }); if (current !== epoch) return; $('project-delete-dialog').close(); projects=projects.filter(item=>item.id!==editor.id);renderList();showLibrary();toast('Project deleted.'); }
    catch (error) { if (current === epoch) $('project-delete-error').textContent = error.message; }
    finally { busy = false; $('project-delete-confirm').disabled = false; }
  });
  window.addEventListener('beforeunload', event => { if (dirty() || busy) { event.preventDefault(); event.returnValue = ''; } });
  return { refresh, leave, reset() { epoch++; editor = null; projects = []; $('project-delete-dialog').close(); $('project-editor').hidden = true; $('project-library').hidden = false; $('project-rows').replaceChildren(); } };
}
