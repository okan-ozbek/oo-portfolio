/* The dashboard receives no password hash or secret configuration. */
import { initResumes } from './resumes.js';
const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat();
let csrf = "";
let links = [];
let editing = null;
let deleting = null;
let deletePending = false;
const pendingLinks = new Set();
let toastAnimation;
let refreshVersion = 0;
let activityRange = "30d";
const rangeLabels = { "7d": "Last 7 days", "30d": "Last 30 days", quarter: "Last quarter", year: "Last year" };
const rangeOptions = [...$("activity-range-menu").querySelectorAll("[role=option]")];

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
  selectSection('links');
  closeRangeMenu();
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

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(`/api/admin/${path}`, {
    method, credentials: "same-origin", cache: "no-store",
    headers: { ...(method !== "GET" ? { "Content-Type": "application/json", "X-CSRF-Token": csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "login") showLogin();
    throw new Error(data.error ?? "Request failed. Please try again.");
  }
  return data;
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function actionIcon(name) {
  const paths = {
    trash: ["M3 6h14", "M8 3h4l1 3H7l1-3Z", "M5 6l1 11h8l1-11", "M8 9v5", "M12 9v5"],
    pause: ["M6 4v12", "M14 4v12"],
    play: ["m6 3 10 7-10 7V3Z"],
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("action-icon");
  for (const d of paths[name]) {
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

function renderRows() {
  const query = $("search").value.toLowerCase();
  const filtered = links.filter(link => [link.label, link.slug, link.destination, link.source].join(" ").toLowerCase().includes(query));
  $("link-rows").replaceChildren();
  $("empty-state").hidden = links.length > 0;
  $("table-wrap").hidden = filtered.length === 0;
  $("no-results").hidden = links.length === 0 || filtered.length > 0;
  for (const link of filtered) {
    const row = element("tr");
    const identity = element("td");
    identity.dataset.label = "Link / destination";
    identity.append(element("div", "link-name", link.label), element("span", "short-url", `/r/${link.slug}`));
    const destination = element("a", "destination", link.destination);
    destination.href = link.destination;
    destination.target = "_blank";
    destination.rel = "noopener noreferrer";
    destination.title = "Preview destination without counting a click";
    identity.append(destination);
    const source = element("td");
    source.dataset.label = "Source";
    source.append(element("span", "source-tag", link.source || "—"));
    const status = element("td");
    status.dataset.label = "Status";
    status.append(element("span", `link-status${link.enabled ? "" : " paused"}`, link.enabled ? "Active" : "Paused"));
    const clicks = element("td", "number click-value", number.format(link.clicks));
    clicks.dataset.label = "Clicks";
    const time = link.lastClickedAt ? new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(link.lastClickedAt)) : "No clicks yet";
    const lastClick = element("td", "last-click", time);
    lastClick.dataset.label = "Last counted";
    const actions = element("td");
    const actionWrap = element("div", "row-actions");
    const copy = element("button", "secondary", "Copy ↗");
    copy.setAttribute("aria-label", `Copy link for ${link.label}`);
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(link.url); toast("Link copied. Ready for your resume."); }
      catch { toast(`Copy this link: ${link.url}`); }
    });
    const edit = element("button", "secondary", "Edit");
    edit.setAttribute("aria-label", `Edit ${link.label}`);
    edit.addEventListener("click", () => openEditor(link));
    const toggle = element("button", "secondary toggle-link");
    toggle.append(actionIcon(link.enabled ? "pause" : "play"), document.createTextNode(link.enabled ? "Pause" : "Activate"));
    toggle.setAttribute("aria-label", `${link.enabled ? "Deactivate" : "Activate"} ${link.label}`);
    toggle.title = link.enabled ? "Deactivate link" : "Activate link";
    toggle.dataset.toggleLink = link.id;
    toggle.addEventListener("click", async () => {
      pendingLinks.add(link.id);
      for (const button of actionWrap.children) button.disabled = true;
      try {
        await api(`links/${link.id}`, { method: "PATCH", body: { enabled: !link.enabled } });
        pendingLinks.delete(link.id);
        await refresh();
        toast(link.enabled ? "Link paused. Its history is preserved." : "Link activated.");
      } catch (error) { toast(error.message); }
      finally {
        pendingLinks.delete(link.id);
        renderRows();
        if (document.activeElement === document.body) $("link-rows").querySelector(`[data-toggle-link="${link.id}"]`)?.focus({ preventScroll: true });
      }
    });
    const remove = element("button", "secondary delete-link");
    remove.append(actionIcon("trash"));
    remove.setAttribute("aria-label", `Delete ${link.label}`);
    remove.title = "Permanently delete link and tracking history";
    remove.addEventListener("click", () => {
      deleting = link;
      $("delete-link-name").textContent = link.label;
      $("delete-link-url").textContent = `/r/${link.slug}`;
      $("delete-error").textContent = "";
      $("delete-dialog").showModal();
      $("cancel-delete").focus();
    });
    actionWrap.append(copy, toggle, edit, remove);
    for (const button of actionWrap.children) button.disabled = pendingLinks.has(link.id);
    actions.append(actionWrap);
    row.append(identity, source, status, clicks, lastClick, actions);
    $("link-rows").append(row);
  }
}

function renderChart(series, startDay, endDay) {
  const svg = $("activity-chart");
  svg.replaceChildren();
  const tooltip = $("chart-tooltip");
  tooltip.hidden = true;
  svg.onpointermove = svg.onpointerdown = svg.onpointerleave = svg.onfocus = svg.onblur = svg.onkeydown = null;
  $("chart-legend").replaceChildren();
  $("chart-scale").replaceChildren();
  const ns = "http://www.w3.org/2000/svg";
  function shape(tag, attributes) {
    const node = document.createElementNS(ns, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    svg.append(node);
    return node;
  }
  const palette = ["#ff646b", "#68c9ef", "#b59aff", "#b8dc74", "#ffca70", "#ed8dce", "#7ed8c5", "#fa9c78"];
  const colors = new Map([...links].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map((link, index) => [link.id, palette[index] ?? `hsl(${(index * 137.508 % 360).toFixed(3)} 78% 70%)`]));
  let peak = 0;
  let total = 0;
  for (const link of series) for (const day of link.daily) { peak = Math.max(peak, day.clicks); total += day.clicks; }
  const step = Math.max(1, Math.ceil(peak / 4));
  const max = step * 4;
  for (let index = 0; index <= 4; index++) {
    const y = 12 + index * 44;
    shape("line", { x1: 8, x2: 892, y1: y, y2: y, class: "chart-grid" });
    $("chart-scale").append(element("span", "", number.format(max - step * index)));
  }
  const end = Date.parse(`${endDay}T00:00:00Z`);
  const start = Date.parse(`${startDay}T00:00:00Z`);
  const dayCount = Math.round((end - start) / 86400000) + 1;
  const lastIndex = dayCount - 1;
  const xStep = 884 / lastIndex;
  const days = Array.from({ length: dayCount }, (_, index) => new Date(start + index * 86400000).toISOString().slice(0, 10));
  const plotted = [];
  $("chart-start").textContent = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", ...(new Date(start).getUTCFullYear() !== new Date(end).getUTCFullYear() ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(start));
  for (const link of series) {
    const color = colors.get(link.id);
    const legend = element("li", "legend-item");
    const swatch = document.createElementNS(ns, "svg");
    swatch.setAttribute("viewBox", "0 0 18 10");
    swatch.setAttribute("aria-hidden", "true");
    const sample = document.createElementNS(ns, "line");
    for (const [name, value] of Object.entries({ x1: 1, x2: 17, y1: 5, y2: 5, stroke: color, "stroke-width": 3, "stroke-linecap": "round" })) sample.setAttribute(name, value);
    swatch.append(sample);
    legend.append(swatch, element("span", "", link.label));
    $("chart-legend").append(legend);
    const counts = new Map(link.daily.map(day => [day.day, day.clicks]));
    const points = days.map((day, index) => ({ day, value: counts.get(day) ?? 0, x: 8 + index * xStep, y: 188 - (counts.get(day) ?? 0) / max * 176 }));
    const line = shape("path", { d: points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "), stroke: color, class: "chart-line", "vector-effect": "non-scaling-stroke" });
    plotted.push({ link, color, points, line });
    for (const point of points.filter(point => point.value > 0)) {
      shape("ellipse", { cx: point.x, cy: point.y, rx: 3, ry: 3, fill: color, class: "chart-point" });
    }
  }
  const clickLabel = `${number.format(total)} ${total === 1 ? "click" : "clicks"}`;
  svg.setAttribute("aria-label", `Daily clicks for ${series.length} active links from ${startDay} to ${endDay}. ${clickLabel} total.`);
  $("chart-message").textContent = !series.length ? "Create or activate a link to see its activity." : total ? `${clickLabel} across active links` : "No clicks yet. Active links start at zero.";
  if (!plotted.length) return;

  const guide = shape("line", { x1: 8, x2: 8, y1: 12, y2: 188, class: "chart-guide", visibility: "hidden" });
  const highlights = [];
  let keyboardIndex = lastIndex;
  let visibleKey = "";
  function hideTooltip() {
    visibleKey = "";
    tooltip.hidden = true;
    guide.setAttribute("visibility", "hidden");
    for (const marker of highlights.splice(0)) marker.remove();
    for (const item of plotted) item.line.classList.remove("is-highlighted", "is-muted");
  }
  function showTooltip(items, index) {
    const key = `${index}:${svg.clientWidth}:${svg.clientHeight}:${items.map(item => item.link.id).join(",")}`;
    if (!tooltip.hidden && key === visibleKey) return;
    hideTooltip();
    visibleKey = key;
    keyboardIndex = index;
    const point = items[0].points[index];
    $("chart-tooltip-date").textContent = `${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${point.day}T00:00:00Z`))} · UTC`;
    $("chart-tooltip-links").replaceChildren();
    for (const item of items) {
      const sample = item.points[index];
      const row = element("div", "chart-tooltip-row");
      const swatch = document.createElementNS(ns, "svg");
      swatch.setAttribute("viewBox", "0 0 10 10");
      swatch.setAttribute("aria-hidden", "true");
      const dot = document.createElementNS(ns, "circle");
      for (const [name, value] of Object.entries({ cx: 5, cy: 5, r: 4, fill: item.color })) dot.setAttribute(name, value);
      swatch.append(dot);
      const identity = element("div", "chart-tooltip-identity");
      identity.append(element("strong", "", item.link.label), element("span", "", `/r/${item.link.slug}`));
      row.append(swatch, identity, element("span", "chart-tooltip-count", `${number.format(sample.value)} ${sample.value === 1 ? "click" : "clicks"}`));
      $("chart-tooltip-links").append(row);
      highlights.push(shape("ellipse", { cx: sample.x, cy: sample.y, rx: 5, ry: 5, fill: item.color, class: "chart-hover-point" }));
    }
    for (const item of plotted) item.line.classList.add(items.includes(item) ? "is-highlighted" : "is-muted");
    guide.setAttribute("x1", point.x);
    guide.setAttribute("x2", point.x);
    guide.setAttribute("visibility", "visible");
    tooltip.hidden = false;
    const plot = svg.getBoundingClientRect();
    const wrap = svg.parentElement.getBoundingClientRect();
    const x = plot.left - wrap.left + point.x / 900 * plot.width;
    const y = plot.top - wrap.top + point.y / 200 * plot.height;
    // CSSOM properties keep positioning compatible with the admin's strict CSP.
    tooltip.style.left = `${Math.max(12, Math.min(wrap.width - tooltip.offsetWidth - 12, x + 16))}px`;
    const above = y - tooltip.offsetHeight - 16;
    tooltip.style.top = `${Math.max(0, Math.min(wrap.height - tooltip.offsetHeight, above >= 0 ? above : y + 16))}px`;
  }
  svg.onpointermove = svg.onpointerdown = event => {
    const rect = svg.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const scaleX = rect.width / 900;
    const scaleY = rect.height / 200;
    const distances = plotted.map(item => {
      let distance = Infinity;
      for (let index = 0; index < item.points.length - 1; index++) {
        const a = item.points[index];
        const b = item.points[index + 1];
        const ax = a.x * scaleX;
        const ay = a.y * scaleY;
        const dx = (b.x - a.x) * scaleX;
        const dy = (b.y - a.y) * scaleY;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
        distance = Math.min(distance, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
      }
      return { item, distance };
    });
    const closest = Math.min(...distances.map(result => result.distance));
    if (closest > (event.pointerType === "touch" ? 24 : 12)) return hideTooltip();
    const index = Math.max(0, Math.min(lastIndex, Math.round((x / scaleX - 8) / xStep)));
    // Overlapping lines share one tooltip so zero-count links remain inspectable.
    showTooltip(distances.filter(result => result.distance <= closest + 0.5).map(result => result.item), index);
  };
  svg.onpointerleave = svg.onblur = hideTooltip;
  svg.onfocus = () => { if (tooltip.hidden) showTooltip(plotted, keyboardIndex); };
  svg.onkeydown = event => {
    if (event.key === "Escape") { event.preventDefault(); return hideTooltip(); }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === "Home" ? 0 : event.key === "End" ? lastIndex : Math.max(0, Math.min(lastIndex, keyboardIndex + (event.key === "ArrowLeft" ? -1 : 1)));
    showTooltip(plotted, index);
  };
}

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
  $("save-link").textContent = link ? "Save changes ↗" : "Create link ↗";
  for (const name of ["label", "slug", "destination", "source"]) $(name).value = link?.[name] ?? "";
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
  const link = deleting;
  deletePending = true;
  let removed = false;
  pendingLinks.add(link.id);
  $("delete-error").textContent = "";
  for (const button of $("delete-form").querySelectorAll("button")) button.disabled = true;
  $("confirm-delete").textContent = "Deleting…";
  try {
    await api(`links/${link.id}`, { method: "DELETE", body: {} });
    removed = true;
    pendingLinks.delete(link.id);
    $("delete-dialog").close();
    await refresh();
    toast("Link and tracking history permanently deleted.");
    $("new-link").focus({ preventScroll: true });
  } catch (error) {
    if (removed) {
      links = links.filter(item => item.id !== link.id);
      renderRows();
      toast("Link deleted. Refresh to update all statistics.");
    } else if ($("delete-dialog").open) $("delete-error").textContent = error.message;
    else toast(error.message);
  } finally {
    pendingLinks.delete(link.id);
    deletePending = false;
    for (const button of $("delete-form").querySelectorAll("button")) button.disabled = false;
    $("confirm-delete").textContent = "Delete permanently";
  }
});
$("search").addEventListener("input", renderRows);
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
$("label").addEventListener("input", () => {
  if (!editing && !$("slug").dataset.edited) $("slug").value = $("label").value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80).replace(/-$/, "");
});
$("slug").addEventListener("input", () => { $("slug").dataset.edited = "true"; });
$("link-dialog").addEventListener("close", () => { delete $("slug").dataset.edited; });
$("link-form").addEventListener("submit", async event => {
  event.preventDefault();
  $("save-link").disabled = true;
  $("form-error").textContent = "";
  const body = Object.fromEntries(["label", "slug", "destination", "source"].map(name => [name, $(name).value]));
  body.enabled = $("enabled").checked;
  try {
    await api(editing ? `links/${editing.id}` : "links", { method: editing ? "PUT" : "POST", body });
    $("link-dialog").close();
    await refresh();
    toast(editing ? "Link updated." : "Link created. Copy it and put it to work.");
  } catch (error) { $("form-error").textContent = error.message; }
  finally { $("save-link").disabled = false; }
});

const resumeWorkspace = initResumes({ api, toast, refreshLinks: refresh });
async function selectSection(section) {
  const resumes = section === 'resumes';
  $('links-view').hidden = resumes;
  $('resumes-view').hidden = !resumes;
  for (const name of ['links', 'resumes']) {
    if (name === section) $(`nav-${name}`).setAttribute('aria-current', 'page');
    else $(`nav-${name}`).removeAttribute('aria-current');
  }
  if (resumes) {
    try { await resumeWorkspace.refresh(); } catch (error) { $('resume-error').textContent = error.message; }
  }
}
$('nav-links').addEventListener('click', () => selectSection('links'));
$('nav-resumes').addEventListener('click', () => selectSection('resumes'));

(async () => {
  try {
    csrf = (await api("session")).csrf;
    await refresh();
    $("loading").hidden = true;
    $("dashboard").hidden = false;
  } catch (error) {
    showLogin();
    if (error.message !== "Sign in to continue.") $("login-error").textContent = "Cannot reach the admin service. Refresh to try again.";
  }
})();
