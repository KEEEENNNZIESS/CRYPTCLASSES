# CryptClass — Haunted Mansion UI update

This revision brings the live application closer to the approved Halloween UI reference.

## Visual updates
- Atmospheric haunted-night backdrop with a dark purple/charcoal overlay and warm pumpkin glow.
- Locally bundled corner cobwebs and animated hanging spider.
- Gothic display typography, layered cards, warmer orange controls, purple panel surfaces, and stronger status/metric styling.
- Functional admin sidebar for Dashboard, Kelola Kuis, Buat Kuis, Hasil & Analitik, and Kembali ke Beranda. Sidebar collapses into a horizontal navigation bar on narrow screens.
- Additional visual treatments for quiz cards, question answer states, progress bar, report tables, and admin panels.
- Responsive layout and reduced-motion support remain in place.

## Scope and safety
- Server routes, database schema, answer validation, grading, quiz state, and result computation are unchanged.
- The sidebar routes to existing views/actions; it does not create mock data or pretend there are separate settings/results pages when none exist.
- All decorative artwork is served locally from `public/assets/`.

## Validation
- `node --check server.js` passed.
- `node --check public/app.js` passed.
- `npm test`: 9/9 unit tests passed.
- Static browser screenshot validation was attempted but could not be completed in the current container, so desktop/mobile appearance should still be checked after deployment.
