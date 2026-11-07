const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Explicit dimensions/positions are fractions of the PDF page, independent of zoom.
export function fitNoteLayout({ x, y, width, height }) {
  width = clamp(width, .001, 1); height = clamp(height, .001, 1);
  return { x: clamp(x, 0, 1 - width), y: clamp(y, 0, 1 - height), width, height };
}

export function displayNoteLayout(note, pageWidth, pageHeight) {
  return fitNoteLayout({ ...note, width: Math.max(note.width, Math.min(160 / pageWidth, 1)), height: Math.max(note.height, Math.min(120 / pageHeight, 1)) });
}

export function bindNoteGestures({ container, render, save, canStart }) {
  let active = null, animation;
  function measure(card, page) {
    const bounds = page.getBoundingClientRect(), rect = card.getBoundingClientRect();
    return fitNoteLayout({ x: (rect.left - bounds.left) / bounds.width, y: (rect.top - bounds.top) / bounds.height,
      width: rect.width / bounds.width, height: rect.height / bounds.height });
  }
  function applySize(card, layout, page) {
    card.style.left = `${layout.x * 100}%`; card.style.top = `${layout.y * 100}%`;
    card.style.width = `${layout.width * page.clientWidth}px`; card.style.height = `${layout.height * page.clientHeight}px`;
  }
  function start(event, note, card, handle, page, mode) {
    if (event.button !== 0 || active || !canStart()) return;
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
      active.card.style.left = `${active.clientX - active.offsetX}px`; active.card.style.top = `${active.clientY - active.offsetY}px`;
    } else {
      const bounds = active.page.getBoundingClientRect();
      applySize(active.card, fitNoteLayout({ ...active.original,
        width: clamp((active.clientX - bounds.left + active.rect.right - active.startX) / bounds.width - active.original.x, Math.min(160 / bounds.width, 1 - active.original.x), 1 - active.original.x),
        height: clamp((active.clientY - bounds.top + active.rect.bottom - active.startY) / bounds.height - active.original.y, Math.min(120 / bounds.height, 1 - active.original.y), 1 - active.original.y),
      }), active.page);
    }
  }
  function autoScroll() {
    if (!active) return;
    const bounds = container.getBoundingClientRect();
    const top = document.body.classList.contains('reader-toolbar-hidden') ? bounds.top : Math.max(bounds.top, document.querySelector('.reader-toolbar').getBoundingClientRect().bottom);
    const delta = active.clientY < top + 45 ? -10 : active.clientY > bounds.bottom - 45 ? 10 : 0;
    if (delta) { container.scrollTop += delta; update(); }
    animation = requestAnimationFrame(autoScroll);
  }
  function finish(cancelled = false) {
    const gesture = active;
    if (!gesture) return;
    let page = gesture.page;
    if (gesture.mode === 'drag') page = [...container.querySelectorAll('.page[data-page-number]')].find(node => {
      const bounds = node.getBoundingClientRect();
      return gesture.clientX >= bounds.left && gesture.clientX <= bounds.right && gesture.clientY >= bounds.top && gesture.clientY <= bounds.bottom;
    });
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
      void save(note, fitNoteLayout(layout), mode);
    });
  } };
}
