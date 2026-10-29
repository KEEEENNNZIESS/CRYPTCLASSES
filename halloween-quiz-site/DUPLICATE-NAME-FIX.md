# CryptClass duplicate participant name fix

## What changed
- Display names are no longer unique identifiers. Multiple participants may use the same display name in the same quiz.
- `/api/join` resumes a participant only when a valid participant resume token is provided; otherwise it creates a new participant and a separate attempt.
- The database migration removes the old unique index on `(quiz_id, lower(display_name))` and replaces it with a non-unique lookup index.
- Browser resume tokens are scoped to `sessionStorage` and a versioned key. Local answer drafts/pending saves are keyed by participant ID and attempt ID, avoiding collisions between equal names.

## Deploy safely
1. Back up the database from the CryptClass admin backup screen before updating.
2. Extract this ZIP and copy the project files over the current source folder.
3. From the existing source folder run:
   `docker compose -p cryptclass-v12 up --build -d`
4. Check:
   `docker compose -p cryptclass-v12 ps`
5. Test with two separate browser profiles/devices: join the same quiz using the same display name, answer different questions, and confirm admin shows two separate participant records and independent scores.

Do not run `docker compose down -v`; do not delete the PostgreSQL volume.

## Existing participants
Existing participant rows and attempts are preserved. Because the browser token storage key is versioned and now uses sessionStorage, an already-open participant session may need to join again after the update; the old attempt remains in the admin records. Verify active-session continuity in a test before deploying during a live quiz.
