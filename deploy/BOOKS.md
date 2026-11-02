# Private book library

Open `/admin`, sign in, and select **Books**. The library belongs to the private
admin service, not the public static website. PDFs, covers, and downloads all
require the existing admin session. Nothing is copied into `public/` or Git.

Use the check-circle button on a book row to mark it complete. Completed books
have a soft green row highlight and a **Completed** label. Click the button again
to mark a book incomplete. This status saves automatically and persists across
refreshes, edits, and server restarts.

Each list row contains the first-page thumbnail, book name, actual PDF page
count, tags, and Download / Delete actions. Click the cover or title to open
the PDF preview. Click elsewhere on a row, or the `+` beside its tags, to
rename the book or edit its tags. A focused row also opens with Enter or Space.
Type a tag and press Enter,
choose an existing suggestion, or remove a chip with `×`. Changes save
automatically; no Save button is needed. Book names save when you leave the
name field. The editor shows saving/saved status and offers a retry if a save
fails. Tag names are reused
without case-sensitive duplicates. Select a tag above the list to filter by
that exact tag; **All books** clears it. Search matches names and tags and can
be combined with the selected filter.

Under each book's page count, **Set page** saves your current reading position.
Enter a PDF page number and choose **Save bookmark**. The list shows the saved
page; clicking the cover or title resumes there using the PDF viewer's page
fragment. Click the saved page to update or clear it. Bookmarks live in the
private database, persist across restarts/devices, and survive title/tag edits.
This is a manual bookmark: the browser's built-in PDF viewer does not report
page changes back to the library. PDF page numbers may differ from printed
page labels. Downloads continue to contain the complete, unchanged PDF.

**Upload books** accepts multiple PDF files, up to 100 MiB each. A single file
can have a custom title; otherwise the filename supplies its title. Selected
tags apply to every file in that upload. PDFs upload sequentially; failed files
stay selected for retry while successful files remain in the library. Duplicate
PDF contents are rejected. Invalid or encrypted PDFs are rejected. The server
uses Poppler to count pages and render the first page, rather than trusting
client-provided metadata. Downloads preserve the original bytes. Read opens
the PDF in the browser's reader; byte ranges support navigation in large PDFs.

Delete opens a confirmation and removes that book, cover, and tag associations.
Original source files on the computer are unaffected. Unused tags disappear
from the filter bar. Other books, links, and resumes are preserved.

## Storage and deployment

PDF bytes, covers, and metadata are stored together in `data/admin.sqlite`
locally, and `/data/admin.sqlite` in the existing `admin_data` Docker volume.
Back up the SQLite database with its existing backup procedure. Storage usage
grows with uploaded PDFs; books are not included in the static export or source
release. Deploying the code does not transfer the local library to the VPS.
After deploying, upload books through the production admin to populate its
separate database. Never replace the production database with a local database
containing different links or resume history.

The admin Docker image installs `poppler-utils`. Its temporary filesystem is
256 MiB to accommodate two concurrent PDF inspections. NGINX allows 100 MiB book
requests with a 120-second timeout and streams request bodies to admin instead
of buffering PDFs in the proxy's 16 MiB temporary filesystem. HTTP/1.1 upstream
requests also keep chunked uploads streaming. No public routes or storage buckets are used.
The CI workflow installs Poppler for the real-PDF backend tests; the container
smoke test also checks a 24 MiB book upload and unchanged downloads through NGINX
with the same 16 MiB proxy temporary filesystem used in production.

For local development, ensure `pdfinfo` and `pdftoppm` from Poppler are on PATH
before `npm run dev`. Missing tools produce an actionable upload error.

## Import existing local files

Run:

```powershell
npm run books:import -- "C:/path/to/Book.pdf" "C:/path/to/Another.pdf"
```

For titles and initial tags, pass an ignored JSON manifest:

```json
[
  { "file": "C:/path/to/Book.pdf", "name": "Book title", "tags": ["C++", "Concurrency"] }
]
```

```powershell
npm run books:import -- --manifest data/books-import.json
```

The default database is `./data/admin.sqlite`; `--database` selects another
local database. Repeating an import skips matching PDFs without duplicating
them or overwriting edited titles/tags. The importer uses the same PDF validation
and thumbnail generation as the web upload. Manifests use local paths and are
not included in Git or Docker releases.
