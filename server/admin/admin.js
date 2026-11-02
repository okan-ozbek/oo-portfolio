import { renderActivityChart } from './activity-chart.js';
import { readApiResponse } from './api-response.js';
/* The dashboard receives no password hash or secret configuration. */
import { initResumes } from './resumes.js';
import { initBooks } from './books.js';
import { initFilterPicker } from './filter-picker.js';
import { initProjects } from './projects.js';
import { initBlogs } from './blogs.js';
import { icon as actionIcon } from './icons.js';
const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat();
let csrf = "";
let links = [];
let editing = null;
let deleting = null;
let deletePending = false;
const pendingLinks = new Set();
const selectedLinks = new Set();
let bulkPending = false;
let menuTrigger = null;
let toastAnimation;
let refreshVersion = 0;
let activityRange = "30d";
const rangeLabels = { "7d": "Last 7 days", "30d": "Last 30 days", quarter: "Last quarter", year: "Last year" };
const rangeOptions = [...$("activity-range-menu").querySelectorAll("[role=option]")];

for (const dialog of document.querySelectorAll('dialog')) {
  let startedOnBackdrop = false;
  const onBackdrop = event => {
    const bounds = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
  };
  dialog.addEventListener('pointerdown', event => { startedOnBackdrop = event.button === 0 && onBackdrop(event); });
  dialog.addEventListener('pointercancel', () => { startedOnBackdrop = false; });
  dialog.addEventListener('click', event => {
    const dismiss = startedOnBackdrop && onBackdrop(event);
    startedOnBackdrop = false;
    // Match Escape so existing upload/build/delete guards still apply. Requiring
    // both ends outside also keeps a drag from an input from closing the editor.
    if (dismiss && dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close();
  });
  dialog.addEventListener('close', () => { startedOnBackdrop = false; });
}

function setActivityRange(value) {
  activityRange = value;
  $("activity-range-label").textContent = rangeLabels[value];
  $("activity-range").setAttribute("aria-label", `Click activity range: ${rangeLabels[value]}`);
  for (const option of rangeOptions) {
    const selected = option.dataset.range === value;
    option.setAttribute("aria-selected", String(selected));
    option.tabIndex = selected ? 0 : -1;
  }
}

function closeRangeMenu(returnFocus = false) {
  $("activity-range-menu").hidden = true;
  $("activity-range").setAttribute("aria-expanded", "false");
  if (returnFocus) $("activity-range").focus();
}

function openRangeMenu() {
  $("activity-range-menu").hidden = false;
  $("activity-range").setAttribute("aria-expanded", "true");
  const picker = $("activity-range").parentElement;
  picker.classList.remove("opens-above");
  const menu = $("activity-range-menu");
  if (menu.getBoundingClientRect().bottom > window.innerHeight - 12 && $("activity-range").getBoundingClientRect().top > menu.offsetHeight + 20) picker.classList.add("opens-above");
  rangeOptions.find(option => option.dataset.range === activityRange).focus();
}

function showLogin() {
  resumeWorkspace.reset();
  bookWorkspace.reset();
  blogWorkspace.reset();
  projectWorkspace.reset();
  selectSection('links');
  closeRangeMenu();
  closeLinkMenu();
  selectedLinks.clear();
  $("loading").hidden = true;
  $("dashboard").hidden = true;
  $("login-view").hidden = false;
  $("link-dialog").close();
  $("delete-dialog").close();
  deleting = null;
  csrf = "";
  links = [];
  $("link-rows").replaceChildren();
}

function toast(message) {
  toastAnimation?.cancel();
  const notification = $("toast");
  notification.textContent = message;
  notification.hidden = false;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animation = notification.animate(reducedMotion ? [{ opacity: 1 }, { opacity: 1 }] : [
    { opacity: 0, easing: "ease-out" },
    { opacity: 1, offset: 1 / 12 },
    { opacity: 1, offset: 11 / 12, easing: "ease-in" },
    { opacity: 0 },
  ], { duration: reducedMotion ? 2000 : 2400, fill: "forwards" });
  toastAnimation = animation;
  animation.finished.then(() => {
    if (toastAnimation !== animation) return;
    notification.hidden = true;
    animation.cancel();
    toastAnimation = null;
  }, () => {});
}

async function api(path, { method = "GET", body, pdf = false, file } = {}) {
  const response = await fetch(`/api/admin/${path}`, {
    method, credentials: "same-origin", cache: "no-store",
    headers: { ...(method !== "GET" ? { "Content-Type": file ? file.type : pdf ? "application/pdf" : "application/json", "X-CSRF-Token": csrf } : {}) },
    body: file ?? (body === undefined ? undefined : pdf ? body : JSON.stringify(body)),
  });
  if (response.status === 401 && path !== "login") showLogin();
  return readApiResponse(response);
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function filteredLinks() {
  const query = $("search").value.toLowerCase();
  return links.filter(link => [('/r/' + link.slug), link.slug, link.destination, link.source].join(" ").toLowerCase().includes(query));
}

function updateSelection() {
  const existing = new Set(links.map(link => link.id));
  for (const id of selectedLinks) if (!existing.has(id)) selectedLinks.delete(id);
  const visible = filteredLinks();
  const count = visible.filter(link => selectedLinks.has(link.id)).length;
  const hidden = selectedLinks.size - count;
  $("select-all-links").checked = visible.length > 0 && count === visible.length;
  $("select-all-links").indeterminate = count > 0 && count < visible.length;
  $("select-all-links").disabled = !visible.length || bulkPending;
  $("link-bulk-actions").hidden = selectedLinks.size === 0;
  $("link-selection-count").textContent = hidden ? String(selectedLinks.size) + ' selected · ' + hidden + ' hidden' : String(selectedLinks.size) + ' selected';
  const selected = links.filter(link => selectedLinks.has(link.id));
  $("bulk-pause-links").disabled = bulkPending || !selected.some(link => link.enabled);
  $("bulk-activate-links").disabled = bulkPending || !selected.some(link => !link.enabled);
  $("bulk-delete-links").disabled = bulkPending;
  for (const checkbox of $("link-rows").querySelectorAll('[data-select-link]')) {
    checkbox.checked = selectedLinks.has(checkbox.dataset.selectLink);
    checkbox.disabled = bulkPending;
    checkbox.closest('tr').classList.toggle('is-selected', checkbox.checked);
  }
}

function closeLinkMenu(returnFocus = false) {
  const trigger = menuTrigger;
  if ($("link-action-menu").matches(':popover-open')) $("link-action-menu").hidePopover();
  trigger?.setAttribute('aria-expanded', 'false'); menuTrigger = null;
  if (returnFocus && trigger?.isConnected) trigger.focus();
}

function openDeleteLinks(items) {
  closeLinkMenu();
  deleting = items.map(link => ({ id: link.id, label: ('/r/' + link.slug), slug: link.slug }));
  const plural = items.length > 1;
  $("delete-title").textContent = plural ? 'Delete ' + items.length + ' links?' : 'Delete this link?';
  $("delete-link-name").textContent = plural ? items.length + ' selected links' : ('/r/' + items[0].slug);
  $("delete-link-url").textContent = items.map(link => '/r/' + link.slug).join('\n');
  $("delete-warning").textContent = plural ? 'This permanently removes all selected links, their click history, and cooldown records. Their shared URLs will stop working. This cannot be undone.' : 'This permanently removes the link, its click history, and cooldown records. Shared URLs will stop working. This cannot be undone.';
  $("delete-error").textContent = '';
  $("delete-dialog").showModal(); $("cancel-delete").focus();
}

async function setLinksEnabled(items, enabled) {
  if (!items.length || bulkPending) return;
  closeLinkMenu(); bulkPending = true;
  const ids = items.map(link => link.id);
  ids.forEach(id => pendingLinks.add(id)); renderRows();
  try {
    await api('links/bulk', { method: 'POST', body: { ids, action: enabled ? 'activate' : 'pause' } });
    // Apply the confirmed state even if the subsequent statistics refresh fails.
    links = links.map(link => ids.includes(link.id) ? { ...link, enabled } : link);
    renderRows(); await refresh();
    toast(items.length === 1 ? enabled ? 'Link activated.' : 'Link paused. Its history is preserved.' : items.length + (enabled ? ' links activated.' : ' links paused. Their history is preserved.'));
  } catch (error) { toast(error.message); }
  finally { ids.forEach(id => pendingLinks.delete(id)); bulkPending = false; renderRows(); }
}

function openLinkMenu(link, trigger) {
  if (menuTrigger === trigger && $("link-action-menu").matches(':popover-open')) return closeLinkMenu(true);
  closeLinkMenu(); menuTrigger = trigger;
  const menu = $("link-action-menu"); menu.replaceChildren();
  const add = (text, glyph, action, destructive = false) => {
    const item = element('button', destructive ? 'link-menu-item destructive' : 'link-menu-item');
    item.type = 'button'; item.setAttribute('role', 'menuitem'); item.append(actionIcon(glyph), document.createTextNode(text));
    item.addEventListener('click', () => { closeLinkMenu(); action(); }); menu.append(item);
  };
  add('Edit link', 'edit', () => openEditor(link));
  add(link.enabled ? 'Pause link' : 'Activate link', link.enabled ? 'pause' : 'play', () => setLinksEnabled([link], !link.enabled));
  add('Delete link', 'trash', () => openDeleteLinks([link]), true);
  trigger.setAttribute('aria-expanded', 'true'); menu.showPopover();
  const anchor = trigger.getBoundingClientRect(), bounds = menu.getBoundingClientRect();
  menu.style.left = Math.max(12, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 12)) + 'px';
  menu.style.top = (anchor.bottom + bounds.height + 8 > window.innerHeight ? Math.max(12, anchor.top - bounds.height - 8) : anchor.bottom + 8) + 'px';
  menu.querySelector('[role=menuitem]').focus();
}

function renderRows() {
  closeLinkMenu();
  const filtered = filteredLinks();
  $("link-rows").replaceChildren();
  $("empty-state").hidden = links.length > 0;
  $("table-wrap").hidden = filtered.length === 0;
  $("no-results").hidden = links.length === 0 || filtered.length > 0;
  for (const link of filtered) {
    const row = element('tr');
    const selection = element('td', 'link-select-cell');
    const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.dataset.selectLink = link.id; checkbox.setAttribute('aria-label', 'Select ' + ('/r/' + link.slug));
    checkbox.addEventListener('change', () => {
      if (checkbox.checked && selectedLinks.size >= 100) { checkbox.checked = false; return toast('Select up to 100 links at a time.'); }
      if (checkbox.checked) selectedLinks.add(link.id); else selectedLinks.delete(link.id);
      updateSelection();
    });
    selection.append(checkbox);
    const identity = element('td', 'link-identity-cell'); identity.dataset.label = 'Link / destination';
    identity.append(element('div', 'link-name', '/r/' + link.slug));
    const destination = element('a', 'destination', link.destination);
    destination.href = link.destination; destination.target = '_blank'; destination.rel = 'noopener noreferrer'; destination.title = 'Preview destination without counting a click'; identity.append(destination);
    const source = element('td'); source.dataset.label = 'Source';
    const sourceTag = element('span', 'source-tag', link.source || '—');
    sourceTag.title = link.source || 'No source'; source.append(sourceTag);
    const status = element('td'); status.dataset.label = 'Status'; status.append(element('span', 'link-status' + (link.enabled ? '' : ' paused'), link.enabled ? 'Active' : 'Paused'));
    const clicks = element('td', 'number click-value', number.format(link.clicks)); clicks.dataset.label = 'Clicks';
    const time = link.lastClickedAt ? new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(link.lastClickedAt)) : 'No clicks yet';
    const lastClick = element('td', 'last-click', time); lastClick.dataset.label = 'Last counted';
    const actions = element('td', 'link-action-cell');
    const trigger = element('button', 'action-button link-menu-trigger'); trigger.type = 'button'; trigger.append(actionIcon('ellipsis'));
    trigger.setAttribute('aria-label', 'Actions for ' + ('/r/' + link.slug)); trigger.title = 'Link actions'; trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-controls', 'link-action-menu'); trigger.disabled = bulkPending || pendingLinks.has(link.id);
    trigger.addEventListener('click', () => openLinkMenu(link, trigger));
    trigger.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); openLinkMenu(link, trigger); } });
    actions.append(trigger); row.append(selection, identity, source, status, clicks, lastClick, actions); $("link-rows").append(row);
  }
  updateSelection();
}

