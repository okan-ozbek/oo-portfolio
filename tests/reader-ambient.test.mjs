import test from 'node:test';
import assert from 'node:assert/strict';
import { initReaderAmbient } from '../server/admin/reader-ambient.js';

function fixture(t, { saved, savedSettings, unavailableStorage = false } = {}) {
  const frames = new Map(), stored = new Map(saved ? [['pixelware-pdf-ambient', saved]] : []);
  if (savedSettings !== undefined) stored.set('pixelware-pdf-ambient-settings', savedSettings);
  const draws = []; let nextFrame = 0, intersection;
  class Element extends EventTarget {
    children = []; style = { setProperty(key, value) { this[key] = value; } }; attrs = {}; dataset = {};
    classes = new Set();
    classList = { toggle: (name, active) => { if (active) this.classes.add(name); else this.classes.delete(name); } };
    rect = { left: 20, top: 50, width: 816, height: 1056 };
    append(child) { child.parentElement = this; this.children.push(child); }
    prepend(child) { child.parentElement = this; this.children.unshift(child); }
    setAttribute(key, value) { this.attrs[key] = value; }
    focus() { this.focused = true; }
    getBoundingClientRect() { return this.rect; }
    querySelectorAll() { return this.children; }
    replaceChildren() { this.children = []; }
    remove() { this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
    getContext() { return { fillRect() {}, drawImage: (...args) => draws.push(args) }; }
  }
  const document = Object.assign(new EventTarget(), { hidden: false, createElement: () => new Element() });
  for (const [key, value] of Object.entries({
    document, window: new EventTarget(),
    localStorage: { getItem(key) { if (unavailableStorage) throw Error('Blocked'); return stored.get(key) ?? null; }, setItem(key, value) { if (unavailableStorage) throw Error('Blocked'); stored.set(key, value); } },
    requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id),
    IntersectionObserver: class {
      targets = new Set();
      constructor(callback) { this.callback = callback; intersection = { callback, targets: this.targets }; }
      observe(page) { this.targets.add(page); }
      disconnect() { this.targets.clear(); }
    },
    ResizeObserver: class { observe() {} disconnect() {} },
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else delete globalThis[key]; });
  }
  const container = new Element(), main = new Element(), viewerElement = new Element(), toggle = new Element();
  main.append(container);
  const pages = [1, 2].map(number => { const page = new Element(); page.dataset.pageNumber = String(number); viewerElement.append(page); return page; });
  const canvases = new Map([[1, { width: 1632, height: 2112 }], [2, { width: 1632, height: 2112 }]]);
  const settings = Object.fromEntries(['panel', 'closeButton', 'enabledInput', 'intensityInput', 'intensityOutput', 'spreadInput', 'spreadOutput', 'resetButton'].map(key => [key, new Element()]));
  settings.panel.hidden = true;
  const ambient = initReaderAmbient({ container, viewerElement, toggle, settings, onOpen() {}, getPageCanvas: page => canvases.get(page) });
  const flush = () => { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(); };
  const enter = (page, isIntersecting = true) => intersection.callback([{ target: page, isIntersecting }]);
  const setEnabled = enabled => { settings.enabledInput.checked = enabled; settings.enabledInput.dispatchEvent(new Event('change')); };
  return { ambient, canvases, container, document, draws, enter, flush, frames, intersection, layer: main.children[0], surface: main.children[0].children[0], pages, setEnabled, settings, stored, toggle };
}

test('ambient mode samples only nearby rendered pages and repositions without recopying on scroll', t => {
  const f = fixture(t);
  assert.equal(f.settings.enabledInput.checked, true);
  assert.equal(f.layer.attrs['aria-hidden'], 'true');
  f.enter(f.pages[0]); f.flush();
  assert.equal(f.draws.length, 1);
  assert.equal(f.draws[0][0], f.canvases.get(1));
  assert.deepEqual(f.draws[0].slice(1), [0, 0, 48, 62]);
  const glow = f.surface.children[0];
  assert.equal(glow.children.length, 1);
  f.pages[0].rect.top -= 100;
  f.container.dispatchEvent(new Event('scroll')); f.container.dispatchEvent(new Event('scroll'));
  assert.equal(f.frames.size, 1); f.flush();
  assert.equal(glow.style.top, '-100px'); assert.equal(f.draws.length, 1);
  f.canvases.set(1, null); f.pages[0].rect.width = 1020;
  f.ambient.layoutChanged(); f.flush();
  assert.equal(glow.style.width, '1020px', 'Keep the existing glow aligned during a PDF rerender');
  f.canvases.set(1, { width: 2040, height: 2640 });
  f.ambient.pageRendered(1); f.flush(); assert.equal(f.draws.length, 2);
  f.enter(f.pages[0], false); f.flush(); assert.equal(f.surface.children.length, 0);
});

