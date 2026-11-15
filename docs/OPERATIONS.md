# UniVault operational notes

This guide describes setup and data behavior in the repository. Provider configuration and hosted end-to-end behavior must be verified separately.

## Configure an independent backend

Apply these migrations in order to a separate Supabase project:

1. [Workspace schema](../supabase/migrations/202611110001_workspace.sql).
2. [Book document sections](../supabase/migrations/20261112184442_book_document_sections.sql).

Then update `backend-config.js` with that project's URL and publishable key. The workspace schema supplies account-owned records, the revision-based save function, and private storage policies. The second migration extends supported material categories.

Configure the exact application origin in Supabase Auth's site and redirect URLs. `localhost` and `127.0.0.1` are different origins. Use the origin actually opened in the browser, and configure the hosted HTTPS origin separately.

Email/password sign-in uses confirmation. Google sign-in additionally requires configuring the provider's client and callback URL for your own Supabase project. Keep client secrets in provider settings, never in frontend files.

References: [API keys](https://supabase.com/docs/guides/getting-started/api-keys), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [Google sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google).

## Local and account workspaces

A local workspace is specific to a browser profile and website origin. A new cloud account starts empty; local content is not silently assigned to the account.

To move existing content, sign into an empty account on the original browser/origin and choose **Settings & backup → Import this browser's workspace**. Local originals remain available; failed file transfers can be retried.

When moving between origins, export a workspace backup first. JSON backups contain workspace records, not uploaded file binaries or account passwords. Transfer files separately.

## Save conflicts, offline edits, and logout

Cloud saves carry an expected revision. If another device has saved a newer version, pending local content is retained rather than silently replacing the remote version.

Before choosing **Load cloud version**, download a local backup if you need to preserve both sets of changes. **Sync now** retries pending saves and retrieves remote state.

Offline edits can remain cached, but file uploads require connectivity. The application does not promise an offline copy of every uploaded file.

Successful logout flushes pending work and clears the account's cached workspace. Failed sync prevents logout to avoid silently abandoning unsaved work.

## File storage

Account files use the private `course-materials` bucket with owner-prefixed paths. Previews/downloads retrieve authenticated blobs rather than permanent public URLs.

Limits in the application are 50 MB per file and 5 MB per workspace snapshot, in addition to provider quotas. The book-section migration adds tutorial/custom-section categories; it does not replace ownership policies.

## Academic records

Performance sheets must contain selectable text; image-only scans are unsupported. The importer accepts up to 10 MB and 30 pages. It reconstructs table rows from coordinates and requires review before saving.

Repeated imports merge by semester and course code, preserving existing IDs and related content. Conflicting or unreadable input should be reviewed rather than replaced with sample grades.

Configured grade points are A=10, A-=9, B=8, B-=7, C=6, C-=5, D=4, E=2. GPA is credit-weighted. Special/non-letter reports and pending courses are handled separately from GPA credits; earned credits are also tracked separately. E contributes grade points without earned credits; SA can earn credit without entering GPA.

Repeated-course replacement rules are not inferred. Compare imported records and calculated results against the official sheet.

Elective placeholders (DEL, HuEL, OpEL) count as planned credits until an actual course/grade is recorded. Converting a placeholder retains its ID and related content.

Temporary midsemester estimates do not overwrite final records. They remain in page memory and are cleared by reset, semester selection, or reload; they are not synced or included in backups.

## Study interface and accessibility

`room.js` builds the Three.js scene; `book-reader.js` opens course materials. HTML controls support course search/navigation and keyboard interaction. Reduced-motion preferences skip camera/cover animations; a room illustration provides a fallback when WebGL is unavailable.

Material sections and file ordering are saved per course. Unsupported document formats remain downloadable. Artwork provenance is in [assets/README.md](../assets/README.md); retain dependency notices under `vendor/`.

## Checks

Run `npm run check` and `npm test` with Node.js 22 or later. The tests use synthetic academic records and mocked backend interactions; they do not certify a hosted OAuth configuration.

The optional [live backend check](../scripts/check-live-backend.mjs) requires disposable confirmed accounts supplied through `UNIVAULT_TEST_FIXTURES`. It writes test workspaces and a temporary file. Review its fixture format and [cleanup script](../scripts/cleanup-live-check.mjs) before running it.

Never use real transcripts, personal files, or ordinary user accounts as disposable integration-test fixtures.