function renderChart(series,startDay,endDay){renderActivityChart(series,startDay,endDay,{links});}

async function refresh() {
  const version = ++refreshVersion;
  $("activity-chart").setAttribute("aria-busy", "true");
  try {
    const data = await api(`links?range=${encodeURIComponent(activityRange)}`);
    if (version !== refreshVersion) return;
    links = data.links;
    $("total-clicks").textContent = number.format(links.reduce((sum, link) => sum + link.clicks, 0));
    $("month-clicks").textContent = number.format(links.reduce((sum, link) => sum + link.last30Days, 0));
    $("today-clicks").textContent = number.format(links.reduce((sum, link) => sum + link.today, 0));
    $("active-links").textContent = number.format(links.filter(link => link.enabled).length);
    $("links-caption").textContent = `${links.filter(link => !link.enabled).length} paused · ${links.length} total`;
    $("link-count").textContent = number.format(links.length);
    renderChart(data.series, data.chartStartDay, data.chartEndDay);
    renderRows();
    $("activity-range").dataset.loaded = data.range;
    setActivityRange(data.range);
  } finally { if (version === refreshVersion) $("activity-chart").removeAttribute("aria-busy"); }
}

function openEditor(link = null) {
  editing = link;
  $("link-form").reset();
  $("form-error").textContent = "";
  $("dialog-title").textContent = link ? "Edit your link." : "Create a link.";
  $("save-link").textContent = link ? "Save changes ↗︎" : "Create link ↗︎";
  for (const name of ["slug", "destination", "source"]) $(name).value = link?.[name] ?? "";
  $("slug").disabled = Boolean(link);
  $("enabled").checked = link?.enabled ?? true;
  $("slug-note").textContent = link ? "This slug stays fixed so your published links keep working." : "Lowercase letters, numbers, and hyphens. Permanent once created.";
  $("link-dialog").showModal();
}