test('turning ambient mode off releases samples and restores its remembered setting', t => {
  const f = fixture(t, { saved: 'off' });
  assert.equal(f.layer.hidden, true); assert.equal(f.intersection.targets.size, 0);
  f.setEnabled(true);
  assert.equal(f.stored.get('pixelware-pdf-ambient'), 'on'); assert.equal(f.intersection.targets.size, 2);
  f.enter(f.pages[1]); f.flush(); assert.equal(f.draws.length, 1);
  f.setEnabled(false);
  assert.equal(f.stored.get('pixelware-pdf-ambient'), 'off'); assert.equal(f.surface.children.length, 0);
  assert.equal(f.intersection.targets.size, 0); assert.equal(f.settings.enabledInput.checked, false);
  assert.equal(f.settings.intensityInput.disabled, true); assert.equal(f.settings.spreadInput.disabled, true);
  f.ambient.pageRendered(2); f.container.dispatchEvent(new Event('scroll')); f.flush();
  assert.equal(f.draws.length, 1);
});

test('ambient mode tolerates blocked storage and pauses while the reader is hidden', t => {
  const f = fixture(t, { unavailableStorage: true });
  f.enter(f.pages[0]); f.flush(); assert.equal(f.draws.length, 1);
  f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange'));
  f.ambient.pageRendered(1); f.flush(); assert.equal(f.draws.length, 1); assert.equal(f.layer.hidden, true);
  f.document.hidden = false; f.document.dispatchEvent(new Event('visibilitychange')); f.flush();
  assert.equal(f.draws.length, 2); assert.equal(f.layer.hidden, false);
  assert.doesNotThrow(() => f.setEnabled(false));
  assert.equal(f.settings.enabledInput.checked, false);
});

test('ambient sliders update the glow live without resampling and remember their values', t => {
  const f = fixture(t, { savedSettings: JSON.stringify({ intensity: 35, spread: 20 }) });
  assert.equal(f.layer.style['--reader-ambient-opacity'], '0.35');
  assert.equal(f.settings.intensityInput.value, '35'); assert.equal(f.settings.spreadInput.value, '20');
  f.enter(f.pages[0]); f.flush();
  f.settings.intensityInput.value = '90'; f.settings.intensityInput.dispatchEvent(new Event('input'));
  f.settings.spreadInput.value = '100'; f.settings.spreadInput.dispatchEvent(new Event('input')); f.flush();
  assert.equal(f.layer.style['--reader-ambient-opacity'], '0.9');
  assert.equal(f.layer.style['--reader-ambient-extension'], '60px');
  assert.equal(f.settings.intensityOutput.textContent, '90%'); assert.equal(f.settings.spreadOutput.textContent, '100%');
  assert.deepEqual(JSON.parse(f.stored.get('pixelware-pdf-ambient-settings')), { intensity: 90, spread: 100 });
  assert.equal(f.draws.length, 1);
  f.setEnabled(false); f.settings.resetButton.dispatchEvent(new Event('click'));
  assert.equal(f.settings.enabledInput.checked, true);
  assert.deepEqual(JSON.parse(f.stored.get('pixelware-pdf-ambient-settings')), { intensity: 72, spread: 60 });
});

test('ambient settings bound stored values and the panel supports keyboard dismissal', t => {
  const f = fixture(t, { savedSettings: JSON.stringify({ intensity: 500, spread: 'bad' }) });
  assert.equal(f.settings.intensityInput.value, '100'); assert.equal(f.settings.spreadInput.value, '60');
  f.toggle.dispatchEvent(new Event('click'));
  assert.equal(f.settings.panel.hidden, false); assert.equal(f.toggle.attrs['aria-expanded'], 'true');
  assert.equal(f.settings.enabledInput.focused, true);
  f.settings.panel.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
  assert.equal(f.settings.panel.hidden, true); assert.equal(f.toggle.attrs['aria-expanded'], 'false');
  assert.equal(f.toggle.focused, true);
  assert.equal(f.settings.enabledInput.checked, true, 'Opening or closing settings does not toggle the glow');
});
