import test from 'node:test';
import assert from 'node:assert/strict';
import { colorMaskTable, luminance, readingPresets, rgb, suggestedTextColor, textPalette, validColor } from '../server/admin/reader-palette.js';

const ops = Object.fromEntries(['save', 'restore', 'setFillRGBColor', 'setStrokeRGBColor', 'setTextRenderingMode', 'showText', 'setFillGray'].map((name, index) => [name, index + 1]));
const glyphs = text => [...text].map(unicode => ({ unicode }));
const paletteFor = operations => textPalette({ fnArray: operations.map(([name]) => ops[name]), argsArray: operations.map(([, args]) => args) }, ops);

test('PDF text palettes preserve distinct text colors, restore graphics state, and exclude non-text fills', () => {
  assert.deepEqual(paletteFor([
    ['setFillRGBColor', ['#ff0000']], // A shape fill is not a font color.
    ['setFillRGBColor', ['#000000']], ['showText', [glyphs('Main body text')]],
    ['save', []], ['setFillRGBColor', ['#00558b']], ['showText', [glyphs('Code')]], ['restore', []],
    ['showText', [glyphs('Body again')]],
    ['setTextRenderingMode', [3]], ['setFillRGBColor', ['#00ff00']], ['showText', [glyphs('Hidden OCR')]],
  ]), ['#000000', '#00558b']);
});

test('stroked text and grayscale text are included without listing near-identical shades separately', () => {
  const colors = paletteFor([
    ['setFillGray', [0]], ['showText', [glyphs('Primary text')]],
    ['setFillRGBColor', ['#030303']], ['showText', [glyphs('Almost black')]],
    ['setTextRenderingMode', [1]], ['setStrokeRGBColor', ['#884444']], ['showText', [glyphs('Outline')]],
  ]);
  assert.deepEqual(colors, ['#000000', '#884444']);
});

test('suggested presets soften the page and preserve colored-text hue distinctions', () => {
  for (const preset of readingPresets) {
    assert.ok(validColor(preset.page)); assert.ok(validColor(preset.text));
    assert.notEqual(preset.page, '#ffffff'); assert.notEqual(preset.text, '#000000');
    assert.equal(suggestedTextColor('#000000', preset), preset.text);
    const blue = suggestedTextColor('#00558b', preset), red = suggestedTextColor('#b00000', preset);
    assert.ok(validColor(blue)); assert.notEqual(blue, red); assert.notEqual(blue, preset.text);
    assert.ok(rgb(blue)[2] > rgb(blue)[0]);
    assert.ok(Math.abs(luminance(preset.page) - luminance(preset.text)) > 0.3);
  }
});

test('color masks select the source shade and blend at antialias boundaries', () => {
  const table = colorMaskTable(0.5).split(' ').map(Number);
  assert.equal(table.length, 257); assert.equal(table[128], 1);
  assert.equal(table[0], 0); assert.equal(table[256], 0);
  assert.ok(table[120] > table[110]); assert.ok(table.every(value => value >= 0 && value <= 1));
});