$("login-form").addEventListener("submit", async event => {
  event.preventDefault();
  $("sign-in").disabled = true;
  $("login-error").textContent = "";
  try {
    const data = await api("login", { method: "POST", body: { password: $("password").value } });
    csrf = data.csrf;
    $("password").value = "";
    await refresh();
    $("login-view").hidden = true;
    $("dashboard").hidden = false;
  } catch (error) { $("login-error").textContent = error.message; }
  finally { $("sign-in").disabled = false; }
});
$("logout").addEventListener("click", async () => {
  try { await api("logout", { method: "POST", body: {} }); showLogin(); }
  catch (error) { toast(error.message); }
});
for (const id of ["new-link", "empty-create"]) $(id).addEventListener("click", () => openEditor());
for (const id of ["close-dialog", "cancel-dialog"]) $(id).addEventListener("click", () => $("link-dialog").close());
for (const id of ["close-delete", "cancel-delete"]) $(id).addEventListener("click", () => {
  if (!deletePending) $("delete-dialog").close();
});
$("delete-dialog").addEventListener("cancel", event => { if (deletePending) event.preventDefault(); });
$("delete-dialog").addEventListener("close", () => { deleting = null; });
$("delete-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!deleting || deletePending) return;
  const targets = deleting;
  const ids = targets.map(link => link.id);
  deletePending = true;
  let removed = false;
  ids.forEach(id => pendingLinks.add(id));
  $("delete-error").textContent = "";
  for (const button of $("delete-form").querySelectorAll("button")) button.disabled = true;
  $("confirm-delete").textContent = "Deleting…";
  try {
    await api('links/bulk', { method: 'POST', body: { ids, action: 'delete' } });
    removed = true;
    ids.forEach(id => { pendingLinks.delete(id); selectedLinks.delete(id); });
    links = links.filter(link => !ids.includes(link.id));
    renderRows();
    $("delete-dialog").close();
    await refresh();
    toast(targets.length === 1 ? 'Link and tracking history permanently deleted.' : targets.length + ' links and their tracking history permanently deleted.');
    $("new-link").focus({ preventScroll: true });
  } catch (error) {
    if (removed) {
      renderRows();
      toast('Links deleted. Refresh to update all statistics.');
    } else if ($("delete-dialog").open) $("delete-error").textContent = error.message;
    else toast(error.message);
  } finally {
    ids.forEach(id => pendingLinks.delete(id));
    deletePending = false;
    for (const button of $("delete-form").querySelectorAll("button")) button.disabled = false;
    $("confirm-delete").textContent = "Delete permanently";
  }
});
$("search").addEventListener("input", renderRows);
$("select-all-links").addEventListener('change', event => {
  const visible = filteredLinks();
  if (event.target.checked && new Set([...selectedLinks, ...visible.map(link => link.id)]).size > 100) {
    updateSelection(); return toast('Select up to 100 links at a time.');
  }
  for (const link of visible) { if (event.target.checked) selectedLinks.add(link.id); else selectedLinks.delete(link.id); }
  updateSelection();
});
$("bulk-pause-links").addEventListener('click', () => setLinksEnabled(links.filter(link => selectedLinks.has(link.id)), false));
$("bulk-activate-links").addEventListener('click', () => setLinksEnabled(links.filter(link => selectedLinks.has(link.id)), true));
$("bulk-delete-links").addEventListener('click', () => openDeleteLinks(links.filter(link => selectedLinks.has(link.id))));
for (const [id, glyph] of [['bulk-pause-links', 'pause'], ['bulk-activate-links', 'play'], ['bulk-delete-links', 'trash']]) $(id).prepend(actionIcon(glyph));
$("link-action-menu").addEventListener('toggle', () => {
  if (!$("link-action-menu").matches(':popover-open')) { menuTrigger?.setAttribute('aria-expanded', 'false'); menuTrigger = null; }
});
$("link-action-menu").addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); return closeLinkMenu(true); }
  if (event.key === 'Tab') return closeLinkMenu();
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const items = [...$("link-action-menu").querySelectorAll('[role=menuitem]')];
  const current = items.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next].focus();
});
window.addEventListener('resize', () => closeLinkMenu());
window.addEventListener('scroll', () => closeLinkMenu(), true);
async function chooseActivityRange(value) {
  closeRangeMenu(true);
  if (value === activityRange) return;
  setActivityRange(value);
  const pending = refresh();
  const version = refreshVersion;
  try {
    await pending;
  } catch (error) {
    if (version === refreshVersion) {
      setActivityRange($("activity-range").dataset.loaded ?? "30d");
      toast(error.message);
    }
  }
}
$("activity-range").addEventListener("click", () => {
  if ($("activity-range-menu").hidden) openRangeMenu(); else closeRangeMenu();
});
$("activity-range").addEventListener("keydown", event => {
  if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); openRangeMenu(); }
  else if (event.key === "Escape") closeRangeMenu();
});
for (const option of rangeOptions) option.addEventListener("click", () => chooseActivityRange(option.dataset.range));
$("activity-range-menu").addEventListener("keydown", event => {
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); return closeRangeMenu(true); }
  if (event.key === "Tab") return closeRangeMenu(true);
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const current = rangeOptions.indexOf(document.activeElement);
  const index = event.key === "Home" ? 0 : event.key === "End" ? rangeOptions.length - 1
    : (current + (event.key === "ArrowDown" ? 1 : -1) + rangeOptions.length) % rangeOptions.length;
  rangeOptions[index].focus();
});
document.addEventListener("pointerdown", event => { if (!event.target.closest(".range-picker")) closeRangeMenu(); });
document.addEventListener("focusin", event => { if (!event.target.closest(".range-picker")) closeRangeMenu(); });
$("refresh").addEventListener("click", async () => {
  $("refresh").disabled = true;
  try { await refresh(); toast("Your counts are up to date."); } catch (error) { toast(error.message); }
  finally { $("refresh").disabled = false; }
});
$("slug").addEventListener("input", () => { $("slug").dataset.edited = "true"; });
$("link-dialog").addEventListener("close", () => { delete $("slug").dataset.edited; });
$("link-form").addEventListener("submit", async event => {
  event.preventDefault();
  $("save-link").disabled = true;
  $("form-error").textContent = "";
  const body = Object.fromEntries(["slug", "destination", "source"].map(name => [name, $(name).value]));
  body.label = '/r/' + body.slug;
  body.enabled = $("enabled").checked;
  try {
    await api(editing ? `links/${editing.id}` : "links", { method: editing ? "PUT" : "POST", body });
    $("link-dialog").close();
    await refresh();
    toast(editing ? 'Link updated.' : 'Link created.');
  } catch (error) { $("form-error").textContent = error.message; }
  finally { $("save-link").disabled = false; }
});

