# UniVault

**A personal academic workspace for semester documents, courses, and study planning.**

[Live app](https://univault-eight.vercel.app/)

I built UniVault to keep my semester materials together and make them easier to revisit. It combines course documents, notes, tasks, timetables, and academic records in an interactive study-room interface.

## Features

- Organize courses by semester and keep materials in course-specific sections.
- Preview PDFs, images, text, audio, and video; download unsupported formats.
- Keep notes, tasks, calendar entries, timetables, and useful links together.
- Import selectable-text BITS performance sheets, review the extracted records, and calculate credit-weighted SGPA/CGPA.
- Merge repeated academic imports without duplicating the same semester/course record.
- Plan elective placeholders and estimate current-semester grades without overwriting final records.
- Use a local workspace or sign in for account-based persistence and private file storage.
- Navigate courses as books in a Three.js study, with HTML controls, reduced-motion behavior, and a non-WebGL fallback.

Attendance is currently a placeholder in the interface, not a completed attendance-tracking feature.

## Stack

| Layer | Implementation |
| --- | --- |
| Application | HTML, CSS, JavaScript modules |
| Interactive study | Three.js and GSAP |
| PDF processing | Bundled PDF.js and browser-side parsing |
| Account services | Supabase Auth, PostgreSQL, and Storage |
| Local persistence | Browser storage and IndexedDB |
| Hosting | Static frontend on Vercel |

This is a JavaScript application; it does not require React or Next.js.

## Try it locally

Requires Git and Python 3. Serve the checked-in runtime files:

```sh
git clone https://github.com/P27199077/univault.git
cd univault
python3 -m http.server 3000 --bind 127.0.0.1
```

Open **http://127.0.0.1:3000/** and choose **Continue on this device** to explore a browser-local workspace without creating an account.

The checked-in `backend-config.js` connects account mode to the existing Supabase project. For development involving accounts or cloud writes, configure a separate backend first. A local frontend is not an isolated cloud environment.

## How persistence works

Local mode stays in the current browser and website origin. Account mode scopes workspace data to the signed-in user and uses private file paths with database/storage ownership policies.

Saves are debounced and sent with an expected revision. If another device has saved a newer version, the app retains local changes and asks the user to resolve the conflict rather than silently overwriting them. Interrupted saves remain pending for retry.

An existing browser workspace is imported into an empty account only through an explicit action. JSON backups include workspace records, not file binaries or passwords; files need separate transfer when moving between website origins.

## Performance-sheet import

1. Open **Grades & CGPA → Upload performance sheet**.
2. Choose an original BITS performance PDF with selectable text.
3. Review the extracted semesters, course codes, credits, and grades.
4. Choose **Save academic records**.

The parser reconstructs rows from PDF text coordinates, including side-by-side semester tables. Re-imports merge by semester and course code while retaining existing workspace IDs and related content.

The original performance PDF and identity fields are not retained by this import flow; confirmed academic records enter the workspace's normal persistence.

**Limits:** selectable-text PDFs only, up to 10 MB and 30 pages. Scanned sheets require OCR and are unsupported. Repeated-course replacement rules are not inferred; review those records manually. GPA calculations are an organizational aid, not an official transcript.

## Set up a separate account backend

1. Create a separate Supabase project.
2. Apply both SQL files in `supabase/migrations/` in filename order.
3. Set that project's URL and publishable key in `backend-config.js`.
4. Configure Auth site/redirect URLs for the exact local and hosted origins you use.
5. Configure email delivery and, if needed, Google sign-in for that project.
6. Verify account isolation, private uploads, reload persistence, and logout with disposable test accounts.

Publishable keys are intended for browser configuration. Database passwords, service-role keys, and OAuth client secrets do not belong in this repository.

See [operational notes](docs/OPERATIONS.md) for authentication, migration, backup, and storage details.

## Development checks

Node.js **22 or later** is required for dependency installation and the test tooling; `npm start` also requires Python 3.

```sh
npm ci
npm run check
npm test
```

Installation runs the vendor scripts to bundle the pinned browser dependencies. After changing dependency versions, rebuild with `npm run postinstall`.

Tests cover academic parsing/merging, GPA behavior, account-scoped storage, save conflicts, interrupted saves, authentication handling, and book-section logic. These are automated checks of the application logic, not proof that every external provider is configured correctly.

The optional `scripts/check-live-backend.mjs` integration check requires two disposable confirmed accounts through `UNIVAULT_TEST_FIXTURES`. It writes test data and a temporary file; read the script and cleanup procedure before running it.

## Repository map

- `script.js`: application interface and feature coordination.
- `backend.js`: account persistence, sync, and private files.
- `academics.js`: academic records, PDF text parsing, merging, and GPA calculations.
- `room.js`, `book-reader.js`, `book-sections.js`: study navigation and material sections.
- `supabase/migrations/`: database and storage policies.
- `tests/`: application logic tests.
- `vendor/`: bundled browser dependencies and license notices.

## Current limitations

- File uploads require a connection and are limited to 50 MB each; workspace snapshots are limited to 5 MB.
- Offline edits can remain cached, but the app does not queue file uploads or guarantee offline copies of all uploaded documents.
- Google sign-in requires provider configuration; a visible sign-in button alone does not establish that OAuth is ready.
- Local storage is specific to the browser profile and website origin.
- No adoption or user-count claim is made; this began as a personal academic tool.

Artwork provenance is documented in [assets/README.md](assets/README.md). Bundled Three.js and GSAP notices are retained in `vendor/`.
