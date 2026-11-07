const key = 'pixelware-pdf-note-appearance';
const defaults = { color: '#f4dfa0', fontSize: 13 };
let initialized = false;
export function noteAppearance(value) {
  return { color: /^#[a-f0-9]{6}$/i.test(value?.color ?? '') ? value.color : defaults.color,
    fontSize: Number.isFinite(value?.fontSize) ? Math.max(10, Math.min(24, value.fontSize)) : defaults.fontSize };
}
export function initNoteAppearance() {
  if (initialized) return;
  initialized = true;
  let preference = defaults;
  const read = () => { try { return noteAppearance(JSON.parse(localStorage.getItem(key))); } catch { return defaults; } };
  function apply(value, persist = false) {
    preference = noteAppearance(value);
    const rgb = preference.color.slice(1).match(/../g).map(part => parseInt(part, 16) / 255);
    const light = rgb.reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0) > .55;
    const style = document.documentElement.style;
    for (const [name, value] of Object.entries({ background: preference.color, text: light ? '#342c1d' : '#f5f2e7',
      muted: light ? '#6f6041' : '#c9c3b4', keyword: light ? '#8a2769' : '#f2a7d7', string: light ? '#22643c' : '#b2dea9',
      number: light ? '#8a4c0e' : '#efd29b', function: light ? '#145b8b' : '#9cd0f2' })) style.setProperty(`--pdf-note-${name}`, value);
    style.setProperty('--pdf-note-font-size', `${preference.fontSize}px`);
    const color = document.getElementById('note-theme-color'), font = document.getElementById('note-font-size');
    if (color) color.value = preference.color;
    if (font) font.value = preference.fontSize;
    for (const button of document.querySelectorAll('[data-note-color]')) button.setAttribute('aria-pressed', String(button.dataset.noteColor === preference.color));
    if (persist) { try { localStorage.setItem(key, JSON.stringify(preference)); } catch { /* Keep the current appearance in memory. */ } }
    document.dispatchEvent(new Event('noteappearancechange'));
  }
  apply(read());
  document.getElementById('note-theme-color')?.addEventListener('input', event => apply({ ...preference, color: event.target.value }, true));
  document.getElementById('note-font-size')?.addEventListener('input', event => { if (event.target.validity.valid && event.target.value !== '') apply({ ...preference, fontSize: Number(event.target.value) }, true); });
  for (const button of document.querySelectorAll('[data-note-color]')) button.addEventListener('click', () => apply({ ...preference, color: button.dataset.noteColor }, true));
  document.getElementById('note-appearance-reset')?.addEventListener('click', () => apply(defaults, true));
  window.addEventListener('storage', event => { if (event.key === key) apply(read()); });
  const toggle = document.getElementById('notes-settings-toggle'), panel = document.getElementById('notes-settings-panel');
  if (!toggle || !panel) return;
  const close = () => { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
  toggle.addEventListener('click', () => { panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); });
  document.getElementById('notes-settings-close').addEventListener('click', close);
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#notes-settings-panel,#notes-settings-toggle')) close(); });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); toggle.focus(); } });
}
