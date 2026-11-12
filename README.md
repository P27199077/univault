# Univault

A student workspace for courses, materials, notes, calendar tasks, grades, and timetables. The interface is static HTML/CSS/JavaScript. Supabase provides email/password and Google authentication, versioned account data, and private file storage.

## Open the app

The checked-in `backend-config.js` connects to the Univault Supabase project. It contains a publishable key, which is designed for browser use. Access to every database row and stored file is restricted by the signed-in account. Never place a service-role key or database password in this file.

```sh
npm install
npm start
```

Open **http://localhost:3000**, create an account, confirm the email, then sign in. Use the same account on another device once the frontend is hosted. The backend is live; a localhost address is only accessible from the computer running it.

`npm install` copies the official pinned Supabase browser SDK into `vendor/supabase.js`. The committed vendor copy lets the static site run without a build step. Node.js 22 or later is needed for dependency installation and tests.

## Authentication and hosting

- Email/password sign-in and email confirmation are handled by Supabase Auth.
- New cloud accounts start empty. Existing browser content is never automatically attached to an account.
- A local mode is available using **Continue on this device**. It is not an authenticated cloud account.
- The local server uses port 3000, matching Supabase's default local confirmation return address. Before hosting, set **Authentication → URL Configuration → Site URL** to the final HTTPS website URL and add its exact callback URL to **Redirect URLs**. Keep the localhost URL only if development is still needed.
- Supabase's default email sender is intended for development and may restrict recipients. Configure a verified SMTP provider in Supabase before offering public sign-ups. If confirmation email does not arrive, inspect the project's Auth logs and email settings; do not disable confirmation as a workaround.
- Host the static files over HTTPS. Only publish runtime files, not `node_modules`, tests, or local test fixtures.

## Enable Google sign-in

The **Continue with Google** buttons work for both new and existing users. They use Supabase's browser OAuth flow and return to the app's root on the same website. Supabase restores the authenticated session before the account's private workspace is opened. No Google client secret belongs in this repository or Vercel's frontend configuration.

The production website is `https://univault-eight.vercel.app/`; the Google Cloud project is `refined-cortex-514511-j6` (Univault).

