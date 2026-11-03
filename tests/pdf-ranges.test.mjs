import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookRangeTransport } from '../server/admin/pdf-ranges.js';

class Transport {
  constructor(length, initialData, progressiveDone) { Object.assign(this, { length, initialData, progressiveDone, received: [] }); }
  onDataRange(begin, bytes) { this.received.push({ begin, bytes: [...bytes] }); }
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const partial = (bytes, begin, length) => new Response(new Uint8Array(bytes), { status: 206, headers: { 'Content-Range': `bytes ${begin}-${begin + bytes.length - 1}/${length}` } });

test('PDF transport fetches only requested sections, deduplicates in-flight requests, and handles out-of-order responses', async () => {
  const requests = [], errors = [];
  const transport = createBookRangeTransport({ PDFDataRangeTransport: Transport, url: '/private/book.pdf', length: 10, onError: error => errors.push(error),
    fetchRange(url, options) { const pending = Promise.withResolvers(); requests.push({ url, options, ...pending }); return pending.promise; },
  });
  assert.equal(requests.length, 0, 'No full-file request during construction');
  assert.equal(transport.length, 10); assert.equal(transport.initialData.length, 0); assert.equal(transport.progressiveDone, true);
  transport.requestDataRange(0, 4); transport.requestDataRange(0, 4); transport.requestDataRange(8, 12);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers.Range, 'bytes=0-3');
  assert.equal(requests[1].options.headers.Range, 'bytes=8-9');
  assert.equal(requests[0].options.credentials, 'same-origin');
  requests[1].resolve(partial([8, 9], 8, 10)); await settle();
  requests[0].resolve(partial([0, 1, 2, 3], 0, 10)); await settle();
  assert.deepEqual(transport.received, [{ begin: 8, bytes: [8, 9] }, { begin: 0, bytes: [0, 1, 2, 3] }]);
  assert.deepEqual(errors, []);
});

test('closing a PDF aborts pending requests and discards late data', async () => {
  const pending = Promise.withResolvers(); let signal;
  const transport = createBookRangeTransport({ PDFDataRangeTransport: Transport, url: '/book.pdf', length: 10, onError: assert.fail,
    fetchRange(_url, options) { signal = options.signal; return pending.promise; },
  });
  transport.requestDataRange(0, 2); transport.abort();
  assert.equal(signal.aborted, true);
  pending.resolve(partial([0, 1], 0, 10)); await settle();
  assert.deepEqual(transport.received, []);
});

test('invalid, unauthorized, and truncated range responses fail clearly and stop other requests', async () => {
  for (const response of [
    new Response('login', { status: 401 }), new Response('unexpected full PDF', { status: 200 }),
    partial([1, 2], 5, 10),
    new Response(new Uint8Array([1]), { status: 206, headers: { 'Content-Range': 'bytes 0-1/10' } }),
  ]) {
    const errors = []; let requests = 0;
    const transport = createBookRangeTransport({ PDFDataRangeTransport: Transport, url: '/book.pdf', length: 10, onError: error => errors.push(error),
      fetchRange: async () => { requests++; return response; },
    });
    transport.requestDataRange(0, 2); await settle(); transport.requestDataRange(2, 4);
    assert.equal(requests, 1); assert.equal(errors.length, 1); assert.deepEqual(transport.received, []);
    assert.match(errors[0].message, /Sign in|could not be loaded|interrupted/);
  }
});