initFilterPicker(document.getElementById('blog-status'));
initFilterPicker(document.getElementById('project-filter'));
const resumeWorkspace = initResumes({ api, toast, refreshLinks: refresh });
const bookWorkspace = initBooks({ api, toast });
const blogWorkspace = initBlogs({ api, toast });
const projectWorkspace = initProjects({ api, toast });
async function selectSection(section) {
  if (!$('blogs-view').hidden && section !== 'blogs' && !(await blogWorkspace.leave())) return;
  closeLinkMenu();
  for (const name of ['links', 'resumes', 'books', 'blogs', 'projects']) {
    $(`${name}-view`).hidden = name !== section;
    if (name === section) $(`nav-${name}`).setAttribute('aria-current', 'page');
    else $(`nav-${name}`).removeAttribute('aria-current');
  }
  if (section === 'resumes') {
    try { await resumeWorkspace.refresh(); } catch (error) { $('resume-error').textContent = error.message; }
  }
  if (section === 'books') {
    try { await bookWorkspace.refresh(); } catch (error) { $('book-error').textContent = error.message; }
  }
  if (section === 'projects') {
    try { await projectWorkspace.refresh(); } catch (error) { $('project-library-error').textContent = error.message; }
  }
  if (section === 'blogs') {
    try { await blogWorkspace.refresh(); } catch (error) { $('blog-library-error').textContent = error.message; }
  }
}
$('nav-links').addEventListener('click', () => selectSection('links'));
$('nav-resumes').addEventListener('click', () => selectSection('resumes'));
$('nav-books').addEventListener('click', () => selectSection('books'));
$('nav-projects').addEventListener('click', () => selectSection('projects'));
$('nav-blogs').addEventListener('click', () => selectSection('blogs'));

(async () => {
  try {
    const session = await api("session");
    csrf = session.csrf;
    $("logout").hidden = session.localDevelopment === true;
    await refresh();
    $("loading").hidden = true;
    $("dashboard").hidden = false;
    const requestedSection = new URLSearchParams(location.search).get('section');
    if (['blogs','projects'].includes(requestedSection)) await selectSection(requestedSection);
  } catch (error) {
    showLogin();
    if (error.message !== "Sign in to continue.") $("login-error").textContent = "Cannot reach the admin service. Refresh to try again.";
  }
})();
