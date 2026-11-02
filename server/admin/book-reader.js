import { AnnotationMode, getDocument, GlobalWorkerOptions, PDFDataRangeTransport } from 'pdfjs-dist/build/pdf.mjs';
import { EventBus, PDFFindController, PDFLinkService, PDFViewer, RenderingStates } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { readApiResponse } from './api-response.js';
import { initFilterPicker } from './filter-picker.js';
import { initReadingColors } from './reader-colors.js';
import { createBookRangeTransport } from './pdf-ranges.js';

const $ = id => document.getElementById(id);
const bookId = new URL(location.href).searchParams.get('book');
const validId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(bookId ?? '');
let viewer, pdfDocument, readingColors;
const zoomPicker = initFilterPicker($('zoom'));
const toolbar = document.querySelector('.reader-toolbar');
const container = $('viewer-container');
new ResizeObserver(() => document.documentElement.style.setProperty('--reader-toolbar-height', `${toolbar.offsetHeight}px`)).observe(toolbar);
let lastScroll = 0, scrollDistance = 0, lastDirection = 0, ignoreScrollUntil = 0;
function revealToolbar() {
  document.body.classList.remove('reader-toolbar-hidden'); toolbar.inert = false;
  lastScroll = container.scrollTop; scrollDistance = 0; lastDirection = 0;
  ignoreScrollUntil = performance.now() + 250;
}
container.addEventListener('scroll', () => {
  const top = Math.max(0, container.scrollTop), delta = top - lastScroll;
  lastScroll = top;
  if (!pdfDocument || Math.abs(delta) < 1) return;
  if (top < 24) { revealToolbar(); return; }
  if (performance.now() < ignoreScrollUntil || zoomPicker.isOpen || readingColors?.isOpen || !$('find-bar').hidden || toolbar.contains(document.activeElement) && document.activeElement.matches('input')) {
    scrollDistance = 0; return;
  }
  const direction = Math.sign(delta);
  scrollDistance = direction === lastDirection ? scrollDistance + Math.abs(delta) : Math.abs(delta);
  lastDirection = direction;
  if (scrollDistance < (direction > 0 ? 32 : 8)) return;
  const hidden = direction > 0 && top > toolbar.offsetHeight;
  document.body.classList.toggle('reader-toolbar-hidden', hidden); toolbar.inert = hidden;
}, { passive: true });
container.addEventListener('pointermove', event => { if (event.clientY < 16) revealToolbar(); });
window.addEventListener('keydown', event => { if (event.key === 'Tab') revealToolbar(); });
let dark = true;
try { dark = localStorage.getItem('pixelware-pdf-theme') !== 'original'; } catch { /* Reading works when storage is unavailable. */ }
const status = (text, error = false) => { $('reader-status').textContent = text; $('reader-status').classList.toggle('is-error', error); };
function applyTheme() {
  document.documentElement.dataset.theme = dark ? 'dark' : 'original';
  $('theme-toggle').setAttribute('aria-pressed', String(dark));
}
applyTheme();
$('theme-toggle').addEventListener('click', () => {
  readingColors.disable();
  dark = !dark; applyTheme();
  try { localStorage.setItem('pixelware-pdf-theme', dark ? 'dark' : 'original'); } catch { /* Keep the in-memory preference. */ }
});
readingColors = initReadingColors({
  bookId, getDocument: () => pdfDocument, getPageNumber: () => viewer?.currentPageNumber ?? 1, isDark: () => dark,
  onTheme(value) {
    dark = value; applyTheme();
    try { localStorage.setItem('pixelware-pdf-theme', dark ? 'dark' : 'original'); } catch { /* Keep the in-memory preference. */ }
  },
  onOpen() { revealToolbar(); zoomPicker.close(); },
});
const api = async path => readApiResponse(await fetch(`/api/admin/${path}`));
const hashPage = () => Number(new URLSearchParams(location.hash.slice(1)).get('page'));
function goToPage(page) {
  if (!pdfDocument) return;
  if (!Number.isInteger(page) || page < 1 || page > pdfDocument.numPages) {
    $('page-number').value = viewer.currentPageNumber;
    status(`Choose a page between 1 and ${pdfDocument.numPages}.`, true); return;
  }
  revealToolbar();
  viewer.currentPageNumber = page;
  container.scrollTop = Math.max(0, container.scrollTop - toolbar.offsetHeight);
}
function updatePage(page) {
  $('page-number').value = page;
  $('original-pdf').href = `/api/admin/books/${bookId}/pdf#page=${page}`;
  history.replaceState(null, '', `${location.pathname}${location.search}#page=${page}`);
  readingColors.pageChanged();
  if (viewer.getPageView(page - 1)?.renderingState === RenderingStates.FINISHED) readingColors.pageRendered(page);
}
$('page-number').addEventListener('change', () => goToPage(Number($('page-number').value)));
$('page-number').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); goToPage(Number(event.target.value)); event.target.blur(); } });
$('zoom').addEventListener('change', () => { revealToolbar(); viewer.currentScaleValue = $('zoom').value; });

