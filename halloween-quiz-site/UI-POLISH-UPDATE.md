# CryptClass UI Polish — Pumpkin Parchment

This update refreshes the existing CryptClass interface with a brighter, cozy Halloween visual theme. It is designed to preserve the current quiz behavior and database schema.

## Visual updates
- Warm parchment/ivory backgrounds with pumpkin orange, plum, lavender, and soft green accents.
- Lighter top navigation, updated pumpkin brand mark, soft gradients, subtle dotted texture, and small seasonal sparkles.
- Reworked desktop homepage into a two-column layout, with the join form in its own elevated card; mobile layouts return to a single column.
- Refined panels, buttons, inputs, question-editor cards, answer choices, status pills, stats cards, tables, reports, matching boards, result rows, memory cards, toast messages, and dialogs.
- Improved focus states, responsive spacing, table overflow behavior, and reduced-motion handling.
- Added a CSS query version to the stylesheet link to help browsers fetch the new look instead of a cached stylesheet.

## Files changed
- `public/style.css`
- `public/index.html`

No JavaScript grading logic, API route, session logic, or database schema was changed for this visual-only update.

## Validation performed
- `node --check server.js` passed.
- `node --check public/app.js` passed.
- `npm test`: all 9 existing tests passed.
- CSS syntax parsing: no top-level parse errors reported.

A full in-browser visual QA on desktop/mobile and an end-to-end production smoke test have not been completed in this environment. After applying the source, check the admin and student screens in the browser.
