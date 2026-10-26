# Resume workspace

The admin sidebar has **Link analytics** and **Resumes**. No AI or external
document service is used. XeLaTeX compiles the source; pypdf discovers and
replaces URI annotations in the resulting PDF. This includes hyperlinks emitted
by custom LaTeX macros, without rewriting the original source or its visible text.

## Local use

With Docker Desktop running:

```sh
npm run resume:compiler
npm run dev
```

Open `/admin`, select **Resumes**, and upload a main `.tex` file. Add individual
supporting files, or choose the project folder to preserve relative paths such as
`fonts/`, `images/`, and `styles/`. The separately selected main file replaces the
matching main filename in that folder. Hidden files, build directories, and
generated auxiliary files are ignored by the folder picker. ZIP files are not
supported. Uploads are limited to 80 files and 10 MB combined; output is limited
to 30 pages and 15 MB. Up to 50 resume variants can be stored.

The compiler includes XeLaTeX, standard LaTeX packages, Latin Modern, TeX Gyre,
and DejaVu fonts. Upload custom `.sty`/`.cls` files and `.ttf`/`.otf` fonts used by
your template. Use relative paths from the project root. Shell escape, external
downloads, automatic BibTeX/Biber, and arbitrary build commands are disabled.
Projects requiring other engines or additional system packages may need changes.
Compile errors are shown in the upload dialog; no resume is saved on failure.

After compilation, choose HTTP(S) destinations to track. Give each destination a
name and unique `/r/` slug, then **Save tracking & build PDF**. Repeated instances
of the same URL share a tracking link within one resume. Email and telephone links
remain direct. Existing tracking slugs remain fixed. Link names, destinations,
and activation can subsequently be managed in Link analytics.

**Preview PDF** opens the private draft in the browser's PDF viewer without
incrementing download counts. **Download draft** saves it directly and also does
not count. Browsers without an embedded PDF viewer can use the download button.
**Publish PDF** snapshots that draft at `/resumes/<slug>.pdf`. Selecting **Use as
the website resume** also exposes it at `/resume.pdf` and displays a Resume PDF
link in the public website footer. Changing the draft does not change the public
PDF until published again. Unpublishing removes public PDF downloads; previously
downloaded PDFs and their tracking links continue working.

Duplicate a resume to get the same source/layout with a fresh tracking setup and
independent statistics. To compare different content/layouts, upload each LaTeX
project as a separate resume. Content editing remains in your LaTeX editor.

Each card shows counted PDF downloads and outbound link clicks, including lifetime
clicks on links previously selected in that resume. A short-lived anonymous cookie
counts once per browser, per link or resume, per hour. Different PDF URLs for the
same resume share its download cooldown. HEAD, explicit prefetches, and private
previews do not count. Cookies disabled/cleared, bots, devices, and external PDF
viewers may count separately. Downloads and clicks do not identify a person and
are not a conversion rate. PDF copies shared outside this website cannot register
a download here, but their tracked hyperlinks still register clicks.

Deleting a resume permanently removes its source, PDFs, download history, owned
tracking links, and their click/cooldown history. It does not delete other resumes
or manually created links. Deleting an owned link in Link analytics immediately
breaks that redirect in existing PDFs; rebuilding can create a replacement.

## Production

The existing master deployment builds the additional `compiler` service. No new
GitHub secrets are required. `admin` connects to `http://compiler:3032` over an
internal Docker network. The compiler has no public port, database mount,
password secret, Docker socket, or internet route. It runs as a non-root user
with a read-only root, a bounded temporary filesystem, memory/CPU/PID limits, and
25-second process timeouts. Only the authenticated owner can submit projects.
The development compiler exposes port 3032 on loopback only.

Source files, original/draft/published PDF bytes, mappings, and counts live in the
existing SQLite database in the `admin_data` volume. Back up the database with
SQLite's backup API (or stop the admin service before copying the database and
WAL files). A rebuild/recreate reuses this volume; never use `down --volumes` on
production. No local resumes or links are transferred by deployment.

The first compiler image build downloads TeX Live and needs additional build disk
space. Its memory limit is 768 MB; ensure the VPS has spare RAM for the compiler
alongside the existing services. `RESUME_COMPILER_URL` can override the internal
compiler URL when running the admin service outside Compose.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run test:resumes:compiler
npm run test:deploy
npm run test:admin:container
```

The compiler test uses disposable Docker resources. It checks a real multi-file
resume with uploaded fonts, an image, and a custom style, macro-generated/repeated
links, exact text and pixel preservation after rewriting, direct email links,
path validation, and disabled shell escape. The NGINX test checks the complete
upload/build/publish/download workflow and restart persistence. Sample
PDFs and renders are written under ignored `outputs/resume-compiler/`. GitHub
Actions runs this test before deploying master.