async function openBook() {
  if (!validId) throw new Error('Choose a book from your library to open the reader.');
  const { book } = await api(`books/${bookId}`);
  $('book-title').textContent = book.name; document.title = `${book.name} · Pixelware reader`;
  $('original-pdf').href = `/api/admin/books/${bookId}/pdf`;
  $('original-pdf').hidden = false;
  GlobalWorkerOptions.workerSrc = '/admin/pdfjs/build/pdf.worker.mjs';
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus, externalLinkTarget: 2, externalLinkRel: 'noopener noreferrer' });
  const findController = new PDFFindController({ eventBus, linkService });
  viewer = new PDFViewer({ container: $('viewer-container'), viewer: $('viewer'), eventBus, linkService, findController, imageResourcesPath: '/admin/pdfjs/web/images/', annotationMode: AnnotationMode.ENABLE });
  linkService.setViewer(viewer);
  const requestedPage = hashPage();
  let initialPage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : book.bookmarkPage || 1;
  eventBus.on('pagesinit', () => {
    viewer.currentScaleValue = 'page-width';
    for (const control of document.querySelectorAll('[data-document-control]')) control.disabled = false;
    zoomPicker.sync();
    initialPage = Math.max(1, Math.min(pdfDocument.numPages, initialPage));
    goToPage(initialPage); updatePage(initialPage);
    status('');
  });
  eventBus.on('pagechanging', ({ pageNumber }) => updatePage(pageNumber));
  eventBus.on('pagerendered', ({ pageNumber, error }) => {
    if (error) status('This page could not be rendered. Use Original PDF to open it in your browser.', true);
    else readingColors.pageRendered(pageNumber);
  });
  eventBus.on('scalechanging', ({ scale, presetValue }) => {
    const value = presetValue || String(scale);
    const known = [...$('zoom').options].some(option => option.value === value);
    if (!known) $('zoom').querySelector('[value=custom]').textContent = `${Math.round(scale * 100)}%`;
    $('zoom').value = known ? value : 'custom';
    zoomPicker.sync();
  });
  const find = (again = false, previous = false) => eventBus.dispatch('find', { source: window, type: again ? 'again' : '', query: $('find-input').value, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false });
  $('find-toggle').addEventListener('click', () => {
    revealToolbar();
    $('find-bar').hidden = !$('find-bar').hidden;
    $('find-toggle').setAttribute('aria-expanded', String(!$('find-bar').hidden));
    if (!$('find-bar').hidden) $('find-input').focus();
  });
  $('find-input').addEventListener('input', () => find());
  $('find-bar').addEventListener('submit', event => { event.preventDefault(); find(true, event.shiftKey); });
  $('find-previous').addEventListener('click', () => find(true, true));
  eventBus.on('updatefindmatchescount', ({ matchesCount }) => { $('find-status').textContent = matchesCount.total ? `${matchesCount.current} / ${matchesCount.total}` : 'No matches'; });
  eventBus.on('updatefindcontrolstate', ({ state }) => { if (state === 1) $('find-status').textContent = 'No matches'; });
  window.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      revealToolbar();
      event.preventDefault(); $('find-bar').hidden = false; $('find-toggle').setAttribute('aria-expanded', 'true'); $('find-input').focus(); $('find-input').select();
    }
    if (event.key === 'Escape' && !$('find-bar').hidden) { $('find-bar').hidden = true; $('find-toggle').setAttribute('aria-expanded', 'false'); $('viewer-container').focus(); }
  });
  window.addEventListener('hashchange', () => goToPage(hashPage()));
  let loadingTask, rangeError;
  const range = createBookRangeTransport({ PDFDataRangeTransport, url: `/api/admin/books/${bookId}/pdf`, length: book.size,
    onError(error) { rangeError = error; status(error.message, true); void loadingTask?.destroy(); },
  });
  loadingTask = getDocument({ range, rangeChunkSize: 256 * 1024, disableAutoFetch: true, disableStream: true, cMapUrl: '/admin/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/admin/pdfjs/standard_fonts/', wasmUrl: '/admin/pdfjs/wasm/', isEvalSupported: false, enableXfa: false });
  window.addEventListener('pagehide', event => { if (!event.persisted) { range.abort(); void loadingTask.destroy(); } });
  try { pdfDocument = await loadingTask.promise; } catch (error) { throw rangeError ?? error; }
  $('page-count').textContent = `/ ${pdfDocument.numPages}`; $('page-number').max = pdfDocument.numPages;
  linkService.setDocument(pdfDocument); viewer.setDocument(pdfDocument);
  new ResizeObserver(() => { revealToolbar(); if (pdfDocument && ['page-width', 'page-fit'].includes($('zoom').value)) viewer.currentScaleValue = $('zoom').value; }).observe(container);
}
void openBook().catch(error => { status(error.message, true); });
