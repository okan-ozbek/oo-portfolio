# Performance review — 3 November 2026

## Implementation status

The first implementation batch now separates book metadata from PDF rows,
loads admin sections and the notes editor on demand, revalidates/caches public
assets, removes hidden blog preview/library/history work, and avoids resume PDF
reads for metadata and cached thumbnails. Deployment promotes tested images
through GitHub Container Registry by digest, using temporary workflow credentials
instead of VPS builds. The runtime dependency-copy stage excludes browser/build
packages. Bundle publication stages complete builds and retains the preceding
generation; development preserves older chunks for active tabs.

The PDF reader's on-demand ranges, metadata-only HEAD, cached palettes, and
unchanged-filter reuse were implemented before this batch. SQLite range slices
still have native SQLite traversal costs; filesystem PDF migration remains a
separate change. Public HTML output caching remains deferred pending production
traffic/render profiles. The original measurements below describe the baseline.

Validation: the full production build, static checks, 95 admin regression tests,
typecheck, and lint passed. The final Docker image passed isolated deployment
persistence and NGINX/admin/compiler smoke tests. In a new 80 MiB disposable WAL
fixture, individual bookmark/completion/rename saves took 6.48/1.47/1.33 ms.
These remain diagnostic single-operation measurements. Browser checks confirmed
zero Markdown editor instances in analytics and the book library, notes loaded
on demand with their content intact, and preview/changelog rendering on demand.
The runtime stage copies 22 installed packages and their resolution paths.
Registry promotion was tested with a mocked registry client; activation and
production timing require the next GitHub Actions deployment run.

The strongest findings are synchronous PDF storage work in the admin service,
eager editor loading, and rebuilding admin images during deployment. The recent
notes fix addresses one instance of the storage problem; other book operations
still have it.

This review measured the local working tree on Windows with Node 24.21.0. CI uses
Node 22 on Linux. These are diagnostic measurements, not production latency or
GitHub Actions timings. No live workflow logs or VPS profiles were available.

## Measurements

Book measurements used a disposable, file-backed SQLite database in WAL mode,
an 80 MiB synthetic PDF, and the actual `createBooks().adminRoute()` handlers.
The fixture used a stub inspector, so upload/Poppler time is excluded. Each
operation below was measured once; timings establish the scale of the problem,
not a statistical latency distribution.

| Operation | Local duration | Finding |
| --- | ---: | --- |
| List books | 0.2 ms | Covering metadata index is effective |
| Read notes | 0.3 ms | Separate notes storage is effective |
| Save notes | 1.5 ms | Separate notes storage is effective |
| PDF HEAD | 54.5 ms | Fetches the entire PDF despite returning no body |
| PDF range, first 64 KiB | 54.1 ms | Fetches the entire 80 MiB PDF before slicing |
| Save bookmark | 423.8 ms | Updates the row containing the PDF |
| Change completion | 99.7 ms | Updates the row containing the PDF |

An independently scheduled zero-delay timer was delayed by approximately the
same duration as each slow handler. This work blocks other requests in the same
Node process, explaining how a book operation can pause unrelated admin actions.

Other measurements:

- Full production build: **3.75 seconds**, with dependencies already installed.
  `npm run build` completed successfully, including prerender, validation, and
  static gzip generation. Dependency installation and Docker work are excluded.
- Markdown editor static import graph: **777 KiB uncompressed / 275 KiB gzip**.
  It loads on every admin visit, including link analytics and resume management.
  Both the book and blog editor are instantiated at startup.
- PDF reader static import graph: **622 KiB / 189 KiB gzip**. This is already on
  a separate reader page; it is not eagerly loaded by the main admin entry.
- Artwork static import graph: **24 KiB / 11 KiB gzip**. This is a much smaller
  target than the Markdown editor.
- Fresh blog/admin browser build: **6.33 MiB across 109 output files**. The local
  output directory also contained **5.14 MiB of obsolete chunks**. These are disk
  and packaging overhead, not proof that a browser downloads them.
- Editor state-only selection benchmark: median **1.4 ms at 100,000 characters**,
  **3.4 ms at 300,000 characters** across 30 selection updates. This excludes DOM
  layout, syntax-highlighted widgets, and Mermaid rendering; a wholesale editor
  rewrite is not supported by these results.

## Recommended implementation order

### 1. Finish separating book state from PDF bytes

`server/books.mjs` still writes `bookmark_page`, `completed`, name, and tags on
the PDF-containing row (lines 162, 186, and 215 at review time). Move mutable
book state to a compact table, using the same transactional, one-time migration
pattern as notes. Keep PDF content immutable between upload and deletion.

Handle HEAD from stored size/metadata. Read only the requested bytes for range
requests, rather than selecting the full BLOB. Options include bounded SQLite
BLOB slices or files streamed from the persistent data volume. Benchmark the
chosen approach: small output alone does not prove SQLite avoided traversing
the BLOB. File storage requires a migration and coordinated deletion/backups.

