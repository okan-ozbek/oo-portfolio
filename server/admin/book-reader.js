import { AnnotationMode, getDocument, GlobalWorkerOptions, PDFDataRangeTransport } from 'pdfjs-dist/build/pdf.mjs';
import { EventBus, PDFFindController, PDFLinkService, PDFViewer, RenderingStates } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { readApiResponse } from './api-response.js';
import { initFilterPicker } from './filter-picker.js';
import { initReadingColors } from './reader-colors.js';
import { initReaderAmbient } from './reader-ambient.js';
import { createBookRangeTransport } from './pdf-ranges.js';
import { initPdfNotes } from './pdf-notes.js';
import { icon } from './icons.js';

const $ = id => document.getElementById(id);
const bookId = new URL(location.href).searchParams.get('book');
const validId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(bookId ?? '');
let viewer, pdfDocument, readingColors;
let pdfNotes;
const zoomPicker = initFilterPicker($('zoom'));
const toolbar = document.querySelector('.reader-toolbar');
const container = $('viewer-container');
const ambient = initReaderAmbient({
  container, viewerElement: $('viewer'), toggle: $('ambient-toggle'),
  settings: {
    panel: $('ambient-panel'), closeButton: $('ambient-close'), enabledInput: $('ambient-enabled'),
    intensityInput: $('ambient-intensity'), intensityOutput: $('ambient-intensity-value'),
    spreadInput: $('ambient-spread'), spreadOutput: $('ambient-spread-value'), resetButton: $('ambient-reset'),
  },
  onOpen: () => zoomPicker.close(),
  getPageCanvas(pageNumber) {
    const page = viewer?.getPageView(pageNumber - 1);
    return page?.renderingState === RenderingStates.FINISHED ? page.canvas : null;
  },
});
function updateNoteWorkspace(center = false) {
  const pages = container.querySelectorAll('.page[data-page-number]');
  if (!pages.length) return;
  document.documentElement.style.setProperty('--reader-page-width', `${Math.max(...[...pages].map(page => page.clientWidth))}px`);
  if (center) {
    const page = viewer?.getPageView(viewer.currentPageNumber - 1)?.div ?? pages[0];
    container.scrollLeft = Math.max(0, page.offsetLeft + page.clientWidth / 2 - container.clientWidth / 2);
  }
  ambient.layoutChanged();
}
new ResizeObserver(() => document.documentElement.style.setProperty('--reader-toolbar-height', `${toolbar.offsetHeight}px`)).observe(toolbar);
for (const control of document.querySelectorAll('[data-reader-icon]')) control.append(icon(control.dataset.readerIcon));
const compactToolbar = matchMedia('(max-width: 520px)');
const zoomGroup = document.querySelector('.reader-zoom');
function arrangeToolbar() {
  zoomPicker.close();
  if (compactToolbar.matches) $('reader-more-tools').prepend(zoomGroup);
  else document.querySelector('.reader-controls').insertBefore(zoomGroup, $('find-toggle'));
  $('reader-more-toggle').setAttribute('aria-expanded', 'false');
}
compactToolbar.addEventListener('change', arrangeToolbar); arrangeToolbar();
$('reader-more-toggle').addEventListener('click', () => {
  $('reader-more-toggle').setAttribute('aria-expanded', String($('reader-more-toggle').getAttribute('aria-expanded') !== 'true'));
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.reader-more')) $('reader-more-toggle').setAttribute('aria-expanded', 'false');
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('reader-more-toggle').getAttribute('aria-expanded') === 'true') {
    $('reader-more-toggle').setAttribute('aria-expanded', 'false'); $('reader-more-toggle').focus();
  }
});
let dark = true;
try { dark = localStorage.getItem('pixelware-pdf-theme') !== 'original'; } catch { /* Reading works when storage is unavailable. */ }
let statusTimer;
const status = (text, error = false) => {
  clearTimeout(statusTimer); $('reader-status').textContent = text; $('reader-status').classList.toggle('is-error', error);
  if (text && !error) statusTimer = setTimeout(() => { $('reader-status').textContent = ''; }, 2200);
};
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
  onOpen() { zoomPicker.close(); },
});
const api = async path => readApiResponse(await fetch(`/api/admin/${path}`));
const hashPage = () => Number(new URLSearchParams(location.hash.slice(1)).get('page'));
function goToPage(page) {
  if (!pdfDocument) return;
  if (!Number.isInteger(page) || page < 1 || page > pdfDocument.numPages) {
    $('page-number').value = viewer.currentPageNumber;
    status(`Choose a page between 1 and ${pdfDocument.numPages}.`, true); return;
  }
  viewer.currentPageNumber = page;
  viewer.scrollPageIntoView({ pageNumber: page });
  updateNoteWorkspace(true);
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
$('page-previous').addEventListener('click', () => goToPage(Math.max(1, viewer.currentPageNumber - 1)));
$('page-next').addEventListener('click', () => goToPage(Math.min(pdfDocument.numPages, viewer.currentPageNumber + 1)));
$('zoom').addEventListener('change', () => { viewer.currentScaleValue = $('zoom').value; });

async function openBook() {
  if (!validId) throw new Error('Choose a book from your library to open the reader.');
  const { book } = await api(`books/${bookId}`);
  pdfNotes = initPdfNotes({ bookId, container, getViewer: () => viewer, status, onLayoutChange: () => updateNoteWorkspace() });
  await pdfNotes.load();
  $('book-title').title = book.name;
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
    viewer.currentScaleValue = '1';
    ambient.pagesInitialized();
    updateNoteWorkspace(true);
    for (const control of document.querySelectorAll('[data-document-control]')) control.disabled = false;
    $('note-add').disabled = $('notes-toggle').disabled = Boolean(pdfNotes.error);
    zoomPicker.sync();
    initialPage = Math.max(1, Math.min(pdfDocument.numPages, initialPage));
    goToPage(initialPage); updatePage(initialPage);
    pdfNotes.render();
    status(pdfNotes.error, Boolean(pdfNotes.error));
  });
  eventBus.on('pagechanging', ({ pageNumber }) => updatePage(pageNumber));
  eventBus.on('pagerendered', ({ pageNumber, error }) => {
    if (error) status('This page could not be rendered. Use Original PDF to open it in your browser.', true);
    else { readingColors.pageRendered(pageNumber); ambient.pageRendered(pageNumber); }
    pdfNotes.render();
  });
  eventBus.on('scalechanging', ({ scale, presetValue }) => {
    requestAnimationFrame(() => { updateNoteWorkspace(true); pdfNotes.render(); });
    const value = presetValue || String(scale);
    const known = [...$('zoom').options].some(option => option.value === value);
    if (!known) $('zoom').querySelector('[value=custom]').textContent = `${Math.round(scale * 100)}%`;
    $('zoom').value = known ? value : 'custom';
    zoomPicker.sync();
  });
  const find = (again = false, previous = false) => eventBus.dispatch('find', { source: window, type: again ? 'again' : '', query: $('find-input').value, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false });
  $('find-toggle').addEventListener('click', () => {
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
  new ResizeObserver(() => {
    if (pdfDocument && ['page-width', 'page-fit'].includes($('zoom').value)) viewer.currentScaleValue = $('zoom').value;
    updateNoteWorkspace(true); pdfNotes.render();
  }).observe(container);
}
void openBook().catch(error => { status(error.message, true); });