1. In [Google Cloud](https://console.cloud.google.com/auth/overview), select or create a project for Univault and configure its Google Auth Platform branding and audience. Use an external audience for personal Google accounts. This app requests only basic identity scopes (`openid`, email, and profile), so Google's testing-mode test-user restriction does not apply. You do not need to approve each user's email. Additional Google API permissions could change those requirements; see [Google's audience rules](https://support.google.com/cloud/answer/15549945?hl=en).
2. Create an OAuth client of type **Web application** under **Clients**. Add `https://univault-eight.vercel.app` (no trailing slash or path) to **Authorized JavaScript origins**. Add `http://localhost:3000` if needed for development.
3. Add this exact **Authorized redirect URI**: `https://iuarambkuwoqwlbitxkz.supabase.co/auth/v1/callback`.
4. In [Supabase → Authentication → Sign In / Providers → Google](https://supabase.com/dashboard/project/iuarambkuwoqwlbitxkz/auth/providers?provider=Google), enable Google and enter the client ID and secret directly in the dashboard. Keep the secret private. Use only the basic `openid`, email, and profile scopes; this app does not need Gmail, Drive, or offline access.
5. In [Supabase → URL Configuration](https://supabase.com/dashboard/project/iuarambkuwoqwlbitxkz/auth/url-configuration), set **Site URL** to `https://univault-eight.vercel.app/` and add that exact URL to **Redirect URLs**. Optionally add `http://localhost:3000/` for local testing. Avoid broad wildcard URLs for production.
6. Test from the live website using **Continue with Google**, then sign out and back in to confirm your workspace persists. A cancelled login should return to sign-in with a readable message. After Google OAuth testing, publish the consent screen as required before offering sign-in publicly.

If Google's provider is disabled, the app keeps the user on the sign-in page and offers email login. Network errors also allow retrying without losing local content. Google sign-in cannot complete until the external provider configuration above is finished. See [Supabase's Google sign-in guide](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).

## Performance sheets and grades

Open **Grades & CGPA → Upload performance sheet**, select an original BITS performance PDF, review the extracted table, then choose **Save academic records**. The import reads the document in your browser and saves course codes, names, exact credits, and recorded grades through your existing workspace persistence. It does not upload or retain the original PDF or student identity fields. Nothing is preloaded, and failed parsing never falls back to sample records.

- The preview defaults to courses with recorded grades. **Also add ungraded / future courses** is optional; those courses do not affect GPA until they receive a letter grade.
- A single upload is enough to retain your past semesters. Uploading a newer sheet merges courses by semester and course code, updates recorded grades and credits, and keeps existing IDs, notes, tasks, files, and unrelated courses. Re-uploading the same sheet does not create duplicates.
- The grade view shows each semester's SGPA and the cumulative CGPA, using credit-weighted grade points: A=10, A−=9, B=8, B−=7, C=6, C−=5, D=4, E=2. Pending courses and special reports such as SA/NC/RRA do not enter GPA credits. Earned credits and completed-course counts include only passed courses; unfinished courses and elective placeholders appear separately as planned credits. E contributes 2 grade points to GPA but earns no credit. SA earns credit without entering GPA. GPA credits are displayed separately.
- Recorded grades can be corrected in **Grades & CGPA**. Professor and target-grade fields are removed from course cards and forms. Older saved grade fields remain readable for compatibility.
- The parser uses PDF text coordinates to handle side-by-side semester tables and repeated headings. It accepts selectable-text PDFs up to 10 MB and 30 pages; scanned image-only sheets require OCR and are not supported. A mismatch between the sheet's printed CGPA and the calculated result is highlighted for review. Repeated-course replacement rules are not inferred; check those records before saving.

## Elective placeholders and temporary midsem estimates

Use **Grades & CGPA → Add elective placeholder**, or **Dashboard → Add Course → Course type → Elective placeholder**. Choose **DEL**, **HuEL**, or **OpEL**, the semester, and the known credits. Names and course codes are optional until the actual elective is selected; each slot is automatically numbered. You can add multiple slots per semester. They count only as planned credits and cannot receive a final grade.

Choose **Choose course** on the slot in Grades & CGPA or its course workspace, then enter the actual name and code. The same record ID is retained, preserving its notes, tasks, and file links. Choosing a course still leaves it ungraded: it enters earned credits and GPA only when an appropriate final grade is recorded. Slots are never silently matched to courses imported from a PDF.

Expand **Estimate your current semester with midsem grades** in Grades & CGPA. Pick the current semester from ongoing semesters and enter temporary letter grades for its selected courses. The estimate is weighted by course credits and shows how many courses and credits it covers. Elective placeholders and blank estimates are excluded. Saved final grades are never used as defaults or overwritten, and historical SGPA, cumulative CGPA, and earned credits are unchanged. Estimates exist only in page memory: **Reset temporary grades**, selecting another semester, or reloading clears them. They are not synced or included in backups.

## Existing data

On the same browser and website address where earlier data was saved, sign into an empty cloud account, open **Settings & backup**, then choose **Import this browser’s workspace**. This imports courses, notes, tasks, calendar events and notes, grades, timetable settings and exam dates, saved links, and IndexedDB files. Original local data is kept. Failed file uploads can be retried.

Browser storage is specific to a browser profile and website address. If moving from a different address, export your workspace there first, then restore the backup at the new address. Uploaded files must be transferred separately when moving between browser origins. The JSON backup includes workspace data, not file binaries or account passwords.

## Persistence and limits

- All feature values are scoped to the authenticated user's ID in the local cache and database.
- Saving is debounced and uses an atomic expected revision in PostgreSQL. Conflicting edits from different devices are kept locally and are not silently overwritten. Download the local backup before choosing **Load cloud version**.
- Interrupted saves are marked pending in the account's local cache and retried when the connection returns. **Sync now** saves pending changes and loads the latest remote version.
- Files use a private `course-materials` bucket with paths starting with the owner's user ID. The app downloads authenticated file blobs for previews and downloads. No permanent public URLs are used.
- Each file is limited to 50 MB. Workspace snapshots are limited to 5 MB. Provider plan storage and bandwidth quotas also apply.
- Successful logout flushes pending work and removes this account's cached workspace content. A failed sync prevents logout so unsaved work is not silently dropped.
- File uploads require a connection. Offline mode retains cached workspace edits; it does not queue file uploads or provide offline copies of all file binaries.

## Database changes

The applied schema is in `supabase/migrations/202611110001_workspace.sql`. It creates `workspaces`, `materials`, the optimistic-save function, and owner-only database and storage policies. Apply migrations to another Supabase project through its SQL Editor or the Supabase CLI before replacing the public browser configuration.

## Verification

```sh
npm run check
npm test
```

Unit tests cover account isolation, interrupted saves, simultaneous-device conflicts, email confirmation, logout, private file paths, and migration retries. Academic tests use invented records to cover column parsing, exact grades and credits, weighted GPA, non-letter reports, safe merging, and repeat uploads; no personal transcript fixture is included. `scripts/check-live-backend.mjs` is an optional live integration check requiring two disposable, confirmed test accounts supplied in a JSON file through `UNIVAULT_TEST_FIXTURES`. It never creates or emails real users. It intentionally writes test workspaces and a temporary file, so use disposable accounts only and remove them afterwards.

### The UniVault study interface

The interface uses a warm mid-century study theme throughout sign-in, courses, materials, planners, grades, settings, and dialogs. `study.css` contains the theme, responsive layout, walnut navigation cabinet, paper surfaces, and course shelf. Desk shortcuts open the existing tools. The bookshelf hotspot brings the course shelves into view: each semester has a shelf, each subject has a book, and hovering or focusing lifts the book before opening its course workspace. Elective placeholders appear as reserved blank volumes. Wrapped rows each retain a wooden shelf. All saved workspace IDs, records, and actions are preserved; no example courses or grades are bundled.

`assets/cozy-study.webp` is the original room artwork, optimized to approximately 380 KB and reused for the welcome screen and study banner. Artwork provenance and the generation prompt are in [assets/README.md](assets/README.md). The room image is decorative context; navigation and actions use ordinary keyboard-accessible controls. Reduced-motion and print styles are included.

### Interactive room and subject books

The home view is a stylized Three.js study, built from original geometry in `room.js`. Clicking the bookshelf animates the camera toward the cabinet and opens an accessible close-up of all semester levels. Each course is a spine-first book, with a fixed binding color for CDC, HuEL, DEL, or OpEL. Unlabeled legacy courses default to CDC; existing elective labels are retained. The course form and the book's “Edit course & category” action can change this classification without changing grades, credits, notes, or file links.

`book-reader.js` animates extraction and opening, provides keyboard-operable contents tabs, and previews PDFs, images, text, audio, and video inside the right page. Original uploads, downloads, notes and tasks use their existing persistence. Unsupported document formats remain downloadable. The sidebar stays available throughout. The close-up cabinet uses HTML controls so course names, search, and actions work with keyboard navigation and screen readers; reduced motion skips camera and cover animations. A room illustration provides fallback when WebGL is unavailable.

Dependencies are pinned. `scripts/vendor-study.mjs` bundles Three.js and GSAP into `vendor/study-engine.js` for local serving, with retained license notices. Rebuild vendor files with `npm run postinstall` after updating dependencies. No 3D assets are fetched from external model hosts. Example books and testing documents are not bundled or loaded into accounts.
