# CryptClass feedback update

## Added in this update
- Participant report search by display name.
- Participant report status filter (all / in progress / completed / locked).
- Manual report refresh button.
- Automatic report refresh every 15 seconds while a quiz is open, paused while the admin is interacting with the report or has an answer-history panel open.
- Live report status text explaining whether automatic refresh is active.

## Existing features retained (not newly introduced here)
- Local draft and pending-answer queue, server autosave indicator, and reconnect synchronization.
- Server-side grading, partial credit for supported question types, answer validation.
- Admin leaderboard and question analysis.
- CSV/XLSX/PDF report export.
- Question/key preview in admin view.
- Database backup/restore and admin audit logging.
- Participant session token separate from display name, with duplicate display names allowed.

## Validation performed
- `node --check server.js`
- `node --check public/app.js`
- `npm test` (9 tests passed)

## Still required before production
- Browser-based end-to-end test with two separate participants using the same display name.
- Load test with 41–60 concurrent participants.
- Verify the chosen free hosting provider's persistent PostgreSQL, sleeping, limits, and backup/restore behavior.
- Verify restore procedure using a disposable test database before relying on it for live class data.

This update does not claim that load tests or browser end-to-end tests have been performed.
