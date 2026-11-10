const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = value => Math.round(value * 1e6) / 1e6;
const onlyKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));

// Page-relative highlight geometry is independent of the movable post-it.
export function normalizeTextAnchor(value, pages = Infinity) {
  if (value === null) return null;
  if (!onlyKeys(value, ['text', 'rects']) || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 20000 ||
      !Array.isArray(value.rects) || !value.rects.length || value.rects.length > 500) throw new Error('Select up to 20,000 characters and 500 text fragments.');
  const rects = value.rects.map(rect => {
    if (!onlyKeys(rect, ['page', 'x', 'y', 'width', 'height']) || !Number.isSafeInteger(rect.page) || rect.page < 1 || rect.page > pages ||
        !['x', 'y', 'width', 'height'].every(key => typeof rect[key] === 'number' && Number.isFinite(rect[key])) ||
        rect.x < 0 || rect.y < 0 || rect.x >= 1 || rect.y >= 1 || rect.width <= 0 || rect.height <= 0 ||
        rect.x + rect.width > 1.000001 || rect.y + rect.height > 1.000001) throw new Error('Highlight rectangles must stay inside their PDF pages.');
    return { page: rect.page, x: rect.x, y: rect.y, width: Math.min(rect.width, 1 - rect.x), height: Math.min(rect.height, 1 - rect.y) };
  });
  return { text: value.text.trim(), rects };
}

export function capturePdfSelection(container, selection) {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const rects = [], text = [];
  for (let index = 0; index < selection.rangeCount; index++) {
    const range = selection.getRangeAt(index);
    const element = node => node.nodeType === 1 ? node : node.parentElement;
    if (![range.startContainer, range.endContainer].every(node => {
      const layer = element(node)?.closest('.textLayer'); return layer && container.contains(layer);
    })) return null;
    for (const layer of container.querySelectorAll('.textLayer')) {
      if (!range.intersectsNode(layer)) continue;
      const page = layer.closest('.page[data-page-number]'), bounds = page.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
      for (let node; (node = walker.nextNode());) {
        if (!range.intersectsNode(node)) continue;
        const start = range.startContainer === node ? range.startOffset : 0;
        const end = range.endContainer === node ? range.endOffset : node.length;
        if (end <= start || !node.textContent.slice(start, end).trim()) continue;
        const fragment = document.createRange(); fragment.setStart(node, start); fragment.setEnd(node, end);
        text.push(node.textContent.slice(start, end));
        for (const rect of fragment.getClientRects()) {
          const x = round(clamp((rect.left - bounds.left) / bounds.width, 0, 1));
          const y = round(clamp((rect.top - bounds.top) / bounds.height, 0, 1));
          const right = round(clamp((rect.right - bounds.left) / bounds.width, 0, 1));
          const bottom = round(clamp((rect.bottom - bounds.top) / bounds.height, 0, 1));
          if (right > x && bottom > y) rects.push({ page: Number(page.dataset.pageNumber), x, y, width: round(right - x), height: round(bottom - y) });
        }
        if (rects.length > 2000 || text.join(' ').length > 20000) throw new Error('Select a shorter passage before adding a linked note.');
      }
    }
  }
  if (!rects.length) return null;
  // Adjacent spans on one line form one continuous highlight, including spaces.
  const lines = [];
  for (const rect of rects.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)) {
    const last = lines.at(-1);
    if (last && last.page === rect.page && Math.abs(last.y + last.height / 2 - rect.y - rect.height / 2) < Math.min(last.height, rect.height) * .3 &&
        rect.x >= last.x && rect.x <= last.x + last.width + .004) {
      const right = Math.max(last.x + last.width, rect.x + rect.width), bottom = Math.max(last.y + last.height, rect.y + rect.height);
      last.y = Math.min(last.y, rect.y); last.width = right - last.x; last.height = bottom - last.y;
    } else lines.push({ ...rect });
  }
  return normalizeTextAnchor({ text: text.join(' ').replace(/\s+/g, ' ').trim(), rects: lines });
}

export function randomNoteRect(viewport, width = 230, height = 180, random = Math.random) {
  const inset = Math.min(12, viewport.width / 4, viewport.height / 4);
  width = Math.min(width, Math.max(1, viewport.width - inset * 2));
  height = Math.min(height, Math.max(1, viewport.height - inset * 2));
  const left = viewport.left + inset + clamp(random(), 0, 1) * Math.max(0, viewport.width - inset * 2 - width);
  const top = viewport.top + inset + clamp(random(), 0, 1) * Math.max(0, viewport.height - inset * 2 - height);
  return { left, top, right: left + width, bottom: top + height, width, height };
}
