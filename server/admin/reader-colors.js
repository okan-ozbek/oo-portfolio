import { OPS } from 'pdfjs-dist/build/pdf.mjs';
import { colorMaskTable, luminance, readingPresets, rgb, suggestedTextColor, textPalette, validColor } from './reader-palette.js';

const $ = id => document.getElementById(id);
const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep adjustments in memory if storage is unavailable. */ } };
const svgNode = (tag, attrs = {}) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};

export function initReadingColors({ bookId, getDocument, getPageNumber, isDark, onTheme, onOpen }) {
  const saved = read('pixelware-pdf-reading-colors');
  let preset = readingPresets.find(item => item.id === saved?.preset) ?? readingPresets[isDark() ? 0 : 2];
  let enabled = saved?.enabled === true;
  let pageColor = validColor(saved?.page) ? saved.page : preset.page;
  let textColor = validColor(saved?.text) ? saved.text : preset.text;
  const overridesKey = `pixelware-pdf-text-colors:${bookId}`;
  const stored = read(overridesKey);
  let overrides = stored && typeof stored === 'object' && !Array.isArray(stored)
    ? Object.fromEntries(Object.entries(stored).filter(([source, target]) => validColor(source) && validColor(target))) : {};
  const paletteKey = `pixelware-pdf-palette:${bookId}`, remembered = read(paletteKey);
  let colors = Array.isArray(remembered) ? remembered.filter(validColor).slice(0, 12) : [];
  let scanSequence = 0, scanTimer, renderedPage = 0, filterKey, adjustmentFrame;
  const cache = new Map();
  const svg = svgNode('svg', { width: '0', height: '0', 'aria-hidden': 'true', class: 'reader-color-defs' });
  const defs = svgNode('defs');
  const filter = svgNode('filter', { id: 'reader-color-filter', x: '0', y: '0', width: '1', height: '1', 'color-interpolation-filters': 'sRGB' });
  defs.append(filter); svg.append(defs); document.body.append(svg);

  function persist() {
    write('pixelware-pdf-reading-colors', { enabled, preset: preset.id, page: pageColor, text: textColor });
    write(overridesKey, overrides);
  }
  const targetFor = source => overrides[source] ?? (source === colors[0] ? textColor : suggestedTextColor(source, { ...preset, text: textColor }));
  function apply() {
    document.documentElement.dataset.readingColors = enabled ? 'on' : 'off';
    document.documentElement.style.setProperty('--reader-page-color', pageColor);
    $('colors-enabled').checked = enabled;
    $('colors-toggle').classList.toggle('has-reading-colors', enabled);
    if (!enabled) return;
    const dark = luminance(pageColor) < 0.5;
    if (dark !== isDark()) onTheme(dark);
    const mappings = colors.slice(0, 12).map(source => [source, targetFor(source)]).filter(([source, target]) => source !== '#000000' || target !== textColor);
    const key = JSON.stringify([pageColor, textColor, mappings]);
    // Replacing a shared SVG filter repaints every canvas using it. Most pages
    // have the same palette, so keep the existing filter nodes in that case.
    if (key === filterKey) return;
    filterKey = key;
    const foreground = rgb(textColor), background = rgb(pageColor);
    const hue = svgNode('feColorMatrix', { in: 'SourceGraphic', type: 'hueRotate', values: luminance(pageColor) < luminance(textColor) ? '180' : '0', result: 'hue' });
    const transfer = svgNode('feComponentTransfer', { in: 'hue', result: 'base' });
    for (let i = 0; i < 3; i++) transfer.append(svgNode(`feFunc${'RGB'[i]}`, { type: 'linear', slope: background[i] - foreground[i], intercept: foreground[i] }));
    const nodes = [hue, transfer];
    let previous = 'base';
    for (const [index, [source, target]] of mappings.entries()) {
      const mask = svgNode('feComponentTransfer', { in: 'SourceGraphic', result: `channels-${index}` });
      rgb(source).forEach((channel, i) => mask.append(svgNode(`feFunc${'RGB'[i]}`, { type: 'table', tableValues: colorMaskTable(channel) })));
      const alpha = svgNode('feColorMatrix', { in: `channels-${index}`, type: 'matrix', values: '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 1 1 0 -2', result: `mask-${index}` });
      const flood = svgNode('feFlood', { 'flood-color': target, result: `color-${index}` });
      const paint = svgNode('feComposite', { in: `color-${index}`, in2: `mask-${index}`, operator: 'in', result: `paint-${index}` });
      const merge = svgNode('feComposite', { in: `paint-${index}`, in2: previous, operator: 'over', result: `result-${index}` });
      nodes.push(mask, alpha, flood, paint, merge); previous = `result-${index}`;
    }
    filter.replaceChildren(...nodes);
  }
  function adjust() {
    enabled = true; syncPresets();
    if (adjustmentFrame) return;
    adjustmentFrame = requestAnimationFrame(() => { adjustmentFrame = null; apply(); persist(); });
  }
  function renderInputs() {
    const root = $('text-color-controls'); root.replaceChildren();
    const palette = colors.length ? colors.slice(0, 12) : ['#000000'];
    palette.forEach((source, index) => {
      const label = document.createElement('label'); label.className = 'reader-color-control';
      const text = document.createElement('span'); text.textContent = index === 0 ? 'Main text' : `Text color ${index + 1}`;
      const swatch = document.createElement('span'); swatch.className = 'reader-source-swatch'; swatch.style.backgroundColor = source; swatch.title = `Original: ${source}`; swatch.setAttribute('aria-hidden', 'true');
      const input = document.createElement('input'); input.type = 'color'; input.value = colors.length ? targetFor(source) : textColor;
      input.dataset.sourceColor = source; input.setAttribute('aria-label', index === 0 ? 'Main text color' : `Text color ${index + 1}, originally ${source}`);
      input.addEventListener('input', () => {
        if (index === 0) textColor = input.value;
        overrides[source] = input.value; adjust();
      });
      label.append(swatch, text, input); root.append(label);
    });
    $('page-color').value = pageColor;
    $('colors-page-info').textContent = colors.length
      ? `${colors.length} text color${colors.length === 1 ? '' : 's'} detected on page ${getPageNumber()}.${colors.length > 12 ? ' Showing the 12 most-used colors.' : ''}`
      : 'No text colors detected here. The main text tone still adjusts scanned pages.';
  }
  function syncPresets() {
    const custom = pageColor !== preset.page || textColor !== preset.text || Object.keys(overrides).length > 0;
    for (const button of $('color-presets').querySelectorAll('button')) button.setAttribute('aria-pressed', String(!custom && button.dataset.preset === preset.id));
  }
  for (const item of readingPresets) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'reader-color-preset'; button.dataset.preset = item.id;
    const preview = document.createElement('span'); preview.className = 'reader-preset-preview'; preview.style.backgroundColor = item.page; preview.style.color = item.text; preview.textContent = 'Aa'; preview.setAttribute('aria-hidden', 'true');
    const accent = document.createElement('span'); accent.style.color = suggestedTextColor('#00558b', item); accent.textContent = ' Aa'; preview.append(accent);
    const name = document.createElement('span'); name.textContent = item.name; button.append(preview, name);
    button.addEventListener('click', () => {
      preset = item; pageColor = item.page; textColor = item.text; overrides = {}; enabled = true;
      syncPresets(); renderInputs(); apply(); persist();
    });
    $('color-presets').append(button);
  }
  async function scan() {
    const doc = getDocument();
    if (!doc || (!enabled && $('colors-panel').hidden)) return;
    // Let PDF.js draw first. Reusing its completed operator list avoids a second
    // competing render request while the first readable page is loading.
    if (renderedPage !== getPageNumber()) return;
    const page = getPageNumber(), sequence = ++scanSequence;
    $('colors-page-info').textContent = `Checking text colors on page ${page}…`;
    try {
      if (!cache.has(page)) cache.set(page, doc.getPage(page).then(value => value.getOperatorList()).then(list => textPalette(list, OPS)));
      const palette = await cache.get(page);
      if (sequence !== scanSequence || page !== getPageNumber()) return;
      if (colors.join(',') !== palette.join(',')) { colors = palette; write(paletteKey, colors.slice(0, 12)); }
      if (!$('colors-panel').hidden) renderInputs();
      apply();
    } catch {
      cache.delete(page);
      if (sequence === scanSequence) $('colors-page-info').textContent = 'Could not inspect this page. Presets and the main text tone are still available.';
    }
  }
  const close = (focus = false) => {
    $('colors-panel').hidden = true; $('colors-toggle').setAttribute('aria-expanded', 'false');
    if (focus) $('colors-toggle').focus({ preventScroll: true });
  };
  $('colors-toggle').addEventListener('click', () => {
    if (!$('colors-panel').hidden) { close(); return; }
    onOpen(); $('colors-panel').hidden = false; $('colors-toggle').setAttribute('aria-expanded', 'true');
    renderInputs(); void scan(); $('colors-enabled').focus({ preventScroll: true });
  });
  $('colors-close').addEventListener('click', () => close(true));
  $('colors-panel').addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } });
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#colors-panel,#colors-toggle')) close(); });
  $('colors-enabled').addEventListener('change', () => { enabled = $('colors-enabled').checked; apply(); persist(); });
  $('page-color').addEventListener('input', () => { pageColor = $('page-color').value; adjust(); });
  syncPresets(); renderInputs(); apply();
  return {
    get isOpen() { return !$('colors-panel').hidden; },
    close,
    disable() { enabled = false; apply(); persist(); },
    pageChanged() {
      clearTimeout(scanTimer); scanSequence++; renderedPage = 0;
    },
    pageRendered(page) {
      if (page !== getPageNumber()) return;
      renderedPage = page; clearTimeout(scanTimer);
      scanTimer = setTimeout(() => void scan(), 150);
    },
  };
}
