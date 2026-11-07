const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Explicit dimensions/positions are fractions of the PDF page, independent of zoom.
export function fitNoteLayout({ x, y, width, height }) {
  width = clamp(width, .001, 4); height = clamp(height, .001, 4);
  return { x: clamp(x, -8, 8), y: clamp(y, -8, 8), width, height };
}

export function displayNoteLayout(note, pageWidth, pageHeight) {
  return fitNoteLayout({ ...note, width: Math.max(note.width, Math.min(160 / pageWidth, 1)), height: Math.max(note.height, Math.min(120 / pageHeight, 1)) });
}

// Keep the whole card inside the reader viewport, including its side margins.
// Resizing holds the left edge still; dragging preserves the card's width.
export function constrainNoteHorizontally(layout, page, viewport, mode = 'drag') {
  const inset = Math.min(8, viewport.width / 4);
  const leftEdge = viewport.left + inset, rightEdge = viewport.left + viewport.width - inset;
  const available = rightEdge - leftEdge, minimum = Math.min(160, page.width, available);
  let width = clamp(layout.width * page.width, minimum, available);
  const left = clamp(page.left + layout.x * page.width, leftEdge, rightEdge - (mode === 'resize' ? minimum : width));
  if (mode === 'resize') width = Math.min(width, rightEdge - left);
  return { ...layout, x: (left - page.left) / page.width, width: width / page.width };
}

export function noteViewport(container) {
  return { left: container.getBoundingClientRect().left + container.clientLeft, width: container.clientWidth };
}

// Choose the page containing the largest area of the note. In a side gutter,
// use vertical overlap; in a gap with no overlap, use the nearest page.
export function pageForNoteRect(rect, pages) {
  let best = null, bestArea = -1, bestVertical = -1, bestDistance = Infinity;
  for (const page of pages) {
    const bounds = page.getBoundingClientRect();
    const vertical = Math.max(0, Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top));
    const horizontal = Math.max(0, Math.min(rect.right, bounds.right) - Math.max(rect.left, bounds.left));
    const area = vertical * horizontal;
    const center = (rect.top + rect.bottom) / 2;
    const distance = Math.max(bounds.top - center, center - bounds.bottom, 0);
    if (area > bestArea || area === bestArea && (vertical > bestVertical || vertical === bestVertical && distance < bestDistance)) {
      best = page; bestArea = area; bestVertical = vertical; bestDistance = distance;
    }
  }
  return best;
}

