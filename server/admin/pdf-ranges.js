// The metadata request already supplies the byte length. Use PDF.js's range
// transport directly, avoiding its initial full-file GET and background download.
export function createBookRangeTransport({ PDFDataRangeTransport, url, length, onError, fetchRange = fetch }) {
  const transport = new PDFDataRangeTransport(length, new Uint8Array(), true);
  const pending = new Map();
  let stopped = false;
  transport.abort = () => {
    stopped = true;
    for (const controller of pending.values()) controller.abort();
    pending.clear();
  };
  transport.requestDataRange = (begin, requestedEnd) => {
    const end = Math.min(requestedEnd, length), key = `${begin}-${end}`;
    if (stopped || pending.has(key)) return;
    const controller = new AbortController(); pending.set(key, controller);
    void (async () => {
      const response = await fetchRange(url, { credentials: 'same-origin', headers: { Range: `bytes=${begin}-${end - 1}` }, signal: controller.signal });
      if (response.status === 401) throw new Error('Sign in to your library, then reopen this book.');
      if (response.status !== 206 || response.headers.get('Content-Range') !== `bytes ${begin}-${end - 1}/${length}`) {
        throw new Error('This part of the PDF could not be loaded. Reopen the book to try again.');
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== end - begin) throw new Error('The PDF download was interrupted. Reopen the book to try again.');
      if (!stopped) transport.onDataRange(begin, bytes);
    })().catch(error => {
      if (!stopped) { transport.abort(); onError(error); }
    }).finally(() => pending.delete(key));
  };
  return transport;
}
