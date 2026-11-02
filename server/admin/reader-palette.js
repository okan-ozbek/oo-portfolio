export const readingPresets = [
  { id: 'soft-dark', name: 'Soft dark', page: '#24252a', text: '#bcb9b2', saturation: 0.25, lightness: 0.65 },
  { id: 'slate', name: 'Slate', page: '#28313a', text: '#b2bac2', saturation: 0.25, lightness: 0.65 },
  { id: 'warm-paper', name: 'Warm paper', page: '#e7dfd0', text: '#5b574f', saturation: 0.28, lightness: 0.38 },
  { id: 'sepia', name: 'Sepia', page: '#d9c9ad', text: '#625442', saturation: 0.22, lightness: 0.36 },
  { id: 'mist', name: 'Mist', page: '#d9dfe0', text: '#505b60', saturation: 0.25, lightness: 0.38 },
];
export const validColor = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
export const rgb = color => [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255);
export const luminance = color => rgb(color).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
const hex = values => '#' + values.map(value => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0')).join('');
const neutral = color => Math.max(...rgb(color)) - Math.min(...rgb(color)) < 0.06;

export function suggestedTextColor(source, preset) {
  if (neutral(source)) return preset.text;
  const [r, g, b] = rgb(source), max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const hue = ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) / 6 + 1) % 1;
  const s = preset.saturation, l = preset.lightness;
  const channel = n => { const k = (n + hue * 12) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return hex([channel(0), channel(8), channel(4)]);
}

// Count colors only when text is painted, excluding diagram fills and hidden OCR.
export function textPalette({ fnArray, argsArray }, ops) {
  let state = { fill: '#000000', stroke: '#000000', mode: 0 };
  const stack = [], counts = new Map();
  const add = (color, weight) => {
    if (!validColor(color)) return;
    color = color.toLowerCase();
    counts.set(color, (counts.get(color) ?? 0) + weight);
  };
  for (let i = 0; i < fnArray.length; i++) {
    const op = fnArray[i], args = argsArray[i] ?? [];
    if ([ops.save, ops.paintFormXObjectBegin, ops.beginGroup, ops.beginAnnotation].includes(op)) stack.push({ ...state });
    else if ([ops.restore, ops.paintFormXObjectEnd, ops.endGroup, ops.endAnnotation].includes(op)) state = stack.pop() ?? state;
    else if (op === ops.setFillRGBColor) state.fill = validColor(args[0]) ? args[0] : hex(args);
    else if (op === ops.setStrokeRGBColor) state.stroke = validColor(args[0]) ? args[0] : hex(args);
    else if (op === ops.setFillGray) state.fill = hex([args[0], args[0], args[0]]);
    else if (op === ops.setStrokeGray) state.stroke = hex([args[0], args[0], args[0]]);
    else if ([ops.setFillColorN, ops.setFillTransparent].includes(op)) state.fill = null;
    else if ([ops.setStrokeColorN, ops.setStrokeTransparent].includes(op)) state.stroke = null;
    else if (op === ops.setTextRenderingMode) state.mode = args[0];
    else if ([ops.showText, ops.showSpacedText, ops.nextLineShowText, ops.nextLineSetSpacingShowText].includes(op)) {
      const weight = Math.max(1, args.flat().filter(item => item && typeof item === 'object' && item.unicode?.trim()).length);
      const mode = state.mode & 3;
      if (mode === 0 || mode === 2) add(state.fill, weight);
      if (mode === 1 || mode === 2) add(state.stroke, weight);
    }
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1]).map(([color]) => color);
  // Near-identical shades need one control, rather than a list of antialias variants.
  const colors = ranked.filter((color, index) => !ranked.slice(0, index).some(other => Math.max(...rgb(color).map((value, i) => Math.abs(value - rgb(other)[i]))) < 0.035));
  const main = colors.find(color => neutral(color) && luminance(color) < 0.65) ?? colors[0];
  return main ? [main, ...colors.filter(color => color !== main)] : [];
}

// A small SVG color mask blends into the base tone along antialiased glyph edges.
export function colorMaskTable(channel) {
  return Array.from({ length: 257 }, (_, i) => Math.max(0, 1 - Math.abs(i / 256 - channel) / 0.18).toFixed(4)).join(' ');
}