export function bindNoteGestures({ container, render, save, canStart }) {
  let active = null, animation;
  function measure(card, page) {
    const bounds = page.getBoundingClientRect(), rect = card.getBoundingClientRect();
    return fitNoteLayout({ x: (rect.left - bounds.left) / bounds.width, y: (rect.top - bounds.top) / bounds.height,
      width: rect.width / bounds.width, height: rect.height / bounds.height });
  }
  function applySize(card, layout, page, mode = 'resize') {
    layout = constrainNoteHorizontally(layout, page.getBoundingClientRect(), noteViewport(container), mode);
    card.style.left = `${layout.x * 100}%`; card.style.top = `${layout.y * 100}%`;
    card.style.width = `${layout.width * page.clientWidth}px`;
    card.style.height = 'auto'; card.style.minHeight = `${layout.height * page.clientHeight}px`;
  }
  function start(event, note, card, handle, page, mode) {
    if (event.button !== 0 || active || !canStart() || mode === 'drag' && event.target.closest('button,a,input,[contenteditable=true]')) return;
    event.preventDefault(); event.stopPropagation();
    const rect = card.getBoundingClientRect();
    active = { note, card, handle, mode, page, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      clientX: event.clientX, clientY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
      rect, original: measure(card, page), changed: false };
    if (mode === 'drag') {
      document.body.append(card); card.style.position = 'fixed'; card.style.left = `${rect.left}px`; card.style.top = `${rect.top}px`;
      card.style.width = `${rect.width}px`; card.style.height = `${rect.height}px`;
    } else applySize(card, active.original, page);
    card.style.maxHeight = 'none'; card.classList.remove('anchor-right', 'anchor-bottom'); card.classList.add('pdf-note-manipulating');
    document.body.classList.add('pdf-note-gesture'); handle.setPointerCapture(event.pointerId);
    animation = requestAnimationFrame(autoScroll);
  }
  function update() {
    if (!active) return;
    active.changed ||= Math.hypot(active.clientX - active.startX, active.clientY - active.startY) > 3;
    if (active.mode === 'drag') {
      const bounds = active.page.getBoundingClientRect();
      const layout = constrainNoteHorizontally({ ...active.original, x: (active.clientX - active.offsetX - bounds.left) / bounds.width }, bounds, noteViewport(container));
      active.card.style.left = `${bounds.left + layout.x * bounds.width}px`; active.card.style.width = `${layout.width * bounds.width}px`;
      active.card.style.top = `${active.clientY - active.offsetY}px`;
    } else {
      const bounds = active.page.getBoundingClientRect();
      applySize(active.card, fitNoteLayout({ ...active.original,
        width: clamp((active.clientX - bounds.left + active.rect.right - active.startX) / bounds.width - active.original.x, Math.min(160 / bounds.width, 4), 4),
        height: clamp((active.clientY - bounds.top + active.rect.bottom - active.startY) / bounds.height - active.original.y, Math.min(120 / bounds.height, 4), 4),
      }), active.page);
    }
  }
  function autoScroll() {
    if (!active) return;
    const bounds = container.getBoundingClientRect();
    const top = bounds.top;
    const delta = active.clientY < top + 45 ? -10 : active.clientY > bounds.bottom - 45 ? 10 : 0;
    if (delta) { container.scrollTop += delta; update(); }
    animation = requestAnimationFrame(autoScroll);
  }
  function finish(cancelled = false) {
    const gesture = active;
    if (!gesture) return;
    const page = pageForNoteRect(gesture.card.getBoundingClientRect(), container.querySelectorAll('.page[data-page-number]')) ?? gesture.page;
    const layout = page ? measure(gesture.card, page) : null;
    active = null; cancelAnimationFrame(animation); document.body.classList.remove('pdf-note-gesture');
    if (gesture.handle.hasPointerCapture(gesture.pointerId)) gesture.handle.releasePointerCapture(gesture.pointerId);
    gesture.card.remove(); render();
    if (!cancelled && gesture.changed && page) void save(gesture.note, { ...layout, page: Number(page.dataset.pageNumber) }, gesture.mode);
  }
  document.addEventListener('pointermove', event => {
    if (!active || event.pointerId !== active.pointerId) return;
    event.preventDefault(); active.clientX = event.clientX; active.clientY = event.clientY; update();
  }, { passive: false });
  document.addEventListener('pointerup', event => { if (active?.pointerId === event.pointerId) finish(); });
  document.addEventListener('pointercancel', event => { if (active?.pointerId === event.pointerId) finish(true); });
  window.addEventListener('keydown', event => { if (active && event.key === 'Escape') { event.preventDefault(); finish(true); } });
  window.addEventListener('blur', () => finish(true));
  return { get active() { return Boolean(active); }, bind(handle, note, card, page, mode) {
    handle.addEventListener('pointerdown', event => start(event, note, card, handle, page, mode));
    handle.addEventListener('lostpointercapture', () => { if (active?.handle === handle) finish(true); });
    handle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (active || !canStart()) return;
      const layout = measure(card, page), step = event.shiftKey ? .05 : .01;
      const horizontal = ['ArrowLeft', 'ArrowRight'].includes(event.key), direction = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
      const field = mode === 'drag' ? horizontal ? 'x' : 'y' : horizontal ? 'width' : 'height';
      layout[field] += step * direction;
      applySize(card, fitNoteLayout(layout), page, mode);
      const rect = card.getBoundingClientRect();
      const winner = pageForNoteRect(rect, container.querySelectorAll('.page[data-page-number]')) ?? page;
      const reference = winner.getBoundingClientRect();
      void save(note, { ...fitNoteLayout({ x: (rect.left - reference.left) / reference.width, y: (rect.top - reference.top) / reference.height,
        width: (rect.right - rect.left) / reference.width, height: (rect.bottom - rect.top) / reference.height }), page: Number(winner.dataset.pageNumber) }, mode);
    });
  } };
}
