# CryptClass feedback update

This update implements the feedback items from the latest source archive.

## Included
- Matching connectors now attach to the right edge of each left item and the left edge of its paired right item.
- Matching connectors use a fine white/silver web-like SVG treatment and are recalculated on resize.
- Question type labels appear while participants are answering and in the participant result recap.
- The participant result recap shows `Lihat Selengkapnya` only when the question result is `partial`; full-correct and full-wrong results do not show the partial-review control.
- Partial matching feedback shows each left item, the participant's selected pair or empty state, and a safe status only. The answer key is not rendered in the participant feedback.
- Partial ordering feedback marks positions as correct/incorrect without displaying the expected ordering.
- Partial multiple-select feedback marks selected choices as correct/incorrect while leaving unselected choices neutral and does not expose the answer key.
- Admin question details show the question type. Matching admin detail includes a visual preview of participant connections, key pairs, per-pair status, and the partial score.
- Server-generated feedback for matching, ordering, and multiple-select includes safe per-item statuses, not the answer key itself.

## Validation run
- `npm run check` — passed
- `npm test` — 9 tests passed

Browser/device testing still needs to be performed against the deployed/local Docker app, particularly matching touch interaction, result visibility, and the admin report preview.
