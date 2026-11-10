// Reuse completed PDF.js canvases; ambient mode never fetches or renders a PDF.
export function initReaderAmbient({ container, viewerElement, getPageCanvas, toggle, settings, onOpen }) {
  const storageKey = 'pixelware-pdf-ambient';
  const settingsKey = 'pixelware-pdf-ambient-settings';
  const bounded = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(0, Math.min(100, value))) : fallback;
  let saved;
  try { saved = JSON.parse(localStorage.getItem(settingsKey)); } catch { /* Use defaults when storage is unavailable or invalid. */ }
  let intensity = bounded(saved?.intensity, 72), spread = bounded(saved?.spread, 60);
  let enabled = true, frame = 0;
  try { enabled = localStorage.getItem(storageKey) !== 'off'; } catch { /* Keep the preference in memory. */ }
  const layer = document.createElement('div');
  layer.className = 'reader-ambient-layer';
  layer.setAttribute('aria-hidden', 'true');
  const surface = document.createElement('div'); surface.className = 'reader-ambient-surface';
  layer.append(surface);
  container.parentElement.prepend(layer);
  const visible = new Set(), glows = new Map();

  function applyAppearance() {
    layer.style.setProperty('--reader-ambient-opacity', String(intensity / 100));
    layer.style.setProperty('--reader-ambient-blur', `${40 + spread * 1.2}px`);
    layer.style.setProperty('--reader-ambient-extension', `${spread * .6}px`);
    settings.intensityInput.value = String(intensity); settings.intensityOutput.textContent = `${intensity}%`;
    settings.spreadInput.value = String(spread); settings.spreadOutput.textContent = `${spread}%`;
    settings.intensityInput.setAttribute('aria-valuetext', `${intensity} percent`);
    settings.spreadInput.setAttribute('aria-valuetext', `${spread} percent`);
  }
  function persist() {
    try {
      localStorage.setItem(storageKey, enabled ? 'on' : 'off');
      localStorage.setItem(settingsKey, JSON.stringify({ intensity, spread }));
    } catch { /* Keep the preference in memory. */ }
  }

  function paint() {
    frame = 0;
    if (!enabled || document.hidden) return;
    const bounds = layer.getBoundingClientRect();
    for (const page of visible) {
      const source = getPageCanvas(Number(page.dataset.pageNumber));
      let glow = glows.get(page);
      const ready = source?.width && source.height;
      if (!ready && !glow) continue;
      if (!glow) {
        const element = document.createElement('div'); element.className = 'reader-ambient-page';
        const canvas = document.createElement('canvas'); element.append(canvas);
        glow = { element, canvas, source: null }; glows.set(page, glow); surface.append(element);
      }
      // Only retain a tiny sample for pages near the viewport, never full-size copies.
      if (ready && (glow.source !== source || glow.width !== source.width || glow.height !== source.height)) {
        glow.canvas.width = 48;
        glow.canvas.height = Math.max(1, Math.min(96, Math.round(48 * source.height / source.width)));
        const context = glow.canvas.getContext('2d', { alpha: false });
        if (!context) { glow.element.remove(); glows.delete(page); continue; }
        context.fillStyle = '#fff'; context.fillRect(0, 0, glow.canvas.width, glow.canvas.height);
        try { context.drawImage(source, 0, 0, glow.canvas.width, glow.canvas.height); }
        catch { glow.element.remove(); glows.delete(page); continue; }
        glow.source = source; glow.width = source.width; glow.height = source.height;
      }
      const rect = page.getBoundingClientRect();
      Object.assign(glow.element.style, {
        left: `${rect.left - bounds.left}px`, top: `${rect.top - bounds.top}px`,
        width: `${rect.width}px`, height: `${rect.height}px`,
      });
    }
  }
  function schedule() {
    if (enabled && !document.hidden && !frame) frame = requestAnimationFrame(paint);
  }
  const observer = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (isIntersecting) visible.add(target);
      else { visible.delete(target); glows.get(target)?.element.remove(); glows.delete(target); }
    }
    schedule();
  }, { root: container, rootMargin: '640px' });
  function observePages() {
    if (enabled) for (const page of viewerElement.querySelectorAll('.page[data-page-number]')) observer.observe(page);
  }
  function apply() {
    layer.hidden = !enabled || document.hidden;
    toggle.classList.toggle('has-ambient', enabled);
    settings.enabledInput.checked = enabled;
    settings.intensityInput.disabled = settings.spreadInput.disabled = !enabled;
    if (enabled) observePages();
    else {
      observer.disconnect(); visible.clear(); glows.clear(); surface.replaceChildren();
      cancelAnimationFrame(frame); frame = 0;
    }
  }
  function close(focus = false) {
    settings.panel.hidden = true; toggle.setAttribute('aria-expanded', 'false');
    if (focus) toggle.focus({ preventScroll: true });
  }
  toggle.addEventListener('click', () => {
    if (!settings.panel.hidden) { close(); return; }
    onOpen(); settings.panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
    settings.enabledInput.focus({ preventScroll: true });
  });
  settings.closeButton.addEventListener('click', () => close(true));
  settings.panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
  });
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#ambient-panel,#ambient-toggle')) close(); });
  settings.enabledInput.addEventListener('change', () => { enabled = settings.enabledInput.checked; apply(); persist(); });
  settings.intensityInput.addEventListener('input', () => { intensity = bounded(Number(settings.intensityInput.value), 72); applyAppearance(); persist(); });
  settings.spreadInput.addEventListener('input', () => { spread = bounded(Number(settings.spreadInput.value), 60); applyAppearance(); persist(); });
  settings.resetButton.addEventListener('click', () => {
    intensity = 72; spread = 60; enabled = true; applyAppearance(); apply(); persist();
  });
  container.addEventListener('scroll', schedule, { passive: true });
  const resize = new ResizeObserver(schedule); resize.observe(container); resize.observe(viewerElement);
  document.addEventListener('visibilitychange', () => { layer.hidden = !enabled || document.hidden; schedule(); });
  window.addEventListener('pagehide', event => {
    cancelAnimationFrame(frame); frame = 0;
    if (!event.persisted) { observer.disconnect(); resize.disconnect(); }
  });
  window.addEventListener('pageshow', schedule);
  applyAppearance(); apply();
  return {
    pagesInitialized: observePages,
    layoutChanged: schedule,
    pageRendered(pageNumber) {
      for (const [page, glow] of glows) if (Number(page.dataset.pageNumber) === pageNumber) glow.source = null;
      schedule();
    },
  };
}
