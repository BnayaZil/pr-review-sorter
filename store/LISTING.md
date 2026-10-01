# Chrome Web Store listing — copy/paste

**Name:** PR Review Sorter

**Summary (≤132 chars):**
Reorder a GitHub PR's changed files into a logical review order — with inline highlights and comments — from a link your AI builds.

**Category:** Developer Tools

**Language:** English

**Detailed description:**

GitHub shows a pull request's changed files alphabetically. That's rarely the order that
makes a review easy. PR Review Sorter reads a review plan that a code agent (Claude, etc.)
encodes in the PR link and:

• Reorders the "Files changed" list into a sensible reading order — entry points first,
  tests and docs last.
• Adds a numbered badge to each file and a clickable "Review order" panel.
• Highlights specific lines and shows the agent's inline comments, so you're walked
  through the diff instead of guessing where to start.

Everything travels in the link — no account, no server, nothing to configure. For large
PRs the plan can be compressed or stored in a public gist, so the link stays small.

Pairs with the free **pr-review-sorter** agent skill, which teaches your AI to generate
these links:
  npx skills add BnayaZil/pr-review-sorter
Skill + source: https://github.com/BnayaZil/pr-review-sorter

**Single purpose (required field):**
Reorder and annotate a GitHub pull request's changed-files view according to a review
plan encoded in the page URL.

**Permission justifications:**

- Content script on `https://github.com/*/pull/*`: to read the review plan from the URL
  and reorder/annotate the files shown on the pull-request page.
- Host permission `api.github.com`, `gist.githubusercontent.com`, `raw.githubusercontent.com`:
  only to fetch the review-plan JSON when a link points to a gist or hosted file
  (`pr_order_gist` / `pr_order_url`). No other network access.
- No remote code is loaded or executed.

**Privacy policy URL:**
https://raw.githubusercontent.com/BnayaZil/pr-review-sorter/main/PRIVACY.md

**Data collection disclosure:** "This item does not collect user data." (true)

**Homepage URL:** https://github.com/BnayaZil/pr-review-sorter

**Screenshots:** `store/screenshots/01-before.png`, `store/screenshots/02-after.png` (1280×800)