Acceptance: metadata edits must not update the PDF record; HEAD must not read PDF
bytes; range requests must avoid whole-PDF allocations. Check event-loop delay
and concurrent metadata requests with 20–100 MiB fixtures.

### 2. Load admin sections and editors on demand; cache code assets

`server/admin/admin.js` statically imports every workspace and initializes all
of them before session loading. Books and Blogs both import the Markdown editor.
Defer workspace imports until their section is selected, and create the notes
editor when the notes dialog first opens. Retain instances after first use so
navigation and in-progress editing remain reliable.

`server/admin-server.mjs`, `server/blogs.mjs`, and `server/home.mjs` synchronously
read code assets per request. The server defaults to `Cache-Control: no-store`,
including these assets and PDF.js resources. Cache immutable release assets in
memory or serve them through NGINX, with versioned URLs or ETag revalidation.
Use long immutable browser caching only for content-addressed filenames. Keep
private API data under its existing access controls and cache policy.

NGINX already compresses proxied JS/CSS; adding another compression layer is
not the first priority. Measure cold and repeat admin visits separately.

### 3. Deploy the tested admin/compiler images instead of rebuilding them

The workflow currently does this:

1. Install dependencies and run `npm test`, including a full site build.
2. Build the admin Docker image, which installs dependencies and runs the full
   site build again (`deploy/Dockerfile.admin`, line 6).
3. Build the compiler image and run smoke tests against those CI images.
4. Transfer source and the verified static frontend to the VPS.
5. Run `docker compose build` on the VPS (`deploy/install-release.sh`, line 42).
   Changed admin source can therefore trigger another admin build there.

The frontend already reuses its verified CI output, and CI already has npm and
BuildKit caching plus parallel container smoke tests. Preserve those wins.
Extend promotion to the admin and compiler images: deploy versioned images
tested in CI, ideally pinned by digest. This removes VPS installation/build
work and makes deployment use the same images that passed smoke tests.

Reduce the admin runtime dependency set as a separate step. The Docker image
currently copies all production `node_modules`, including browser/build
dependencies. Locally, Next contains 167 MiB and Mermaid 117 MiB of files;
those are Windows installation sizes, not measured Linux image savings.
The generated homepage renderer imports React, React DOM, and lucide-react.
Keep its required runtime modules and PDF.js resources when trimming packages.

First collect per-stage Actions/VPS timings and cache hit rates. The 3.75-second
local build does not justify claiming compilation is the dominant CI cost.
Separate verification cancellation from production deployment serialization so
obsolete verification runs can be discarded without interrupting deployment.

### 4. Remove background blog preview/history/list work

`server/admin/blogs.js` still requests and enhances a full preview after edits
even when Live mode is displayed, matching the unnecessary work removed from
book notes. Each successful autosave also rebuilds the hidden library and
reloads revision history (lines 69–89 at review time).

Render previews only while Preview is visible. Refresh revision history when
the Changelog section approaches the viewport, and defer hidden library rendering until
returning to it. Keep word counts independent of preview requests. Verify
autosave ordering, image controls, publishing, and revision restoration.

### 5. Avoid full resume reads for metadata and cached thumbnails

`server/resumes.mjs` calls `SELECT *` before most per-resume routes. This loads
original, draft, and published PDF bytes even for detail/metadata actions.
Cached thumbnails also load and hash the entire draft PDF before cache lookup.
Select fields per operation, persist the PDF digest/version on compilation,
and look up thumbnails from that metadata. Aggregate library statistics in
queries rather than issuing several per resume. This is a source finding;
resume latency has not been benchmarked in this review.

### 6. Profile PDF color compositing and dynamic public pages

`server/admin/reader-colors.js` rebuilds the shared SVG filter after page color
scans, even when successive pages have identical palettes. Changing that filter
can invalidate every rendered page using it. Skip equivalent filter updates,
coalesce color-picker changes per animation frame, and update color-control DOM
only while its panel is visible. Confirm the benefit with a browser rendering
profile before changing the rendering approach.

The production homepage is dynamically rendered through the admin service on
each request, despite the static build. Public blog articles also render on
request. Cache public render output with explicit invalidation when public
content changes. Preserve per-request analytics and response security headers.
Measure traffic and render cost before making this a high-priority project.

### 7. Keep build output clean and add performance visibility

`scripts/build-blog.mjs` writes new chunks without removing obsolete outputs.
Build into a fresh staging directory and replace the generated output after a
successful build. Do not delete files still needed by an active development
page midway through a build. Fresh CI checkouts are less affected than local
development or incremental Docker build contexts.

Add timings for install, verification, each image build, image transfer/pull,
and container readiness. Track admin initial JS bytes, request latency, and
event-loop delay under concurrent PDF traffic. Use these baselines to confirm
improvements; avoid brittle wall-clock assertions in unit tests.

## Suggested first batch

Start with compact book state and bounded PDF reads for responsiveness, lazy
editor loading plus asset revalidation for navigation, and tested-image promotion
for CI/CD. Then remove the duplicated background work in Blogs. These address
specific observed or source-confirmed costs without replacing the application
framework or editor.
